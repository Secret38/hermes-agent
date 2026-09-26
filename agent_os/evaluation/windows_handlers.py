"""Native Windows Golden Task handlers for Agent OS."""

from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from agent_os.adapters.hermes_computer import (
    HermesComputerUseExecutor,
    computer_use_available,
)
from agent_os.capabilities import CapabilityCatalog
from agent_os.hermes_runtime import build_hermes_agent_os_runtime
from agent_os.orchestration.plan import PlanStepKind
from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore

from .golden import GoldenTaskDefinition, GoldenTaskOutcome, GoldenTaskResult


_NOTEPAD_MARKER = "AGENT_OS_UI_GT13"


class _WindowsPlanner:
    def __init__(self, proposal: PlanProposal):
        self.proposal = proposal
        self.capabilities = CapabilityCatalog.create(
            action_tools=("terminal", "file", "computer_use"),
        )

    def plan(self, task):
        return self.proposal


class _NoopCheckpoint:
    def create_checkpoint(self, action):
        return None

    def rollback(self, checkpoint_id):
        return False


class _BenchmarkGate:
    """Allow local disposable Windows UI benchmark actions through L2."""

    def authorize(
        self,
        action,
        risk: RiskAssessment,
    ) -> PermissionDecision:
        allowed = risk.level in {
            RiskLevel.L0_OBSERVE,
            RiskLevel.L1_REVERSIBLE,
            RiskLevel.L2_PERSISTENT_LOCAL,
        }
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=(
                "local deterministic Windows benchmark"
                if allowed
                else "external or sensitive action denied"
            ),
        )


def _shell(args: list[str]) -> str:
    return subprocess.list2cmdline(args) if os.name == "nt" else shlex.join(args)


def _terminal_step(
    key: str,
    title: str,
    *,
    command: str,
    workspace: Path,
    expected: dict[str, Any],
    depends_on: tuple[str, ...] = (),
) -> ProposedStep:
    return ProposedStep(
        key,
        title,
        PlanStepKind.ACTION,
        spec={
            "tool": "terminal",
            "operation": title.lower(),
            "input": {
                "command": command,
                "workdir": str(workspace),
            },
            "expected_state": dict(expected),
            "workspace_id": str(workspace),
            "verification_required": True,
        },
        depends_on=depends_on,
    )


def _computer_step(
    key: str,
    title: str,
    operation: str,
    *,
    input: dict[str, Any],
    expected: dict[str, Any],
    workspace: Path,
    depends_on: tuple[str, ...] = (),
    kind: PlanStepKind = PlanStepKind.ACTION,
) -> ProposedStep:
    payload = dict(input)
    payload.setdefault("action", operation)
    return ProposedStep(
        key,
        title,
        kind,
        spec={
            "tool": "computer_use",
            "operation": operation,
            "input": payload,
            "expected_state": dict(expected),
            "workspace_id": str(workspace),
            "verification_required": True,
            "retry_budget": 0,
        },
        depends_on=depends_on,
    )


def _launch_notepad_command() -> str:
    script = (
        "$ErrorActionPreference='Stop';"
        "Start-Process -FilePath 'notepad.exe' | Out-Null;"
        "$p=$null;"
        "for($i=0;$i -lt 100;$i++){"
        " Start-Sleep -Milliseconds 100;"
        " $p=Get-Process -Name notepad -ErrorAction SilentlyContinue |"
        " Sort-Object StartTime -Descending | Select-Object -First 1;"
        " if($p -and $p.MainWindowHandle -ne 0){break};"
        "};"
        "if(-not $p -or $p.MainWindowHandle -eq 0){"
        " Write-Error 'Notepad window did not become ready'; exit 1"
        "};"
        "Write-Output ('NOTEPAD_READY:' + $p.Id)"
    )
    return _shell([
        "powershell.exe",
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
    ])


def _run(
    definition: GoldenTaskDefinition,
    root: Path,
    proposal: PlanProposal,
):
    store = AgentOSStore(root / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=_WindowsPlanner(proposal),
        permission_gate=_BenchmarkGate(),
        checkpoint_provider=_NoopCheckpoint(),
        enable_browser=False,
        enable_computer_use=True,
        host_local_terminal=True,
        scheduler_owner_id=f"golden-{definition.id}",
    )
    submission = runtime.submit_goal(definition.goal)
    try:
        ticks = runtime.run_until_idle(submission.plan.id, max_ticks=50)
        task = store.get_task(submission.task.id)
        return store, submission, ticks, task
    finally:
        HermesComputerUseExecutor.cleanup(submission.task.id)


def _action_for_title(store: AgentOSStore, plan_id: str, title: str):
    for step in store.list_plan_steps(plan_id):
        if step.title == title and step.execution_id:
            return store.get_action(step.execution_id)
    return None


def _notepad_pid(store: AgentOSStore, plan_id: str) -> int | None:
    action = _action_for_title(store, plan_id, "Launch Notepad")
    output = str(action.actual_state.get("output") or "") if action else ""
    match = re.search(r"NOTEPAD_READY:(\d+)", output)
    return int(match.group(1)) if match else None


