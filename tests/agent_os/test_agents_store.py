from __future__ import annotations

import pytest

from agent_os.agents.records import (
    AgentInstanceRecord,
    AgentInstanceState,
    InvalidAgentTransition,
)
from agent_os.contracts import TaskRecord
from agent_os.events import EventType
from agent_os.store import AgentOSStore, SCHEMA_VERSION


def make_agent(store, *, max_restarts=1):
    task = store.create_task(TaskRecord.create("persistent agent test"))
    return store.create_agent(
        AgentInstanceRecord.create(
            task_id=task.id,
            runtime="hermes-subagent",
            goal="inspect repository",
            launch_spec={"context": "test"},
            max_restarts=max_restarts,
        )
    )


def test_agent_lifecycle_persists_across_store_reopen(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    agent = make_agent(store)
    store.transition_agent(agent.id, AgentInstanceState.STARTING)
    store.bind_agent_handle(agent.id, {"subagent_id": "sa-1"})
    store.transition_agent(agent.id, AgentInstanceState.RUNNING)

    reopened = AgentOSStore(path)
    persisted = reopened.get_agent(agent.id)

    assert persisted is not None
    assert persisted.state is AgentInstanceState.RUNNING
    assert persisted.runtime_handle["subagent_id"] == "sa-1"


def test_orphan_can_restart_but_terminal_agent_cannot(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_agent(store)
    store.transition_agent(agent.id, AgentInstanceState.STARTING)
    store.transition_agent(agent.id, AgentInstanceState.ORPHANED)
    store.transition_agent(agent.id, AgentInstanceState.STARTING)

    store.transition_agent(agent.id, AgentInstanceState.FAILED)
    with pytest.raises(InvalidAgentTransition):
        store.transition_agent(agent.id, AgentInstanceState.STARTING)


def test_restart_binding_increments_restart_count_and_emits_event(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_agent(store)
    store.transition_agent(agent.id, AgentInstanceState.STARTING)
    updated = store.bind_agent_handle(
        agent.id,
        {"subagent_id": "sa-new"},
        restarted=True,
    )

    assert updated.restart_count == 1
    events = store.list_events(agent.task_id)
    assert any(event.type is EventType.AGENT_RESTARTED for event in events)


def test_schema_version_is_migrated_to_agent_schema(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_agent(store)

    assert SCHEMA_VERSION == 2
    assert store.get_agent(agent.id) is not None
