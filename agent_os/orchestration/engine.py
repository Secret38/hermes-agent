"""Crash-safe durable plan execution engine."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Mapping

from agent_os.action_supervisor import ActionSupervisor
from agent_os.agents.records import AgentInstanceState
from agent_os.contracts import ActionRecord
from agent_os.kernel import AgentOSKernel
from agent_os.states import ActionState
from agent_os.store import AgentOSStore
from agent_os.supervisor import AgentSupervisor
from agent_os.task_supervisor import TaskSupervisor

from .plan import PlanStepKind, PlanStepRecord, PlanStepState
from .scheduler import DurablePlanScheduler


class EngineOutcome(StrEnum):
    ACTION_EXECUTED = "ACTION_EXECUTED"
    AGENT_STARTED = "AGENT_STARTED"
    ACTION_RESUMED = "ACTION_RESUMED"
    AGENT_RESUMED = "AGENT_RESUMED"
    MANUAL_BLOCKED = "MANUAL_BLOCKED"
    CONFIG_BLOCKED = "CONFIG_BLOCKED"
    IDLE = "IDLE"


@dataclass(frozen=True, slots=True)
class EngineTickResult:
    plan_id: str
    outcome: EngineOutcome
    step_id: str | None = None
    execution_id: str | None = None
    detail: str | None = None


class PlanExecutionEngine:
    """Drive a durable plan without starting side effects before persistence.

    New work follows:
      claim step -> persist execution -> bind step -> execute/start.

    On restart, a bound PLANNED action or CREATED agent is resumed from its
    durable record. Ambiguous in-flight actions are never blindly replayed.
    """

    def __init__(
        self,
        store: AgentOSStore,
        *,
        action_kernels: Mapping[str, AgentOSKernel],
        agent_supervisor: AgentSupervisor,
        scheduler: DurablePlanScheduler | None = None,
    ):
        self.store = store
        self.action_kernels = dict(action_kernels)
        self.agent_supervisor = agent_supervisor
        self.scheduler = scheduler or DurablePlanScheduler(store)
        self.task_supervisor = TaskSupervisor(store)
        self.action_supervisor = ActionSupervisor(store)

    def run_once(self, plan_id: str) -> EngineTickResult:
        plan = self.store.get_plan(plan_id)
        if plan is None:
            raise KeyError(f"unknown plan: {plan_id}")

        self.action_supervisor.reconcile_inflight()
        self.agent_supervisor.reconcile_active()

        resumed = self._resume_bound_execution(plan_id)
        if resumed is not None:
            self.task_supervisor.reconcile(plan.task_id, plan_id)
            return resumed

        step = self.scheduler.claim_next(plan_id)
        if step is None:
            self.task_supervisor.reconcile(plan.task_id, plan_id)
            return EngineTickResult(plan_id, EngineOutcome.IDLE)

        try:
            if step.kind in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION}:
                result = self._start_action(step)
            elif step.kind is PlanStepKind.AGENT:
                result = self._start_agent(step)
            else:
                self.store.transition_plan_step(step.id, PlanStepState.BLOCKED)
                result = EngineTickResult(
                    plan_id,
                    EngineOutcome.MANUAL_BLOCKED,
                    step_id=step.id,
                    detail="manual step requires user execution/input",
                )
        except Exception as exc:
            current = self.store.get_plan_step(step.id)
            if current is not None and current.state is PlanStepState.RUNNING:
                self.store.transition_plan_step(step.id, PlanStepState.BLOCKED)
            result = EngineTickResult(
                plan_id,
                EngineOutcome.CONFIG_BLOCKED,
                step_id=step.id,
                detail=f"{type(exc).__name__}: {exc}",
            )

        self.task_supervisor.reconcile(plan.task_id, plan_id)
        return result

    def run_until_idle(
        self,
        plan_id: str,
        *,
        max_ticks: int = 100,
    ) -> tuple[EngineTickResult, ...]:
        if max_ticks < 1:
            raise ValueError("max_ticks must be >= 1")
        results: list[EngineTickResult] = []
        for _ in range(max_ticks):
            result = self.run_once(plan_id)
            results.append(result)
            if result.outcome in {
                EngineOutcome.IDLE,
                EngineOutcome.MANUAL_BLOCKED,
                EngineOutcome.CONFIG_BLOCKED,
            }:
                break
        return tuple(results)

    def _resume_bound_execution(self, plan_id: str) -> EngineTickResult | None:
        for step in self.store.list_plan_steps(plan_id):
            if step.state is not PlanStepState.RUNNING or not step.execution_id:
                continue

            if step.kind in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION}:
                action = self.store.get_action(step.execution_id)
                if action is None:
                    self.store.transition_plan_step(step.id, PlanStepState.BLOCKED)
                    return EngineTickResult(
                        plan_id,
                        EngineOutcome.CONFIG_BLOCKED,
                        step_id=step.id,
                        execution_id=step.execution_id,
                        detail="bound action record is missing",
                    )
                if action.state in {ActionState.PLANNED, ActionState.WAITING_PERMISSION}:
                    kernel = self._kernel(action.tool)
                    result = kernel.execute_action(action.id)
                    return EngineTickResult(
                        plan_id,
                        EngineOutcome.ACTION_RESUMED,
                        step_id=step.id,
                        execution_id=result.id,
                    )

            elif step.kind is PlanStepKind.AGENT:
                agent = self.store.get_agent(step.execution_id)
                if agent is None:
                    self.store.transition_plan_step(step.id, PlanStepState.BLOCKED)
                    return EngineTickResult(
                        plan_id,
                        EngineOutcome.CONFIG_BLOCKED,
                        step_id=step.id,
                        execution_id=step.execution_id,
                        detail="bound agent record is missing",
                    )
                if agent.state is AgentInstanceState.CREATED:
                    started = self.agent_supervisor.start_agent(agent.id)
                    return EngineTickResult(
                        plan_id,
                        EngineOutcome.AGENT_RESUMED,
                        step_id=step.id,
                        execution_id=started.id,
                    )
        return None

    def _start_action(self, step: PlanStepRecord) -> EngineTickResult:
        spec = dict(step.spec or {})
        tool = str(spec.get("tool") or "").strip()
        operation = str(spec.get("operation") or "").strip()
        if not tool or not operation:
            raise ValueError("action step requires spec.tool and spec.operation")

        kernel = self._kernel(tool)
        verification_required = bool(spec.get("verification_required", True))
        if step.kind is PlanStepKind.VERIFICATION:
            verification_required = True

        action = self.store.create_action(
            ActionRecord.create(
                step.task_id,
                tool=tool,
                operation=operation,
                input=dict(spec.get("input") or {}),
                expected_state=dict(spec.get("expected_state") or {}),
                parent_action_id=spec.get("parent_action_id"),
                agent_id=spec.get("agent_id"),
                workspace_id=spec.get("workspace_id"),
                timeout_seconds=spec.get("timeout_seconds"),
                retry_budget=int(spec.get("retry_budget", 0)),
                verification_required=verification_required,
                verification_method=spec.get("verification_method"),
            )
        )
        self.store.bind_plan_step_execution(step.id, action.id)
        result = kernel.execute_action(action.id)
        return EngineTickResult(
            step.plan_id,
            EngineOutcome.ACTION_EXECUTED,
            step_id=step.id,
            execution_id=result.id,
        )

    def _start_agent(self, step: PlanStepRecord) -> EngineTickResult:
        spec = dict(step.spec or {})
        runtime = str(spec.get("runtime") or "").strip()
        if not runtime:
            raise ValueError("agent step requires spec.runtime")
        goal = str(spec.get("goal") or step.title).strip()

        agent = self.agent_supervisor.prepare_agent(
            task_id=step.task_id,
            runtime=runtime,
            goal=goal,
            parent_agent_id=spec.get("parent_agent_id"),
            role=str(spec.get("role") or "leaf"),
            launch_spec=dict(spec.get("launch_spec") or {}),
            max_restarts=int(spec.get("max_restarts", 1)),
        )
        self.store.bind_plan_step_execution(step.id, agent.id)
        started = self.agent_supervisor.start_agent(agent.id)
        return EngineTickResult(
            step.plan_id,
            EngineOutcome.AGENT_STARTED,
            step_id=step.id,
            execution_id=started.id,
        )

    def _kernel(self, tool: str) -> AgentOSKernel:
        kernel = self.action_kernels.get(tool)
        if kernel is None:
            raise KeyError(f"no action kernel registered for tool: {tool}")
        return kernel
