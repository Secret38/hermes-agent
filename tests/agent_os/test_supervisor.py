from __future__ import annotations

from dataclasses import dataclass

from agent_os.agents.records import AgentInstanceRecord, AgentInstanceState
from agent_os.agents.runtime import RuntimeLaunch, RuntimeSnapshot
from agent_os.contracts import TaskRecord
from agent_os.store import AgentOSStore
from agent_os.supervisor import AgentSupervisor


class FakeRuntime:
    runtime_name = "fake"

    def __init__(self, *, snapshot=None, launch_state=AgentInstanceState.RUNNING):
        self.snapshot = snapshot
        self.launch_state = launch_state
        self.launches = 0

    def launch(self, agent):
        self.launches += 1
        return RuntimeLaunch(
            {"generation": self.launches},
            state=self.launch_state,
        )

    def inspect(self, agent):
        return self.snapshot


def make_running_agent(store, *, max_restarts=1):
    task = store.create_task(TaskRecord.create("supervisor test"))
    agent = store.create_agent(
        AgentInstanceRecord.create(
            task_id=task.id,
            runtime="fake",
            goal="do work",
            max_restarts=max_restarts,
        )
    )
    agent = store.transition_agent(agent.id, AgentInstanceState.STARTING)
    agent = store.bind_agent_handle(agent.id, {"generation": 0})
    return store.transition_agent(agent.id, AgentInstanceState.RUNNING)


def test_launch_agent_persists_runtime_handle(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("launch"))
    runtime = FakeRuntime()
    supervisor = AgentSupervisor(store, [runtime])

    agent = supervisor.launch_agent(
        task_id=task.id,
        runtime="fake",
        goal="work",
    )

    assert agent.state is AgentInstanceState.RUNNING
    assert agent.runtime_handle == {"generation": 1}


def test_reconcile_terminal_result(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_running_agent(store)
    runtime = FakeRuntime(
        snapshot=RuntimeSnapshot(
            True,
            AgentInstanceState.SUCCEEDED,
            result={"summary": "done"},
        )
    )

    report = AgentSupervisor(store, [runtime]).reconcile_active()
    persisted = store.get_agent(agent.id)

    assert report.items[0].after is AgentInstanceState.SUCCEEDED
    assert persisted.result["summary"] == "done"


def test_live_foreign_owner_orphan_is_not_restarted(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_running_agent(store)
    runtime = FakeRuntime(
        snapshot=RuntimeSnapshot(
            False,
            AgentInstanceState.ORPHANED,
            diagnostic="OWNER_PROCESS_STILL_ALIVE",
            safe_to_restart=False,
        )
    )

    report = AgentSupervisor(store, [runtime]).reconcile_active()

    assert report.restarted == 0
    assert store.get_agent(agent.id).state is AgentInstanceState.ORPHANED
    assert runtime.launches == 0


def test_dead_owner_is_redispatched_with_bounded_budget(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_running_agent(store, max_restarts=1)
    runtime = FakeRuntime(
        snapshot=RuntimeSnapshot(
            False,
            AgentInstanceState.ORPHANED,
            diagnostic="OWNER_PROCESS_GONE",
            safe_to_restart=True,
        )
    )

    report = AgentSupervisor(store, [runtime]).reconcile_active()
    persisted = store.get_agent(agent.id)

    assert report.restarted == 1
    assert persisted.state is AgentInstanceState.RUNNING
    assert persisted.restart_count == 1
    assert runtime.launches == 1

    runtime.snapshot = RuntimeSnapshot(
        False,
        AgentInstanceState.ORPHANED,
        diagnostic="OWNER_PROCESS_GONE",
        safe_to_restart=True,
    )
    AgentSupervisor(store, [runtime]).reconcile_active()
    assert store.get_agent(agent.id).restart_count == 1
    assert runtime.launches == 1


def test_running_agent_does_not_regress_on_stale_starting_snapshot(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    agent = make_running_agent(store)
    runtime = FakeRuntime(
        snapshot=RuntimeSnapshot(True, AgentInstanceState.STARTING)
    )

    AgentSupervisor(store, [runtime]).reconcile_active()

    assert store.get_agent(agent.id).state is AgentInstanceState.RUNNING
