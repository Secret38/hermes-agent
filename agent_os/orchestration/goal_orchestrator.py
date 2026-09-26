"""User-goal intake to typed persistent Agent OS plan."""

from __future__ import annotations

from dataclasses import dataclass

from agent_os.contracts import TaskRecord
from agent_os.states import TaskState
from agent_os.store import AgentOSStore

from .plan import PlanRecord
from .planner import PlanCompiler, Planner


@dataclass(frozen=True, slots=True)
class GoalSubmission:
    task: TaskRecord
    plan: PlanRecord


class GoalOrchestrator:
    def __init__(
        self,
        store: AgentOSStore,
        planner: Planner,
        *,
        compiler: PlanCompiler | None = None,
    ):
        self.store = store
        self.planner = planner
        self.compiler = compiler or PlanCompiler(store)

    def submit(
        self,
        goal: str,
        *,
        metadata: dict | None = None,
        session_id: str | None = None,
        workspace_id: str | None = None,
    ) -> GoalSubmission:
        task = self.store.create_task(
            TaskRecord.create(
                goal,
                session_id=session_id,
                workspace_id=workspace_id,
                metadata=metadata,
            )
        )
        try:
            task = self.store.transition_task(task.id, TaskState.INTERPRETING)
            task = self.store.transition_task(task.id, TaskState.PLANNING)
            proposal = self.planner.plan(task)
            plan = self.compiler.compile(task, proposal, activate=True)
            task = self.store.transition_task(task.id, TaskState.READY)
            return GoalSubmission(task=task, plan=plan)
        except Exception as exc:
            current = self.store.get_task(task.id) or task
            if current.state in {
                TaskState.INTERPRETING,
                TaskState.PLANNING,
            }:
                self.store.transition_task(
                    task.id,
                    TaskState.FAILED,
                    payload={
                        "reason": "planner_or_compile_failure",
                        "error": f"{type(exc).__name__}: {exc}",
                    },
                )
            raise
