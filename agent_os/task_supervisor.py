"""Task-level reconciliation across plan, action and agent state."""

from __future__ import annotations

from dataclasses import dataclass

from .agents.records import AgentInstanceState
from .orchestration.plan import (
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    PlanStepState,
)
from .orchestration.scheduler import DurablePlanScheduler
from .states import ActionState, TaskState, task_is_terminal
from .store import AgentOSStore


@dataclass(frozen=True, slots=True)
class TaskReconcileResult:
    task_id: str
    plan_id: str
    task_state: TaskState
    plan_state: PlanState
    needs_verification: bool = False
    synced_steps: int = 0


class TaskSupervisor:
    """Derive canonical task progress from real bound executions."""

    def __init__(self, store: AgentOSStore):
        self.store = store
        self.scheduler = DurablePlanScheduler(store)

    def reconcile(self, task_id: str, plan_id: str) -> TaskReconcileResult:
        task = self.store.get_task(task_id)
        plan = self.store.get_plan(plan_id)
        if task is None:
            raise KeyError(f"unknown task: {task_id}")
        if plan is None or plan.task_id != task_id:
            raise KeyError(f"unknown plan for task: {plan_id}")

        synced = 0
        for step in self.store.list_plan_steps(plan_id):
            if step.state is not PlanStepState.RUNNING or not step.execution_id:
                continue
            target = self._execution_state(step)
            if target is not None and target is not step.state:
                self.store.transition_plan_step(step.id, target)
                synced += 1

        self.scheduler.tick(plan_id)
        plan = self.store.get_plan(plan_id)
        task = self.store.get_task(task_id)
        assert plan is not None and task is not None

        if task_is_terminal(task.state):
            return TaskReconcileResult(
                task_id, plan_id, task.state, plan.state, synced_steps=synced
            )

        steps = self.store.list_plan_steps(plan_id)

        if plan.state is PlanState.FAILED:
            task = self._move_task(task.state, task_id, TaskState.FAILED)
            return TaskReconcileResult(
                task_id, plan_id, task.state, plan.state, synced_steps=synced
            )

        waiting_approval = any(self._execution_waiting_approval(step) for step in steps)
        if waiting_approval:
            task = self._move_task(task.state, task_id, TaskState.WAITING_FOR_APPROVAL)
            return TaskReconcileResult(
                task_id, plan_id, task.state, plan.state, synced_steps=synced
            )

        if plan.state is PlanState.COMPLETED:
            verification_steps = [
                step for step in steps if step.kind is PlanStepKind.VERIFICATION
            ]
            verified = bool(verification_steps) and all(
                step.state is PlanStepState.SUCCEEDED for step in verification_steps
            )
            if not verified:
                task = self._move_task(task.state, task_id, TaskState.VERIFYING)
                return TaskReconcileResult(
                    task_id,
                    plan_id,
                    task.state,
                    plan.state,
                    needs_verification=True,
                    synced_steps=synced,
                )
            task = self._move_task(task.state, task_id, TaskState.COMPLETED)
            return TaskReconcileResult(
                task_id, plan_id, task.state, plan.state, synced_steps=synced
            )

        if any(step.state is PlanStepState.BLOCKED for step in steps) and not any(
            step.state in {PlanStepState.READY, PlanStepState.RUNNING}
            for step in steps
        ):
            task = self._move_task(task.state, task_id, TaskState.BLOCKED)
        elif plan.state is PlanState.ACTIVE and any(
            step.state in {PlanStepState.READY, PlanStepState.RUNNING}
            for step in steps
        ):
            task = self._move_task(task.state, task_id, TaskState.RUNNING)

        return TaskReconcileResult(
            task_id, plan_id, task.state, plan.state, synced_steps=synced
        )

    def _execution_state(self, step: PlanStepRecord) -> PlanStepState | None:
        if step.kind in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION}:
            action = self.store.get_action(step.execution_id or "")
            if action is None:
                return PlanStepState.BLOCKED
            return {
                ActionState.SUCCEEDED: PlanStepState.SUCCEEDED,
                ActionState.FAILED: PlanStepState.FAILED,
                ActionState.CANCELLED: PlanStepState.CANCELLED,
                ActionState.BLOCKED: PlanStepState.BLOCKED,
            }.get(action.state)

        if step.kind is PlanStepKind.AGENT:
            agent = self.store.get_agent(step.execution_id or "")
            if agent is None:
                return PlanStepState.BLOCKED
            return {
                AgentInstanceState.SUCCEEDED: PlanStepState.SUCCEEDED,
                AgentInstanceState.FAILED: PlanStepState.FAILED,
                AgentInstanceState.CANCELLED: PlanStepState.CANCELLED,
                AgentInstanceState.ORPHANED: PlanStepState.BLOCKED,
            }.get(agent.state)

        return None

    def _execution_waiting_approval(self, step: PlanStepRecord) -> bool:
        if step.kind not in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION} or not step.execution_id:
            return False
        action = self.store.get_action(step.execution_id)
        return action is not None and action.state is ActionState.WAITING_PERMISSION

    def _move_task(self, current: TaskState, task_id: str, target: TaskState):
        task = self.store.get_task(task_id)
        assert task is not None
        if task.state is target:
            return task

        if target is TaskState.RUNNING:
            for state in self._path_to_running(task.state):
                task = self.store.transition_task(task_id, state)
            return task

        if target is TaskState.WAITING_FOR_APPROVAL:
            if task.state not in {TaskState.READY, TaskState.RUNNING}:
                task = self._move_task(task.state, task_id, TaskState.RUNNING)
            return self.store.transition_task(task_id, TaskState.WAITING_FOR_APPROVAL)

        if target is TaskState.VERIFYING:
            if task.state is not TaskState.RUNNING:
                task = self._move_task(task.state, task_id, TaskState.RUNNING)
            return self.store.transition_task(task_id, TaskState.VERIFYING)

        if target is TaskState.COMPLETED:
            if task.state is not TaskState.VERIFYING:
                task = self._move_task(task.state, task_id, TaskState.VERIFYING)
            return self.store.transition_task(task_id, TaskState.COMPLETED)

        if target is TaskState.FAILED:
            directly_fail = {
                TaskState.INTERPRETING,
                TaskState.PLANNING,
                TaskState.RUNNING,
                TaskState.VERIFYING,
                TaskState.RECOVERING,
                TaskState.BLOCKED,
            }
            if task.state not in directly_fail:
                task = self._move_task(task.state, task_id, TaskState.RUNNING)
            return self.store.transition_task(task_id, TaskState.FAILED)

        if target is TaskState.BLOCKED:
            directly_block = {
                TaskState.READY,
                TaskState.RUNNING,
                TaskState.VERIFYING,
                TaskState.WAITING_FOR_APPROVAL,
                TaskState.WAITING_FOR_USER,
                TaskState.RECOVERING,
            }
            if task.state not in directly_block:
                task = self._move_task(task.state, task_id, TaskState.RUNNING)
            return self.store.transition_task(task_id, TaskState.BLOCKED)

        return self.store.transition_task(task_id, target)

    @staticmethod
    def _path_to_running(current: TaskState) -> tuple[TaskState, ...]:
        return {
            TaskState.CREATED: (TaskState.PLANNING, TaskState.READY, TaskState.RUNNING),
            TaskState.INTERPRETING: (TaskState.PLANNING, TaskState.READY, TaskState.RUNNING),
            TaskState.PLANNING: (TaskState.READY, TaskState.RUNNING),
            TaskState.READY: (TaskState.RUNNING,),
            TaskState.WAITING_FOR_APPROVAL: (TaskState.RUNNING,),
            TaskState.WAITING_FOR_USER: (TaskState.RUNNING,),
            TaskState.RECOVERING: (TaskState.RUNNING,),
            TaskState.BLOCKED: (TaskState.RUNNING,),
            TaskState.VERIFYING: (TaskState.RECOVERING, TaskState.RUNNING),
            TaskState.RUNNING: (),
        }.get(current, ())