def _cleanup_notepad(pid: int | None) -> None:
    if sys.platform != "win32" or pid is None:
        return
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
        timeout=10,
    )


def _preflight(definition: GoldenTaskDefinition) -> GoldenTaskResult | None:
    if sys.platform != "win32":
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.BLOCKED,
            verified=False,
            error="native Windows host is required",
        )
    if shutil.which("notepad.exe") is None:
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.BLOCKED,
            verified=False,
            error="notepad.exe is unavailable on this Windows host",
        )
    if not computer_use_available():
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.BLOCKED,
            verified=False,
            error="real Hermes computer-use runtime is unavailable",
        )
    return None


def windows_app_launch(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    if blocked := _preflight(definition):
        return blocked

    with TemporaryDirectory(prefix="agent-os-gt12-") as temp:
        root = Path(temp)
        proposal = PlanProposal(
            objective="launch Notepad and verify its native Windows window through computer use",
            steps=(
                _terminal_step(
                    "launch",
                    "Launch Notepad",
                    command=_launch_notepad_command(),
                    workspace=root,
                    expected={"exit_code": 0, "output_contains": "NOTEPAD_READY:"},
                ),
                _computer_step(
                    "verify-window",
                    "Verify Notepad window",
                    "list_windows",
                    input={},
                    expected={"window_present": "Notepad"},
                    workspace=root,
                    depends_on=("launch",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        pid = None
        try:
            store, submission, ticks, task = _run(definition, root, proposal)
            pid = _notepad_pid(store, submission.plan.id)
            verify = _action_for_title(store, submission.plan.id, "Verify Notepad window")
            verified = bool(
                task
                and task.state is TaskState.COMPLETED
                and pid
                and verify
                and verify.state is ActionState.SUCCEEDED
            )
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
                verified=verified,
                evidence={
                    "task_state": task.state.value if task else "MISSING",
                    "pid_observed": bool(pid),
                    "verification_state": verify.state.value if verify else "MISSING",
                    "engine_ticks": [tick.outcome.value for tick in ticks],
                },
                error=None if verified else "Notepad was not verified as an active native window",
            )
        finally:
            _cleanup_notepad(pid)


def windows_ui_action(definition: GoldenTaskDefinition) -> GoldenTaskResult:
    if blocked := _preflight(definition):
        return blocked

    with TemporaryDirectory(prefix="agent-os-gt13-") as temp:
        root = Path(temp)
        proposal = PlanProposal(
            objective="type a marker into Notepad and verify the resulting accessibility state",
            steps=(
                _terminal_step(
                    "launch",
                    "Launch Notepad",
                    command=_launch_notepad_command(),
                    workspace=root,
                    expected={"exit_code": 0, "output_contains": "NOTEPAD_READY:"},
                ),
                _computer_step(
                    "capture",
                    "Capture Notepad target",
                    "capture",
                    input={"mode": "ax", "app": "Notepad"},
                    expected={
                        "capture_app": "Notepad",
                        "capture_contains": "Notepad",
                    },
                    workspace=root,
                    depends_on=("launch",),
                ),
                _computer_step(
                    "type",
                    "Type marker into Notepad",
                    "type",
                    input={
                        "app": "Notepad",
                        "text": _NOTEPAD_MARKER,
                        "delivery_mode": "background",
                    },
                    expected={
                        "capture_app": "Notepad",
                        "capture_mode": "ax",
                        "capture_contains": _NOTEPAD_MARKER,
                    },
                    workspace=root,
                    depends_on=("capture",),
                ),
                _computer_step(
                    "verify",
                    "Verify Notepad marker",
                    "capture",
                    input={"mode": "ax", "app": "Notepad"},
                    expected={
                        "capture_app": "Notepad",
                        "capture_contains": _NOTEPAD_MARKER,
                    },
                    workspace=root,
                    depends_on=("type",),
                    kind=PlanStepKind.VERIFICATION,
                ),
            ),
        )
        pid = None
        try:
            store, submission, ticks, task = _run(definition, root, proposal)
            pid = _notepad_pid(store, submission.plan.id)
            typed = _action_for_title(store, submission.plan.id, "Type marker into Notepad")
            verify = _action_for_title(store, submission.plan.id, "Verify Notepad marker")
            verified = bool(
                task
                and task.state is TaskState.COMPLETED
                and pid
                and typed
                and typed.state is ActionState.SUCCEEDED
                and verify
                and verify.state is ActionState.SUCCEEDED
            )
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
                verified=verified,
                evidence={
                    "task_state": task.state.value if task else "MISSING",
                    "pid_observed": bool(pid),
                    "type_state": typed.state.value if typed else "MISSING",
                    "verification_state": verify.state.value if verify else "MISSING",
                    "engine_ticks": [tick.outcome.value for tick in ticks],
                },
                error=None if verified else "Notepad marker was not verified in fresh UI state",
            )
        finally:
            _cleanup_notepad(pid)


def windows_handlers():
    return {
        "windows_app_launch": windows_app_launch,
        "windows_ui_action": windows_ui_action,
    }
