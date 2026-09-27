"""Persistent Agent OS agent supervisor and restart reconciliation."""

from __future__ import annotations

from dataclasses import dataclass, field

from .agents.records import AgentInstanceRecord, AgentInstanceState, agent_is_terminal
from .agents.runtime import AgentRuntimeAdapter, RuntimeSnapshot
from .events import EventRecord, EventType
from .store import AgentOSStore


@dataclass(frozen=True, slots=True)
class ReconcileItem:
    agent_id: str
    before: AgentInstanceState
    after: AgentInstanceState
    connected: bool
    restarted: bool = False
    diagnostic: str | None = None


@dataclass(frozen=True, slots=True)
class ReconcileReport:
    items: tuple[ReconcileItem, ...] = field(default_factory=tuple)

    @property
    def restarted(self) -> int:
        return sum(1 for item in self.items if item.restarted)

    @property
    def orphaned(self) -> int:
        return sum(1 for item in self.items if item.after is AgentInstanceState.ORPHANED)


class AgentSupervisor:
    """Own durable launch and reconciliation across runtime/process restarts."""

    def __init__(self, store: AgentOSStore, runtimes: list[AgentRuntimeAdapter]):
        self.store = store
        self.runtimes = {runtime.runtime_name: runtime for runtime in runtimes}

    def prepare_agent(
        self,
        *,
        task_id: str,
        runtime: str,
        goal: str,
        parent_agent_id: str | None = None,
        role: str = "leaf",
        launch_spec: dict | None = None,
        max_restarts: int = 1,
    ) -> AgentInstanceRecord:
        self._runtime(runtime)
        return self.store.create_agent(
            AgentInstanceRecord.create(
                task_id=task_id,
                runtime=runtime,
                goal=goal,
                parent_agent_id=parent_agent_id,
                role=role,
                launch_spec=launch_spec,
                max_restarts=max_restarts,
            )
        )

    def start_agent(self, agent_id: str) -> AgentInstanceRecord:
        agent = self.store.get_agent(agent_id)
        if agent is None:
            raise KeyError(f"unknown agent: {agent_id}")
        if agent.state is not AgentInstanceState.CREATED:
            raise RuntimeError(
                f"agent must be CREATED before initial start: {agent.id} is {agent.state.value}"
            )
        adapter = self._runtime(agent.runtime)
        agent = self.store.transition_agent(agent.id, AgentInstanceState.STARTING)
        try:
            launched = adapter.launch(agent)
            agent = self.store.bind_agent_handle(
                agent.id,
                launched.handle,
                diagnostic=launched.diagnostic,
            )
            if launched.state is not AgentInstanceState.STARTING:
                agent = self.store.transition_agent(
                    agent.id,
                    launched.state,
                    diagnostic=launched.diagnostic,
                )
            return agent
        except Exception as exc:
            return self.store.transition_agent(
                agent.id,
                AgentInstanceState.FAILED,
                error=str(exc),
                diagnostic=f"launch failed: {type(exc).__name__}",
            )

    def launch_agent(
        self,
        *,
        task_id: str,
        runtime: str,
        goal: str,
        parent_agent_id: str | None = None,
        role: str = "leaf",
        launch_spec: dict | None = None,
        max_restarts: int = 1,
    ) -> AgentInstanceRecord:
        agent = self.prepare_agent(
            task_id=task_id,
            runtime=runtime,
            goal=goal,
            parent_agent_id=parent_agent_id,
            role=role,
            launch_spec=launch_spec,
            max_restarts=max_restarts,
        )
        return self.start_agent(agent.id)

    def reconcile_active(self) -> ReconcileReport:
        items = [self._reconcile_one(agent) for agent in self.store.list_agents(active_only=True)]
        return ReconcileReport(tuple(items))

    def _reconcile_one(self, agent: AgentInstanceRecord) -> ReconcileItem:
        before = agent.state
        if agent.state is AgentInstanceState.CREATED:
            return ReconcileItem(
                agent.id,
                before,
                AgentInstanceState.CREATED,
                False,
                diagnostic="PREPARED_NOT_STARTED",
            )
        adapter = self.runtimes.get(agent.runtime)
        if adapter is None:
            updated = self._orphan(
                agent,
                diagnostic=f"runtime adapter unavailable: {agent.runtime}",
                connected=False,
                runtime_state="UNKNOWN_RUNTIME",
                safe_to_restart=False,
            )
            return ReconcileItem(agent.id, before, updated.state, False, diagnostic=updated.diagnostic)

        try:
            snapshot = adapter.inspect(agent)
        except Exception as exc:
            snapshot = RuntimeSnapshot(
                connected=False,
                state=AgentInstanceState.ORPHANED,
                diagnostic=f"runtime inspection failed: {type(exc).__name__}: {exc}",
                safe_to_restart=False,
            )

        self.store.record_agent_reconcile(
            agent.id,
            connected=snapshot.connected,
            runtime_state=snapshot.state.value,
            diagnostic=snapshot.diagnostic,
            safe_to_restart=snapshot.safe_to_restart,
        )
        agent = self.store.get_agent(agent.id) or agent

        if snapshot.connected:
            updated = self._sync_connected(agent, snapshot)
            return ReconcileItem(
                agent.id,
                before,
                updated.state,
                True,
                diagnostic=updated.diagnostic,
            )

        agent = self._orphan(
            agent,
            diagnostic=snapshot.diagnostic,
            connected=False,
            runtime_state=snapshot.state.value,
            safe_to_restart=snapshot.safe_to_restart,
            already_recorded=True,
        )

        if (
            snapshot.safe_to_restart
            and agent.restart_count < agent.max_restarts
            and not agent_is_terminal(agent.state)
        ):
            restarted = self._restart(agent, adapter)
            return ReconcileItem(
                agent.id,
                before,
                restarted.state,
                False,
                restarted=restarted.state in {
                    AgentInstanceState.STARTING,
                    AgentInstanceState.RUNNING,
                },
                diagnostic=restarted.diagnostic,
            )

        return ReconcileItem(
            agent.id,
            before,
            agent.state,
            False,
            diagnostic=agent.diagnostic,
        )

    def _sync_connected(
        self,
        agent: AgentInstanceRecord,
        snapshot: RuntimeSnapshot,
    ) -> AgentInstanceRecord:
        target = snapshot.state
        if target == agent.state:
            return agent

        # Never regress a confirmed live agent from RUNNING back to STARTING
        # because a runtime reported a stale/lagging snapshot.
        if agent.state is AgentInstanceState.RUNNING and target is AgentInstanceState.STARTING:
            return agent

        if agent.state is AgentInstanceState.ORPHANED and target is AgentInstanceState.RUNNING:
            return self.store.transition_agent(
                agent.id,
                AgentInstanceState.RUNNING,
                diagnostic=snapshot.diagnostic,
            )

        return self.store.transition_agent(
            agent.id,
            target,
            result=snapshot.result if snapshot.result else None,
            error=snapshot.error,
            diagnostic=snapshot.diagnostic,
        )

    def _orphan(
        self,
        agent: AgentInstanceRecord,
        *,
        diagnostic: str | None,
        connected: bool,
        runtime_state: str,
        safe_to_restart: bool,
        already_recorded: bool = False,
    ) -> AgentInstanceRecord:
        if not already_recorded:
            self.store.record_agent_reconcile(
                agent.id,
                connected=connected,
                runtime_state=runtime_state,
                diagnostic=diagnostic,
                safe_to_restart=safe_to_restart,
            )
            agent = self.store.get_agent(agent.id) or agent
        if agent.state is AgentInstanceState.ORPHANED:
            return agent
        return self.store.transition_agent(
            agent.id,
            AgentInstanceState.ORPHANED,
            diagnostic=diagnostic,
        )

    def _restart(
        self,
        agent: AgentInstanceRecord,
        adapter: AgentRuntimeAdapter,
    ) -> AgentInstanceRecord:
        agent = self.store.record_agent_restart_attempt(
            agent.id,
            diagnostic=agent.diagnostic,
        )
        agent = self.store.transition_agent(
            agent.id,
            AgentInstanceState.STARTING,
            diagnostic="re-dispatching orphaned agent",
        )
        try:
            launched = adapter.launch(agent)
        except Exception as exc:
            return self.store.transition_agent(
                agent.id,
                AgentInstanceState.ORPHANED,
                error=str(exc),
                diagnostic=f"re-dispatch failed: {type(exc).__name__}",
            )

        agent = self.store.bind_agent_handle(
            agent.id,
            launched.handle,
            diagnostic=launched.diagnostic,
        )
        self.store.append_event(
            EventRecord.create(
                task_id=agent.task_id,
                type=EventType.AGENT_RESTARTED,
                payload={
                    "agent_id": agent.id,
                    "restart_count": agent.restart_count,
                    "runtime": agent.runtime,
                },
            )
        )
        if launched.state is not AgentInstanceState.STARTING:
            agent = self.store.transition_agent(
                agent.id,
                launched.state,
                diagnostic=launched.diagnostic,
            )
        return agent

    def _runtime(self, runtime: str) -> AgentRuntimeAdapter:
        adapter = self.runtimes.get(runtime)
        if adapter is None:
            raise KeyError(f"unknown agent runtime: {runtime}")
        return adapter
