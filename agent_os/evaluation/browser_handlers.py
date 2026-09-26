"""Real-browser Golden Task handlers for Agent OS."""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from agent_os.adapters.hermes_browser import HermesBrowserExecutor, browser_available
from agent_os.capabilities import CapabilityCatalog
from agent_os.hermes_runtime import build_hermes_agent_os_runtime
from agent_os.orchestration.plan import PlanStepKind
from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import TaskState
from agent_os.store import AgentOSStore

from .golden import GoldenTaskDefinition, GoldenTaskOutcome, GoldenTaskResult


class _BrowserPlanner:
    def __init__(self, proposal: PlanProposal):
        self.proposal = proposal
        self.capabilities = CapabilityCatalog.create(
            action_tools=("terminal", "file", "browser"),
        )

    def plan(self, task):
        return self.proposal


class _NoopCheckpoint:
    def create_checkpoint(self, action):
        return None

    def rollback(self, checkpoint_id):
        return False


class _BenchmarkGate:
    def authorize(self, action, risk: RiskAssessment) -> PermissionDecision:
        allowed = risk.level in {
            RiskLevel.L0_OBSERVE,
            RiskLevel.L1_REVERSIBLE,
            RiskLevel.L2_PERSISTENT_LOCAL,
        }
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason="local deterministic browser benchmark" if allowed else "external or sensitive action denied",
        )


class _FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/workflow"):
            body = b"""<!doctype html><html><head><title>Agent OS Workflow Fixture</title></head>
<body>
<h1 id="state">INITIAL_STATE</h1>
<button id="advance" onclick="
 const s=document.getElementById('state');
 if(s.textContent==='INITIAL_STATE'){s.textContent='STEP_TWO';this.textContent='Finish';}
 else{s.textContent='FINAL_STATE';this.disabled=true;}
">Advance</button>
</body></html>"""
        else:
            body = b"""<!doctype html><html><head><title>Agent OS Analysis Fixture</title></head>
<body><main><h1>AGENT_OS_BROWSER_ANALYSIS</h1><p>architecture-marker-42</p></main></body></html>"""
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass


class _FixtureServer:
    def __enter__(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _FixtureHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"
        return self

    def __exit__(self, exc_type, exc, tb):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)


def _browser_step(
    key: str,
    title: str,
    operation: str,
    *,
    input: dict,
    expected: dict,
    workspace: Path,
    kind: PlanStepKind = PlanStepKind.ACTION,
    depends_on: tuple[str, ...] = (),
) -> ProposedStep:
    return ProposedStep(
        key,
        title,
        kind,
        spec={
            "tool": "browser",
            "operation": operation,
            "input": dict(input),
            "expected_state": dict(expected),
            "workspace_id": str(workspace),
            "verification_required": True,
        },
        depends_on=depends_on,
    )


def _run(definition: GoldenTaskDefinition, root: Path, proposal: PlanProposal):
    store = AgentOSStore(root / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=_BrowserPlanner(proposal),
        permission_gate=_BenchmarkGate(),
        checkpoint_provider=_NoopCheckpoint(),
        enable_browser=True,
        enable_computer_use=False,
        host_local_terminal=True,
        scheduler_owner_id=f"golden-{definition.id}",
    )
    submission = runtime.submit_goal(definition.goal)
    try:
        ticks = runtime.run_until_idle(submission.plan.id, max_ticks=50)
        task = store.get_task(submission.task.id)
        return store, submission, ticks, task
    finally:
        HermesBrowserExecutor.cleanup(submission.task.id)


def browser_analysis(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    if not browser_available():
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.BLOCKED,
            verified=False,
            error="real Hermes browser runtime is unavailable",
        )

    with TemporaryDirectory(prefix="agent-os-gt10-") as temp, _FixtureServer() as fixture:
        root = Path(temp)
        proposal = PlanProposal(
            objective="open the website, extract its marker, and verify fresh source state",
            steps=(
                _browser_step(
                    "open",
                    "Open analysis fixture",
                    "navigate",
                    input={"url": fixture.base_url + "/analysis"},
                    expected={
                        "success": True,
                        "full_snapshot": True,
                        "snapshot_contains": ["AGENT_OS_BROWSER_ANALYSIS", "architecture-marker-42"],
                    },
                    workspace=root,
                ),
                _browser_step(
                    "verify",
                    "Verify analysis source state",
                    "snapshot",
                    input={"full": True},
                    expected={
                        "success": True,
                        "full_snapshot": True,
                        "snapshot_contains": ["AGENT_OS_BROWSER_ANALYSIS", "architecture-marker-42"],
                    },
                    workspace=root,
                    kind=PlanStepKind.VERIFICATION,
                    depends_on=("open",),
                ),
            ),
        )
        _, _, ticks, task = _run(definition, root, proposal)
        verified = bool(task and task.state is TaskState.COMPLETED)
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "engine_ticks": [tick.outcome.value for tick in ticks],
            },
            error=None if verified else "website analysis did not reach verified source state",
        )


def browser_workflow(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    if not browser_available():
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.BLOCKED,
            verified=False,
            error="real Hermes browser runtime is unavailable",
        )

    with TemporaryDirectory(prefix="agent-os-gt11-") as temp, _FixtureServer() as fixture:
        root = Path(temp)
        proposal = PlanProposal(
            objective="complete a two-step browser interaction and verify final DOM state",
            steps=(
                _browser_step(
                    "open",
                    "Open workflow fixture",
                    "navigate",
                    input={"url": fixture.base_url + "/workflow"},
                    expected={"success": True, "snapshot_contains": "INITIAL_STATE"},
                    workspace=root,
                ),
                _browser_step(
                    "focus-control",
                    "Focus browser workflow control",
                    "press",
                    input={"key": "Tab"},
                    expected={"success": True, "snapshot_contains": "INITIAL_STATE"},
                    workspace=root,
                    depends_on=("open",),
                ),
                _browser_step(
                    "step-one",
                    "Advance browser workflow",
                    "press",
                    input={"key": "Enter"},
                    expected={"success": True, "snapshot_contains": "STEP_TWO"},
                    workspace=root,
                    depends_on=("focus-control",),
                ),
                _browser_step(
                    "step-two",
                    "Finish browser workflow",
                    "press",
                    input={"key": "Enter"},
                    expected={"success": True, "snapshot_contains": "FINAL_STATE"},
                    workspace=root,
                    depends_on=("step-one",),
                ),
                _browser_step(
                    "verify",
                    "Verify browser workflow final state",
                    "snapshot",
                    input={"full": False},
                    expected={
                        "success": True,
                        "snapshot_contains": "FINAL_STATE",
                        "snapshot_not_contains": "INITIAL_STATE",
                    },
                    workspace=root,
                    kind=PlanStepKind.VERIFICATION,
                    depends_on=("step-two",),
                ),
            ),
        )
        _, _, ticks, task = _run(definition, root, proposal)
        verified = bool(task and task.state is TaskState.COMPLETED)
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "engine_ticks": [tick.outcome.value for tick in ticks],
            },
            error=None if verified else "multi-step browser workflow did not reach verified final DOM state",
        )


def browser_handlers():
    return {
        "browser_analysis": browser_analysis,
        "browser_workflow": browser_workflow,
    }
