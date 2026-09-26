from __future__ import annotations

import pytest

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.orchestration.plan import (
    InvalidPlan,
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    PlanStepState,
    validate_plan_graph,
)
from agent_os.orchestration.scheduler import DurablePlanScheduler
from agent_os.store import AgentOSStore, SCHEMA_VERSION


def make_plan(store):
    task = store.create_task(TaskRecord.create("plan test"))
    plan = PlanRecord.create(task_id=task.id, objective="build and verify")
    first = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="build",
        kind=PlanStepKind.ACTION,
        priority=10,
    )
    second = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="verify",
        kind=PlanStepKind.ACTION,
        priority=5,
    )
    store.create_plan(plan, [first, second], {second.id: [first.id]})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    return plan, first, second


def test_cycle_is_rejected_before_persistence(tmp_path):
    task = TaskRecord.create("cycle")
    plan = PlanRecord.create(task_id=task.id, objective="cycle")
    first = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="a",
        kind=PlanStepKind.ACTION,
    )
    second = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="b",
        kind=PlanStepKind.ACTION,
    )

    with pytest.raises(InvalidPlan, match="cycle"):
        validate_plan_graph(
            [first, second],
            {first.id: [second.id], second.id: [first.id]},
        )


def test_scheduler_respects_dependencies_and_survives_reopen(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    plan, first, second = make_plan(store)
    scheduler = DurablePlanScheduler(store)

    claimed = scheduler.claim_next(plan.id)
    assert claimed.id == first.id
    assert claimed.state is PlanStepState.RUNNING

    store.transition_plan_step(first.id, PlanStepState.SUCCEEDED)

    reopened = AgentOSStore(path)
    next_claim = DurablePlanScheduler(reopened).claim_next(plan.id)

    assert next_claim.id == second.id
    assert next_claim.state is PlanStepState.RUNNING


def test_failed_dependency_blocks_downstream_and_fails_plan(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    plan, first, second = make_plan(store)
    scheduler = DurablePlanScheduler(store)

    claimed = scheduler.claim_next(plan.id)
    store.transition_plan_step(claimed.id, PlanStepState.FAILED)

    tick = scheduler.tick(plan.id)
    steps = {step.id: step for step in store.list_plan_steps(plan.id)}

    assert second.id in tick.blocked
    assert steps[second.id].state is PlanStepState.BLOCKED
    assert store.get_plan(plan.id).state is PlanState.FAILED


def test_claim_is_single_winner(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    plan, first, _ = make_plan(store)
    scheduler = DurablePlanScheduler(store)

    one = scheduler.claim_next(plan.id)
    two = scheduler.claim_next(plan.id)

    assert one.id == first.id
    assert two is None


def test_schema_version_contains_plan_tables(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    make_plan(store)

    assert SCHEMA_VERSION == 3


def test_claim_records_owner_token_and_lease(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    plan, first, _ = make_plan(store)
    scheduler = DurablePlanScheduler(
        store,
        owner_id="scheduler-A",
        lease_seconds=30,
    )

    claimed = scheduler.claim_next(plan.id)

    assert claimed is not None
    assert claimed.id == first.id
    assert claimed.claim_owner == "scheduler-A"
    assert claimed.claim_token
    assert claimed.claim_expires_at is not None


def test_expired_unbound_claim_is_reclaimed_but_bound_execution_is_not(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    plan, first, second = make_plan(store)
    scheduler = DurablePlanScheduler(
        store,
        owner_id="scheduler-A",
        lease_seconds=30,
    )

    claimed = scheduler.claim_next(plan.id)
    assert claimed is not None
    reclaimed = store.reclaim_expired_unbound_plan_steps(
        plan.id,
        now=float(claimed.claim_expires_at) + 1,
    )
    assert reclaimed == [claimed.id]
    assert store.get_plan_step(claimed.id).state is PlanStepState.READY

    rebound = DurablePlanScheduler(
        store,
        owner_id="scheduler-B",
        lease_seconds=30,
    ).claim_next(plan.id)
    action = store.create_action(
        ActionRecord.create(
            rebound.task_id,
            tool="terminal",
            operation="read status",
        )
    )
    store.bind_plan_step_execution(rebound.id, action.id)

    reclaimed_after_bind = store.reclaim_expired_unbound_plan_steps(
        plan.id,
        now=float(rebound.claim_expires_at) + 999,
    )
    assert rebound.id not in reclaimed_after_bind
    assert store.get_plan_step(rebound.id).state is PlanStepState.RUNNING
