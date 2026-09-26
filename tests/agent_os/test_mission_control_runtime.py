from __future__ import annotations

import threading
import time

import pytest

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.mission_control import (
    MissionApprovalBroker,
    MissionBusyError,
    MissionPausedError,
    MissionRuntimeService,
)
from agent_os.orchestration.plan import PlanRecord, PlanState, PlanStepKind, PlanStepRecord
from agent_os.permissions import PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore


def _ready_task(store: AgentOSStore):
    task = store.create_task(TaskRecord.create("mission control test"))
    store.transition_task(task.id, TaskState.PLANNING)
    return store.transition_task(task.id, TaskState.READY)


def test_mission_approval_auto_allows_low_risk_without_pending_prompt(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = _ready_task(store)
    action = store.create_action(
        ActionRecord.create(task.id, tool="browser", operation="snapshot")
    )
    broker = MissionApprovalBroker(store, timeout_seconds=1)

    decision = broker.authorize(
        action,
        RiskAssessment(RiskLevel.L0_OBSERVE, "read only"),
    )

    assert decision.outcome is PermissionOutcome.ALLOW
    assert broker.pending() == []
    assert store.get_action(action.id).state is ActionState.PLANNED
    assert store.get_task(task.id).state is TaskState.READY


def test_mission_approval_waits_durably_and_resolves_once(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = _ready_task(store)
    action = store.create_action(
        ActionRecord.create(
            task.id,
            tool="terminal",
            operation="write local state",
            input={"command": "echo hello"},
        )
    )
    broker = MissionApprovalBroker(store, timeout_seconds=2)
    result = {}

    def authorize():
        result["decision"] = broker.authorize(
            action,
            RiskAssessment(
                RiskLevel.L2_PERSISTENT_LOCAL,
                "persistent local change",
            ),
        )

    thread = threading.Thread(target=authorize)
    thread.start()
    deadline = time.monotonic() + 1
    pending = []
    while time.monotonic() < deadline:
        pending = broker.pending()
        if pending:
            break
        time.sleep(0.01)

    assert len(pending) == 1
    request = pending[0]
    assert request["action_id"] == action.id
    assert request["risk_level"] == "L2"
    assert store.get_action(action.id).state is ActionState.WAITING_PERMISSION
    assert store.get_task(task.id).state is TaskState.WAITING_FOR_APPROVAL

    assert broker.resolve(request["id"], "allow_once") is True
    assert broker.resolve(request["id"], "deny") is False
    thread.join(timeout=1)

    assert not thread.is_alive()
    assert result["decision"].outcome is PermissionOutcome.ALLOW
    assert broker.pending() == []
    assert any(
        event.type.value == "approval.requested"
        for event in store.list_events(task.id)
    )


def test_mission_approval_deny_is_fail_closed(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = _ready_task(store)
    action = store.create_action(
        ActionRecord.create(task.id, tool="file", operation="write")
    )
    broker = MissionApprovalBroker(store, timeout_seconds=2)
    result = {}

    thread = threading.Thread(
        target=lambda: result.setdefault(
            "decision",
            broker.authorize(
                action,
                RiskAssessment(
                    RiskLevel.L4_DESTRUCTIVE_OR_SENSITIVE,
                    "sensitive operation",
                ),
            ),
        )
    )
    thread.start()

    deadline = time.monotonic() + 1
    request = None
    while time.monotonic() < deadline:
        rows = broker.pending()
        if rows:
            request = rows[0]
            break
        time.sleep(0.01)

    assert request is not None
    assert broker.resolve(request["id"], "deny") is True
    thread.join(timeout=1)

    assert not thread.is_alive()
    assert result["decision"].outcome is PermissionOutcome.DENY


def _durable_interrupted_mission(store: AgentOSStore, *, job_id: str = "mission-restart-test"):
    task = store.create_task(
        TaskRecord.create(
            "resume durable mission",
            metadata={"source": "mission-control", "mission_job_id": job_id},
        )
    )
    store.transition_task(task.id, TaskState.PLANNING)
    store.transition_task(task.id, TaskState.READY)

    plan = PlanRecord.create(task_id=task.id, objective=task.goal)
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="Durable manual checkpoint",
        kind=PlanStepKind.MANUAL,
    )
    store.create_plan(plan, [step])
    store.transition_plan(plan.id, PlanState.ACTIVE)
    return task, plan


def test_mission_service_rehydrates_interrupted_job_without_auto_execution(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task, plan = _durable_interrupted_mission(store)

    service = MissionRuntimeService(store)
    jobs = service.jobs()

    assert service._worker is None
    assert len(jobs) == 1
    assert jobs[0]["id"] == "mission-restart-test"
    assert jobs[0]["task_id"] == task.id
    assert jobs[0]["plan_id"] == plan.id
    assert jobs[0]["state"] == "INTERRUPTED"


def test_mission_service_requires_explicit_resume_for_interrupted_job(tmp_path, monkeypatch):
    store = AgentOSStore(tmp_path / "agent_os.db")
    _durable_interrupted_mission(store)
    service = MissionRuntimeService(store)
    release = threading.Event()

    monkeypatch.setattr(service, "_resume_job", lambda _job_id: release.wait(2))

    resumed = service.resume("mission-restart-test")

    assert resumed["state"] == "RUNNING"
    worker = service._worker
    assert worker is not None and worker.is_alive()

    with pytest.raises(MissionBusyError, match="already running"):
        service.submit("competing mission")

    release.set()
    worker.join(timeout=1)
    assert not worker.is_alive()


def test_mission_service_honors_global_new_work_emergency_stop(tmp_path, monkeypatch):
    from agent import estop

    service = MissionRuntimeService(AgentOSStore(tmp_path / "agent_os.db"))
    monkeypatch.setattr(
        estop,
        "get_state",
        lambda: {"reason": "operator pause", "engaged_at": "2026-09-23T00:00:00+00:00"},
    )

    with pytest.raises(MissionPausedError, match="operator pause"):
        service.submit("must not start")

    task, _plan = _durable_interrupted_mission(
        service.store,
        job_id="paused-resume",
    )
    service._hydrate_jobs()

    with pytest.raises(MissionPausedError, match="operator pause"):
        service.resume("paused-resume")

    assert service.store.get_task(task.id).state is TaskState.READY
    assert service._worker is None


def test_mission_service_serializes_interactive_top_level_missions(tmp_path, monkeypatch):
    service = MissionRuntimeService(
        AgentOSStore(tmp_path / "agent_os.db"),
        approval_timeout_seconds=1,
    )
    release = threading.Event()

    monkeypatch.setattr(service, "_run_job", lambda _job_id: release.wait(2))

    first = service.submit("first mission")

    with pytest.raises(MissionBusyError, match="already running"):
        service.submit("second mission")

    assert first["state"] == "QUEUED"
    worker = service._worker
    assert worker is not None and worker.is_alive()

    release.set()
    worker.join(timeout=1)
    assert not worker.is_alive()


@pytest.mark.parametrize("goal", ["", "   "])
def test_mission_service_rejects_empty_goal(tmp_path, goal):
    service = MissionRuntimeService(AgentOSStore(tmp_path / "agent_os.db"))

    with pytest.raises(ValueError, match="must not be empty"):
        service.submit(goal)