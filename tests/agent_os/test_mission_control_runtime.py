from __future__ import annotations

import threading
import time

import pytest

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.mission_control import MissionApprovalBroker, MissionBusyError, MissionRuntimeService
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
