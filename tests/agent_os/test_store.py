from __future__ import annotations

import sqlite3

import pytest

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.events import EventType
from agent_os.states import ActionState, InvalidTransition, TaskState
from agent_os.store import AgentOSStore, SCHEMA_VERSION


def test_store_persists_task_action_and_ordered_events(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)

    task = store.create_task(TaskRecord.create("Bring repository to a verified running state"))
    store.transition_task(task.id, TaskState.INTERPRETING)
    store.transition_task(task.id, TaskState.PLANNING)
    store.transition_task(task.id, TaskState.READY)
    store.transition_task(task.id, TaskState.RUNNING)

    action = store.create_action(
        ActionRecord.create(
            task.id,
            tool="terminal",
            operation="pytest",
            expected_state={"exit_code": 0},
            retry_budget=2,
        )
    )
    store.transition_action(action.id, ActionState.EXECUTING)
    store.transition_action(action.id, ActionState.OBSERVING, actual_state={"exit_code": 0})
    store.transition_action(action.id, ActionState.VERIFYING)
    store.transition_action(
        action.id,
        ActionState.SUCCEEDED,
        verification_result={"passed": True},
    )
    store.transition_task(task.id, TaskState.VERIFYING)
    store.transition_task(task.id, TaskState.COMPLETED)

    # A new store instance proves durability across process/runtime reconstruction.
    reopened = AgentOSStore(path)
    assert reopened.get_task(task.id).state is TaskState.COMPLETED
    assert reopened.get_action(action.id).state is ActionState.SUCCEEDED

    events = reopened.list_events(task.id)
    assert events[0].type is EventType.TASK_CREATED
    assert events[-1].payload["to"] == TaskState.COMPLETED.value
    assert [event.created_at for event in events] == sorted(event.created_at for event in events)


def test_store_rejects_invalid_transition_without_event(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("test invalid completion"))
    before = list(store.list_events(task.id))

    with pytest.raises(InvalidTransition):
        store.transition_task(task.id, TaskState.COMPLETED)

    after = store.list_events(task.id)
    assert after == before
    assert store.get_task(task.id).state is TaskState.CREATED


def test_schema_version_and_wal_are_initialized(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    store.create_task(TaskRecord.create("initialize database"))

    conn = sqlite3.connect(path)
    try:
        assert conn.execute("SELECT value FROM meta WHERE key='schema_version'").fetchone()[0] == str(SCHEMA_VERSION)
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 0  # per-connection pragma, not persisted
    finally:
        conn.close()
