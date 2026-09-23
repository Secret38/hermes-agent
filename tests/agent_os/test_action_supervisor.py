from __future__ import annotations

from agent_os.action_supervisor import ActionSupervisor
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.states import ActionState
from agent_os.store import AgentOSStore


def make_executing(store):
    task = store.create_task(TaskRecord.create("action crash recovery"))
    action = store.create_action(
        ActionRecord.create(
            task.id,
            tool="terminal",
            operation="write something",
        )
    )
    return store.start_action_execution(action.id)


def test_dead_execution_owner_blocks_ambiguous_action(tmp_path, monkeypatch):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_executing(store)
    supervisor = ActionSupervisor(store)
    monkeypatch.setattr(supervisor, "_process_matches", lambda pid, created: False)

    report = supervisor.reconcile_inflight()
    persisted = store.get_action(action.id)

    assert report.blocked == 1
    assert persisted.state is ActionState.BLOCKED
    assert "AMBIGUOUS_SIDE_EFFECT" in persisted.error


def test_live_execution_owner_is_left_untouched(tmp_path, monkeypatch):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_executing(store)
    supervisor = ActionSupervisor(store)
    monkeypatch.setattr(supervisor, "_process_matches", lambda pid, created: True)

    report = supervisor.reconcile_inflight()

    assert report.blocked == 0
    assert store.get_action(action.id).state is ActionState.EXECUTING
