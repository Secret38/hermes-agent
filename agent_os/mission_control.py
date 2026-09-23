"""Interactive Mission Control intake and approval service.

This module bridges the durable Agent OS runtime into the desktop control plane
without weakening the kernel's risk/verification invariants. Planning and
execution run on a daemon worker; L2+ actions block on an explicit one-shot
approval resolved by Mission Control.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from agent_os.contracts import ActionRecord, new_id, utc_now_iso
from agent_os.events import EventRecord, EventType
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore


class MissionBusyError(RuntimeError):
    """Raised when an interactive mission is already driving the desktop."""


class MissionJobState(StrEnum):
    QUEUED = "QUEUED"
    PLANNING = "PLANNING"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    COMPLETED = "COMPLETED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"


@dataclass(slots=True)
class MissionJob:
    id: str
    goal: str
    workspace_id: str | None = None
    session_id: str | None = None
    state: MissionJobState = MissionJobState.QUEUED
    task_id: str | None = None
    plan_id: str | None = None
    error: str | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "goal": self.goal,
            "workspace_id": self.workspace_id,
            "session_id": self.session_id,
            "state": self.state.value,
            "task_id": self.task_id,
            "plan_id": self.plan_id,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


@dataclass(slots=True)
class PendingMissionApproval:
    id: str
    task_id: str
    action_id: str
    tool: str
    operation: str
    risk_level: str
    reason: str
    target: str
    requested_at: str = field(default_factory=utc_now_iso)
    choice: str | None = None
    _event: threading.Event = field(default_factory=threading.Event, repr=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "task_id": self.task_id,
            "action_id": self.action_id,
            "tool": self.tool,
            "operation": self.operation,
            "risk_level": self.risk_level,
            "reason": self.reason,
            "target": self.target,
            "requested_at": self.requested_at,
        }


class MissionApprovalBroker:
    """Permission gate backed by explicit Mission Control decisions.

    Only allow-once and deny are exposed. Persistent/session grants are
    deliberately excluded until they have a durable policy store of their own.
    """

    def __init__(
        self,
        store: AgentOSStore,
        *,
        timeout_seconds: float = 900.0,
    ):
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be > 0")
        self.store = store
        self.timeout_seconds = float(timeout_seconds)
        self._lock = threading.RLock()
        self._pending: dict[str, PendingMissionApproval] = {}

    def authorize(
        self,
        action: ActionRecord,
        risk: RiskAssessment,
    ) -> PermissionDecision:
        if risk.level in {RiskLevel.L0_OBSERVE, RiskLevel.L1_REVERSIBLE}:
            return PermissionDecision(
                PermissionOutcome.ALLOW,
                decided_by=type(self).__name__,
                reason=f"{risk.level.value} auto-approved by Mission Control",
            )

        request = PendingMissionApproval(
            id=new_id("approval"),
            task_id=action.task_id,
            action_id=action.id,
            tool=action.tool,
            operation=action.operation,
            risk_level=risk.level.value,
            reason=risk.reason,
            target=self._display_target(action),
        )

        current_action = self.store.get_action(action.id)
        if current_action is not None and current_action.state is ActionState.PLANNED:
            self.store.transition_action(
                action.id,
                ActionState.WAITING_PERMISSION,
                payload={"approval_request_id": request.id},
            )

        current_task = self.store.get_task(action.task_id)
        if current_task is not None and current_task.state in {
            TaskState.READY,
            TaskState.RUNNING,
        }:
            self.store.transition_task(
                action.task_id,
                TaskState.WAITING_FOR_APPROVAL,
                payload={
                    "approval_request_id": request.id,
                    "action_id": action.id,
                },
            )

        self.store.append_event(
            EventRecord.create(
                task_id=action.task_id,
                action_id=action.id,
                type=EventType.APPROVAL_REQUESTED,
                payload={
                    "request_id": request.id,
                    "risk_level": request.risk_level,
                    "reason": request.reason,
                    "tool": request.tool,
                    "operation": request.operation,
                    "target": request.target,
                    "allow_session": False,
                    "allow_permanent": False,
                },
            )
        )

        with self._lock:
            self._pending[request.id] = request

        answered = request._event.wait(self.timeout_seconds)
        with self._lock:
            self._pending.pop(request.id, None)

        if not answered:
            return PermissionDecision(
                PermissionOutcome.DENY,
                decided_by=type(self).__name__,
                reason="Mission Control approval timed out",
            )

        allowed = request.choice == "allow_once"
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=(
                "Mission Control approved once"
                if allowed
                else "Mission Control denied this action"
            ),
            scope="once",
        )

    def pending(self) -> list[dict[str, Any]]:
        with self._lock:
            requests = sorted(
                self._pending.values(),
                key=lambda item: (item.requested_at, item.id),
            )
            return [request.to_dict() for request in requests]

    def resolve(self, request_id: str, choice: str) -> bool:
        if choice not in {"allow_once", "deny"}:
            raise ValueError("choice must be allow_once or deny")
        with self._lock:
            request = self._pending.get(str(request_id))
            if request is None or request._event.is_set():
                return False
            request.choice = choice
            request._event.set()
            return True

    @staticmethod
    def _display_target(action: ActionRecord) -> str:
        raw = action.input.get("command") if isinstance(action.input, dict) else None
        value = (
            raw
            if isinstance(raw, str) and raw.strip()
            else f"{action.tool}:{action.operation}"
        )
        try:
            from agent.redact import redact_sensitive_text

            return redact_sensitive_text(str(value), force=True)
        except Exception:
            return f"{action.tool}:{action.operation}"


class MissionRuntimeService:
    """Single-interactive-mission desktop service around AgentOSRuntime.

    Serial execution is intentional: native computer-use is a shared interactive
    desktop, so two independent top-level missions must not race the same mouse,
    keyboard or foreground window.
    """

    def __init__(
        self,
        store: AgentOSStore | None = None,
        *,
        approval_timeout_seconds: float = 900.0,
    ):
        self.store = store or AgentOSStore()
        self.approvals = MissionApprovalBroker(
            self.store,
            timeout_seconds=approval_timeout_seconds,
        )
        self._lock = threading.RLock()
        self._jobs: dict[str, MissionJob] = {}
        self._worker: threading.Thread | None = None

    def submit(
        self,
        goal: str,
        *,
        workspace_id: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        goal = str(goal or "").strip()
        if not goal:
            raise ValueError("goal must not be empty")
        if len(goal) > 16_000:
            raise ValueError("goal must be at most 16000 characters")

        workspace = str(workspace_id or "").strip() or None
        session = str(session_id or "").strip() or None
        if workspace is not None and len(workspace) > 4096:
            raise ValueError("workspace_id is too long")
        if session is not None and len(session) > 512:
            raise ValueError("session_id is too long")

        with self._lock:
            if self._worker is not None and self._worker.is_alive():
                raise MissionBusyError(
                    "Another interactive Agent OS mission is already running."
                )
            job = MissionJob(
                id=new_id("mission"),
                goal=goal,
                workspace_id=workspace,
                session_id=session,
            )
            self._jobs[job.id] = job
            worker = threading.Thread(
                target=self._run_job,
                args=(job.id,),
                daemon=True,
                name=f"agent-os-mission-{job.id[-8:]}",
            )
            self._worker = worker
            worker.start()
            return job.to_dict()

    def jobs(self, *, limit: int = 20) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 100))
        with self._lock:
            jobs = sorted(
                self._jobs.values(),
                key=lambda item: (item.created_at, item.id),
                reverse=True,
            )[:limit]
            return [self._with_live_state(job) for job in jobs]

    def _with_live_state(self, job: MissionJob) -> dict[str, Any]:
        data = job.to_dict()
        if not job.task_id:
            return data
        task = self.store.get_task(job.task_id)
        if task is None:
            return data
        if task.state is TaskState.WAITING_FOR_APPROVAL:
            data["state"] = MissionJobState.WAITING_APPROVAL.value
        elif task.state is TaskState.COMPLETED:
            data["state"] = MissionJobState.COMPLETED.value
        elif task.state is TaskState.FAILED:
            data["state"] = MissionJobState.FAILED.value
        elif task.state is TaskState.BLOCKED:
            data["state"] = MissionJobState.BLOCKED.value
        return data

    def _set_job(
        self,
        job_id: str,
        *,
        state: MissionJobState | None = None,
        task_id: str | None = None,
        plan_id: str | None = None,
        error: str | None = None,
    ) -> MissionJob:
        with self._lock:
            job = self._jobs[job_id]
            if state is not None:
                job.state = state
            if task_id is not None:
                job.task_id = task_id
            if plan_id is not None:
                job.plan_id = plan_id
            job.error = error
            job.updated_at = utc_now_iso()
            return job

    def _run_job(self, job_id: str) -> None:
        job = self._set_job(job_id, state=MissionJobState.PLANNING)
        try:
            from agent_os.hermes_runtime import build_hermes_agent_os_runtime

            runtime = build_hermes_agent_os_runtime(
                self.store,
                permission_gate=self.approvals,
                host_local_terminal=True,
                scheduler_owner_id=f"mission-control:{job_id}",
            )
            submission = runtime.submit_goal(
                job.goal,
                workspace_id=job.workspace_id,
                session_id=job.session_id,
                metadata={
                    "source": "mission-control",
                    "mission_job_id": job_id,
                },
            )
            self._set_job(
                job_id,
                state=MissionJobState.RUNNING,
                task_id=submission.task.id,
                plan_id=submission.plan.id,
            )
            runtime.run_until_idle(submission.plan.id, max_ticks=256)

            task = self.store.get_task(submission.task.id)
            state = {
                TaskState.COMPLETED: MissionJobState.COMPLETED,
                TaskState.FAILED: MissionJobState.FAILED,
                TaskState.BLOCKED: MissionJobState.BLOCKED,
                TaskState.WAITING_FOR_APPROVAL: MissionJobState.WAITING_APPROVAL,
            }.get(
                task.state if task is not None else None,
                MissionJobState.BLOCKED,
            )
            self._set_job(job_id, state=state)
        except Exception as exc:
            self._set_job(
                job_id,
                state=MissionJobState.FAILED,
                error=f"{type(exc).__name__}: {exc}",
            )
        finally:
            with self._lock:
                if self._worker is threading.current_thread():
                    self._worker = None
