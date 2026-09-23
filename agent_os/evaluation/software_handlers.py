"""Deterministic software Golden Tasks through the concrete Hermes Agent OS runtime."""

from __future__ import annotations

import os
import shlex
import socket
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from agent_os.adapters.hermes_terminal import HermesProcessController
from agent_os.capabilities import CapabilityCatalog
from agent_os.contracts import ActionRecord
from agent_os.hermes_runtime import build_hermes_agent_os_runtime
from agent_os.orchestration.plan import PlanStepKind
from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore

from .golden import GoldenTaskDefinition, GoldenTaskOutcome, GoldenTaskResult


class _StaticPlanner:
    def __init__(self, proposal: PlanProposal):
        self.proposal = proposal
        self.capabilities = CapabilityCatalog.create(
            action_tools=("terminal", "file"),
        )

    def plan(self, task):
        return self.proposal


class _NoopCheckpoint:
    def create_checkpoint(self, action):
        return None

    def rollback(self, checkpoint_id):
        return False


class _WorkspacePermissionGate:
    """Permit disposable local benchmark work through L2 and deny L3/L4."""

    def __init__(self, root: Path):
        self.root = root.resolve()

    def authorize(
        self,
        action: ActionRecord,
        risk: RiskAssessment,
    ) -> PermissionDecision:
        workspace = Path(action.workspace_id or self.root).resolve()
        try:
            workspace.relative_to(self.root)
            inside = True
        except ValueError:
            inside = False

        allowed = inside and risk.level in {
            RiskLevel.L0_OBSERVE,
            RiskLevel.L1_REVERSIBLE,
            RiskLevel.L2_PERSISTENT_LOCAL,
        }
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=(
                f"{risk.level.value} in disposable benchmark workspace"
                if allowed
                else "benchmark policy denied action"
            ),
        )


def _shell(args: list[str]) -> str:
    return subprocess.list2cmdline(args) if os.name == "nt" else shlex.join(args)


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _terminal_step(
    key: str,
    title: str,
    *,
    command: str,
    workspace: Path,
    expected: dict[str, Any],
    depends_on: tuple[str, ...] = (),
    kind: PlanStepKind = PlanStepKind.ACTION,
    background: bool = False,
    timeout: int = 120,
) -> ProposedStep:
    return ProposedStep(
        key,
        title,
        kind,
        spec={
            "tool": "terminal",
            "operation": title.lower(),
            "input": {
                "command": command,
                "workdir": str(workspace),
                "background": background,
            },
            "expected_state": expected,
            "workspace_id": str(workspace),
            "timeout_seconds": timeout,
            "verification_required": True,
        },
        depends_on=depends_on,
    )


def _file_step(
    key: str,
    title: str,
    *,
    path: Path,
    content: str,
    workspace: Path,
    depends_on: tuple[str, ...] = (),
) -> ProposedStep:
    return ProposedStep(
        key,
        title,
        PlanStepKind.ACTION,
        spec={
            "tool": "file",
            "operation": "write_file",
            "input": {"path": str(path), "content": content},
            "expected_state": {"content_equals": content},
            "workspace_id": str(workspace),
            "verification_required": True,
        },
        depends_on=depends_on,
    )


def _file_read_step(
    key: str,
    title: str,
    *,
    path: Path,
    workspace: Path,
    contains: str,
    depends_on: tuple[str, ...] = (),
) -> ProposedStep:
    return ProposedStep(
        key,
        title,
        PlanStepKind.ACTION,
        spec={
            "tool": "file",
            "operation": "read_file",
            "input": {"path": str(path), "offset": 1, "limit": 500},
            "expected_state": {"content_contains": contains},
            "workspace_id": str(workspace),
            "verification_required": True,
        },
        depends_on=depends_on,
    )


