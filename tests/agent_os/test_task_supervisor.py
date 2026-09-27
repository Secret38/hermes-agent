from __future__ import annotations

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.orchestration.plan import (
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    PlanStepState,
)
from agent_os.orchestration.scheduler import DurablePlanScheduler
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore
from agent_os.task_supervisor import TaskSupervisor


def succeed_action(store, action_id):
    store.transition_action(action_id, ActionState.EXECUTING)
    store.transition_action(action_id, ActionState.OBSERVING)
    store.transition_action(action_id, ActionState.VERIFYING)
    store.transition_action(
        action_id,
        ActionState.SUCCEEDED,
        verification_result={"verdict": "PASSED"},
    )


def make_verified_plan(store):
    task = store.create_task(TaskRecord.create("task supervisor"))
    plan = PlanRecord.create(task_id=task.id, objective="build then verify")
    build = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="build",
        kind=PlanStepKind.ACTION,
    )
    verify = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="terminal verification",
        kind=PlanStepKind.VERIFICATION,
    )
    store.create_plan(plan, [build, verify], {verify.id: [build.id]})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    return task, plan, build, verify


def test_task_completes_only_after_bound_verification_succeeds(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task, plan, build, verify = make_verified_plan(store)
    scheduler = DurablePlanScheduler(store)
    supervisor = TaskSupervisor(store)

    claimed = scheduler.claim_next(plan.id)
    build_action = store.create_action(
        ActionRecord.create(task.id, tool="terminal", operation="build")
    )
    store.bind_plan_step_execution(claimed.id, build_action.id)
    succeed_action(store, build_action.id)

    first = supervisor.reconcile(task.id, plan.id)
    assert first.task_state is TaskState.RUNNING

    verify_claim = scheduler.claim_next(plan.id)
    assert verify_claim.id == verify.id
    verify_action = store.create_action(
        ActionRecord.create(task.id, tool="terminal", operation="verify")
    )
    store.bind_plan_step_execution(verify_claim.id, verify_action.id)
    succeed_action(store, verify_action.id)

    final = supervisor.reconcile(task.id, plan.id)

    assert final.plan_state is PlanState.COMPLETED
    assert final.task_state is TaskState.COMPLETED
    assert final.needs_verification is False


def test_completed_plan_without_verification_cannot_complete_task(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("no false completion"))
    plan = PlanRecord.create(task_id=task.id, objective="work")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="work",
        kind=PlanStepKind.ACTION,
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    claimed = DurablePlanScheduler(store).claim_next(plan.id)

    action = store.create_action(
        ActionRecord.create(task.id, tool="terminal", operation="work")
    )
    store.bind_plan_step_execution(claimed.id, action.id)
    succeed_action(store, action.id)

    result = TaskSupervisor(store).reconcile(task.id, plan.id)

    assert result.plan_state is PlanState.COMPLETED
    assert result.task_state is TaskState.VERIFYING
    assert result.needs_verification is True


def test_waiting_permission_propagates_to_task(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("approval"))
    plan = PlanRecord.create(task_id=task.id, objective="approval")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="external side effect",
        kind=PlanStepKind.ACTION,
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    claimed = DurablePlanScheduler(store).claim_next(plan.id)

    action = store.create_action(
        ActionRecord.create(task.id, tool="terminal", operation="deploy")
    )
    store.transition_action(action.id, ActionState.WAITING_PERMISSION)
    store.bind_plan_step_execution(claimed.id, action.id)

    result = TaskSupervisor(store).reconcile(task.id, plan.id)

    assert result.task_state is TaskState.WAITING_FOR_APPROVAL


def test_verifying_task_can_reenter_running_for_new_work(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("recovery from verification"))
    store.transition_task(task.id, TaskState.PLANNING)
    store.transition_task(task.id, TaskState.READY)
    store.transition_task(task.id, TaskState.RUNNING)
    store.transition_task(task.id, TaskState.VERIFYING)

    supervisor = TaskSupervisor(store)
    moved = supervisor._move_task(TaskState.VERIFYING, task.id, TaskState.RUNNING)

    assert moved.state is TaskState.RUNNING
