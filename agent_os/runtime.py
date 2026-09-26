"""Agent OS composition root.

The runtime derives its planner/compiler capability fence from the same
registered executors that will later perform side effects. This prevents
configuration drift between "plan-able" and executable capabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping

from .agents.runtime import AgentRuntimeAdapter
from .capabilities import CapabilityCatalog
from .kernel import AgentOSKernel
from .orchestration.engine import EngineTickResult, PlanExecutionEngine
from .orchestration.goal_orchestrator import GoalOrchestrator, GoalSubmission
from .orchestration.planner import PlanCompiler, Planner
from .orchestration.scheduler import DurablePlanScheduler
from .store import AgentOSStore
from .supervisor import AgentSupervisor


@dataclass(frozen=True, slots=True)
class RuntimeStatus:
    action_tools: tuple[str, ...]
    agent_runtimes: tuple[str, ...]


class AgentOSRuntime:
    """Wire goal intake, capability fencing and execution around one store."""

    def __init__(
        self,
        store: AgentOSStore,
        *,
        planner: Planner,
        action_kernels: Mapping[str, AgentOSKernel],
        agent_runtime_adapters: Iterable[AgentRuntimeAdapter] = (),
        scheduler_owner_id: str | None = None,
        scheduler_lease_seconds: float = 60.0,
    ):
        kernels = {
            str(name).strip(): kernel
            for name, kernel in action_kernels.items()
            if str(name).strip()
        }
        if len(kernels) != len(action_kernels):
            raise ValueError("action kernel names must be non-empty and unique")

        adapters = list(agent_runtime_adapters)
        runtime_names = [str(adapter.runtime_name).strip() for adapter in adapters]
        if len(runtime_names) != len(set(runtime_names)):
            raise ValueError("agent runtime names must be unique")

        self.store = store
        self.capabilities = CapabilityCatalog.from_execution(
            action_kernels=kernels,
            agent_runtime_adapters=adapters,
        )
        self.agent_supervisor = AgentSupervisor(store, adapters)
        self.compiler = PlanCompiler(
            store,
            allowed_action_tools=set(self.capabilities.action_tools),
            allowed_agent_runtimes=set(self.capabilities.agent_runtimes),
        )
        self.goal_orchestrator = GoalOrchestrator(
            store,
            planner,
            compiler=self.compiler,
        )
        self.scheduler = DurablePlanScheduler(
            store,
            owner_id=scheduler_owner_id,
            lease_seconds=scheduler_lease_seconds,
        )
        self.engine = PlanExecutionEngine(
            store,
            action_kernels=kernels,
            agent_supervisor=self.agent_supervisor,
            scheduler=self.scheduler,
        )

        planner_capabilities = getattr(planner, "capabilities", None)
        if planner_capabilities is not None:
            planned_tools = frozenset(
                getattr(planner_capabilities, "action_tools", ()) or ()
            )
            planned_runtimes = frozenset(
                getattr(planner_capabilities, "agent_runtimes", ()) or ()
            )
            if planned_tools != self.capabilities.action_tools:
                raise ValueError(
                    "planner action-tool catalog does not match runtime registry"
                )
            if planned_runtimes != self.capabilities.agent_runtimes:
                raise ValueError(
                    "planner agent-runtime catalog does not match runtime registry"
                )

    def submit_goal(
        self,
        goal: str,
        *,
        metadata: dict | None = None,
        session_id: str | None = None,
        workspace_id: str | None = None,
    ) -> GoalSubmission:
        return self.goal_orchestrator.submit(
            goal,
            metadata=metadata,
            session_id=session_id,
            workspace_id=workspace_id,
        )

    def run_once(self, plan_id: str) -> EngineTickResult:
        return self.engine.run_once(plan_id)

    def run_until_idle(
        self,
        plan_id: str,
        *,
        max_ticks: int = 100,
    ) -> tuple[EngineTickResult, ...]:
        return self.engine.run_until_idle(plan_id, max_ticks=max_ticks)

    def status(self) -> RuntimeStatus:
        return RuntimeStatus(
            action_tools=tuple(sorted(self.capabilities.action_tools)),
            agent_runtimes=tuple(sorted(self.capabilities.agent_runtimes)),
        )