def _run_plan(
    definition: GoldenTaskDefinition,
    root: Path,
    proposal: PlanProposal,
):
    store = AgentOSStore(root / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=_StaticPlanner(proposal),
        permission_gate=_WorkspacePermissionGate(root),
        host_local_terminal=True,
        scheduler_owner_id=f"golden-{definition.id}",
        checkpoint_provider=_NoopCheckpoint(),
    )
    submission = runtime.submit_goal(definition.goal)
    ticks = runtime.run_until_idle(submission.plan.id, max_ticks=100)
    task = store.get_task(submission.task.id)
    return store, submission, ticks, task


def _action_for_title(store: AgentOSStore, plan_id: str, title: str):
    for step in store.list_plan_steps(plan_id):
        if step.title == title and step.execution_id:
            return store.get_action(step.execution_id)
    return None


def _verified_result(
    definition: GoldenTaskDefinition,
    *,
    verified: bool,
    evidence: dict[str, Any],
    error: str,
) -> GoldenTaskResult:
    return GoldenTaskResult(
        task_id=definition.id,
        outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
        verified=verified,
        evidence=evidence,
        error=None if verified else error,
    )


def local_project_analysis(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt01-") as temp:
        root = Path(temp)
        project = root / "project"
        package = project / "src" / "demo_pkg"
        package.mkdir(parents=True)
        (project / "pyproject.toml").write_text(
            "[project]\nname = 'demo-pkg'\nversion = '0.1.0'\n",
            encoding="utf-8",
        )
        (package / "__init__.py").write_text("from .core import value\n", encoding="utf-8")
        (package / "core.py").write_text("def value():\n    return 42\n", encoding="utf-8")

        analysis_code = (
            "import json,pathlib;"
            "root=pathlib.Path('.');"
            "files=sorted(str(p.as_posix()) for p in root.rglob('*.py'));"
            "print('ARCHITECTURE '+json.dumps({'pyproject':(root/'pyproject.toml').exists(),"
            "'package_files':files},sort_keys=True))"
        )
        verify_code = (
            "from pathlib import Path;"
            "assert Path('pyproject.toml').exists();"
            "assert Path('src/demo_pkg/core.py').exists();"
            "print('ARCHITECTURE_VERIFIED')"
        )
        proposal = PlanProposal(
            objective="analyze and independently verify local project structure",
            steps=(
                _terminal_step(
                    "analyze",
                    "Analyze project architecture",
                    command=_shell([sys.executable, "-c", analysis_code]),
                    workspace=project,
                    expected={"exit_code": 0, "output_contains": "src/demo_pkg/core.py"},
                ),
                _terminal_step(
                    "verify",
                    "Verify project architecture",
                    command=_shell([sys.executable, "-c", verify_code]),
                    workspace=project,
                    expected={"exit_code": 0, "output_contains": "ARCHITECTURE_VERIFIED"},
                    depends_on=("analyze",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        analysis = _action_for_title(store, submission.plan.id, "Analyze project architecture")
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and analysis
            and analysis.state is ActionState.SUCCEEDED
            and "src/demo_pkg/core.py" in str(analysis.actual_state.get("output") or "")
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "analysis_output": str(analysis.actual_state.get("output") or "")[-2000:]
                if analysis else "",
            },
            error="project architecture was not independently verified",
        )


def build_diagnosis(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt05-") as temp:
        root = Path(temp)
        project = root / "project"
        project.mkdir()
        (project / "broken.py").write_text(
            "def value(:\n    return 42\n",
            encoding="utf-8",
        )
        diagnose = _shell([sys.executable, "-m", "py_compile", "broken.py"])
        verify_code = (
            "from pathlib import Path;"
            "text=Path('broken.py').read_text();"
            "assert 'def value(:' in text;"
            "print('ROOT_CAUSE_INVALID_FUNCTION_SIGNATURE')"
        )
        proposal = PlanProposal(
            objective="observe the deterministic build failure and verify its root cause",
            steps=(
                _terminal_step(
                    "diagnose",
                    "Diagnose build failure",
                    command=diagnose,
                    workspace=project,
                    expected={"exit_code": 1, "output_contains": "SyntaxError"},
                ),
                _terminal_step(
                    "verify",
                    "Verify build root cause",
                    command=_shell([sys.executable, "-c", verify_code]),
                    workspace=project,
                    expected={
                        "exit_code": 0,
                        "output_contains": "ROOT_CAUSE_INVALID_FUNCTION_SIGNATURE",
                    },
                    depends_on=("diagnose",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        diagnosis = _action_for_title(store, submission.plan.id, "Diagnose build failure")
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and diagnosis
            and diagnosis.state is ActionState.SUCCEEDED
            and diagnosis.actual_state.get("exit_code") == 1
            and "SyntaxError" in str(diagnosis.actual_state.get("output") or "")
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "diagnostic_exit_code": diagnosis.actual_state.get("exit_code")
                if diagnosis else None,
                "diagnostic_output": str(diagnosis.actual_state.get("output") or "")[-2000:]
                if diagnosis else "",
            },
            error="deterministic build root cause was not verified",
        )


def build_repair(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt06-") as temp:
        root = Path(temp)
        project = root / "project"
        project.mkdir()
        target = project / "broken.py"
        target.write_text("def value(:\n    return 42\n", encoding="utf-8")
        fixed = "def value():\n    return 42\n"
        proposal = PlanProposal(
            objective="repair the broken source and verify it compiles",
            steps=(
                _file_read_step(
                    "inspect",
                    "Inspect broken source before repair",
                    path=target,
                    workspace=project,
                    contains="def value(:",
                ),
                _file_step(
                    "repair",
                    "Repair broken source",
                    path=target,
                    content=fixed,
                    workspace=project,
                    depends_on=("inspect",),
                ),
                _terminal_step(
                    "verify",
                    "Verify repaired build",
                    command=_shell([sys.executable, "-m", "py_compile", "broken.py"]),
                    workspace=project,
                    expected={"exit_code": 0},
                    depends_on=("repair",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        repair = _action_for_title(store, submission.plan.id, "Repair broken source")
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and repair
            and repair.state is ActionState.SUCCEEDED
            and target.read_text(encoding="utf-8") == fixed
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "repair_state": repair.state.value if repair else "MISSING",
            },
            error="build repair did not reach verified compilable state",
        )


def code_change(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt07-") as temp:
        root = Path(temp)
        project = root / "project"
        project.mkdir()
        target = project / "calc.py"
        target.write_text("def add(a, b):\n    return a - b\n", encoding="utf-8")
        fixed = "def add(a, b):\n    return a + b\n"
        verify_code = "import calc; assert calc.add(2,3)==5; print('CHANGE_VERIFIED')"
        proposal = PlanProposal(
            objective="implement requested behavior and verify it",
            steps=(
                _file_read_step(
                    "inspect",
                    "Inspect source before code change",
                    path=target,
                    workspace=project,
                    contains="return a - b",
                ),
                _file_step(
                    "change",
                    "Implement requested code change",
                    path=target,
                    content=fixed,
                    workspace=project,
                    depends_on=("inspect",),
                ),
                _terminal_step(
                    "verify",
                    "Verify requested behavior",
                    command=_shell([sys.executable, "-c", verify_code]),
                    workspace=project,
                    expected={"exit_code": 0, "output_contains": "CHANGE_VERIFIED"},
                    depends_on=("change",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        verify = _action_for_title(store, submission.plan.id, "Verify requested behavior")
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and verify
            and verify.state is ActionState.SUCCEEDED
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={"task_state": task.state.value if task else "MISSING"},
            error="requested code behavior was not verified",
        )


def run_tests(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt08-") as temp:
        root = Path(temp)
        project = root / "project"
        project.mkdir()
        (project / "calc.py").write_text(
            "def add(a, b):\n    return a + b\n",
            encoding="utf-8",
        )
        (project / "test_calc.py").write_text(
            "import unittest\n"
            "import calc\n\n"
            "class CalcTest(unittest.TestCase):\n"
            "    def test_add(self):\n"
            "        self.assertEqual(calc.add(2, 3), 5)\n\n"
            "if __name__ == '__main__':\n"
            "    unittest.main()\n",
            encoding="utf-8",
        )
        proposal = PlanProposal(
            objective="run and verify the canonical tests",
            steps=(
                _terminal_step(
                    "verify",
                    "Run canonical test suite",
                    command=_shell([
                        sys.executable,
                        "-m",
                        "unittest",
                        "discover",
                        "-v",
                    ]),
                    workspace=project,
                    expected={"exit_code": 0},
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        test_action = _action_for_title(store, submission.plan.id, "Run canonical test suite")
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and test_action
            and test_action.state is ActionState.SUCCEEDED
            and test_action.actual_state.get("exit_code") == 0
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "test_output": str(test_action.actual_state.get("output") or "")[-2000:]
                if test_action else "",
            },
            error="canonical test suite did not pass",
        )


def write_test(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt09-") as temp:
        root = Path(temp)
        project = root / "project"
        project.mkdir()
        (project / "calc.py").write_text(
            "def multiply(a, b):\n    return a * b\n",
            encoding="utf-8",
        )
        test_path = project / "test_calc.py"
        test_content = (
            "import unittest\n"
            "import calc\n\n"
            "class CalcTest(unittest.TestCase):\n"
            "    def test_multiply(self):\n"
            "        self.assertEqual(calc.multiply(6, 7), 42)\n\n"
            "if __name__ == '__main__':\n"
            "    unittest.main()\n"
        )
        proposal = PlanProposal(
            objective="write the missing test and verify it executes",
            steps=(
                _file_step(
                    "write-test",
                    "Write missing test",
                    path=test_path,
                    content=test_content,
                    workspace=project,
                ),
                _terminal_step(
                    "verify",
                    "Execute new test",
                    command=_shell([
                        sys.executable,
                        "-m",
                        "unittest",
                        "discover",
                        "-v",
                    ]),
                    workspace=project,
                    expected={"exit_code": 0},
                    depends_on=("write-test",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        store, submission, _, task = _run_plan(definition, root, proposal)
        verified = bool(
            task
            and task.state is TaskState.COMPLETED
            and test_path.exists()
            and "test_multiply" in test_path.read_text(encoding="utf-8")
        )
        return _verified_result(
            definition,
            verified=verified,
            evidence={
                "task_state": task.state.value if task else "MISSING",
                "test_exists": test_path.exists(),
            },
            error="new test was not written and executed successfully",
        )


def _init_git_fixture(source: Path) -> bool:
    try:
        subprocess.run(["git", "init"], cwd=source, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "agent-os@example.invalid"],
            cwd=source,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Agent OS Golden"],
            cwd=source,
            check=True,
            capture_output=True,
        )
        subprocess.run(["git", "add", "."], cwd=source, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", "fixture"],
            cwd=source,
            check=True,
            capture_output=True,
        )
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def repo_to_running_app(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt20-") as temp:
        root = Path(temp)
        source = root / "source"
        target = root / "app"
        source.mkdir()
        (source / "app.py").write_text(
            "def broken(:\n    pass\n",
            encoding="utf-8",
        )
        if not _init_git_fixture(source):
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.BLOCKED,
                verified=False,
                error="git is unavailable for GT-20 fixture setup",
            )

        port = _free_port()
        marker = "GT20_READY"
        repaired = (
            "from http.server import BaseHTTPRequestHandler, HTTPServer\n"
            "import sys\n\n"
            f"MARKER = {marker!r}\n\n"
            "class Handler(BaseHTTPRequestHandler):\n"
            "    def do_GET(self):\n"
            "        body = MARKER.encode('utf-8')\n"
            "        self.send_response(200)\n"
            "        self.send_header('Content-Length', str(len(body)))\n"
            "        self.end_headers()\n"
            "        self.wfile.write(body)\n"
            "    def log_message(self, fmt, *args):\n"
            "        pass\n\n"
            "if __name__ == '__main__':\n"
            "    HTTPServer(('127.0.0.1', int(sys.argv[1])), Handler).serve_forever()\n"
        )
        probe_code = (
            "import sys,time,urllib.request;"
            f"url='http://127.0.0.1:{port}/';"
            "last=None;"
            "\nfor _ in range(60):"
            "\n try:"
            "\n  data=urllib.request.urlopen(url,timeout=1).read().decode();"
            f"assert {marker!r} in data;print(data);sys.exit(0)"
            "\n except Exception as exc:"
            "\n  last=exc;time.sleep(0.1)"
            "\nraise SystemExit(f'not ready: {last}')"
        )

        proposal = PlanProposal(
            objective="clone, diagnose, repair, build, start and verify the application",
            steps=(
                _terminal_step(
                    "clone",
                    "Clone application repository",
                    command=_shell(["git", "clone", str(source), str(target)]),
                    workspace=root,
                    expected={"exit_code": 0},
                ),
                _file_read_step(
                    "inspect",
                    "Inspect cloned broken source",
                    path=target / "app.py",
                    workspace=target,
                    contains="def broken(:",
                    depends_on=("clone",),
                ),
                _terminal_step(
                    "diagnose",
                    "Diagnose cloned build",
                    command=_shell([sys.executable, "-m", "py_compile", "app.py"]),
                    workspace=target,
                    expected={"exit_code": 1, "output_contains": "SyntaxError"},
                    depends_on=("inspect",),
                ),
                _file_step(
                    "repair",
                    "Repair cloned application",
                    path=target / "app.py",
                    content=repaired,
                    workspace=target,
                    depends_on=("diagnose",),
                ),
                _terminal_step(
                    "build",
                    "Build repaired application",
                    command=_shell([sys.executable, "-m", "py_compile", "app.py"]),
                    workspace=target,
                    expected={"exit_code": 0},
                    depends_on=("repair",),
                ),
                _terminal_step(
                    "start",
                    "Start repaired application",
                    command=_shell([sys.executable, "app.py", str(port)]),
                    workspace=target,
                    expected={"exit_code": 0, "session_id_present": True},
                    depends_on=("build",),
                    background=True,
                ),
                _terminal_step(
                    "verify",
                    "Verify running application",
                    command=_shell([sys.executable, "-c", probe_code]),
                    workspace=target,
                    expected={"exit_code": 0, "output_contains": marker},
                    depends_on=("start",),
                    kind=PlanStepKind.VERIFICATION,
                    timeout=30,
                ),
            ),
        )

        process = HermesProcessController()
        session_id = ""
        try:
            store, submission, ticks, task = _run_plan(definition, root, proposal)
            start = _action_for_title(store, submission.plan.id, "Start repaired application")
            verify = _action_for_title(store, submission.plan.id, "Verify running application")
            session_id = str(start.actual_state.get("session_id") or "") if start else ""
            verified = bool(
                task
                and task.state is TaskState.COMPLETED
                and (target / ".git").is_dir()
                and start
                and start.state is ActionState.SUCCEEDED
                and session_id
                and verify
                and verify.state is ActionState.SUCCEEDED
                and marker in str(verify.actual_state.get("output") or "")
            )
            return _verified_result(
                definition,
                verified=verified,
                evidence={
                    "task_state": task.state.value if task else "MISSING",
                    "git_clone": (target / ".git").is_dir(),
                    "session_id_present": bool(session_id),
                    "verification_output": str(verify.actual_state.get("output") or "")[-2000:]
                    if verify else "",
                    "engine_ticks": [tick.outcome.value for tick in ticks],
                },
                error="repository did not reach a verified running state",
            )
        finally:
            if session_id:
                process.kill(session_id)


def software_handlers():
    return {
        "local_project_analysis": local_project_analysis,
        "build_diagnosis": build_diagnosis,
        "build_repair": build_repair,
        "code_change": code_change,
        "run_tests": run_tests,
        "write_test": write_test,
        "repo_to_running_app": repo_to_running_app,
    }
