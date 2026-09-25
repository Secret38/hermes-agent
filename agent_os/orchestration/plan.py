"""Durable plan DAG contracts for Agent OS orchestration."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Iterable

from agent_os.contracts import new_id, utc_now_iso


class InvalidPlan(ValueError):
    pass


class InvalidPlanTransition(ValueError):
    pass


class InvalidPlanStepTransition(ValueError):
    pass


class PlanState(StrEnum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class PlanStepState(StrEnum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    BLOCKED = "BLOCKED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class PlanStepKind(StrEnum):
    ACTION = "ACTION"
    AGENT = "AGENT"
    VERIFICATION = "VERIFICATION"
    MANUAL = "MANUAL"


PLAN_TRANSITIONS: dict[PlanState, frozenset[PlanState]] = {
    PlanState.DRAFT: frozenset({PlanState.ACTIVE, PlanState.CANCELLED}),
    PlanState.ACTIVE: frozenset({PlanState.COMPLETED, PlanState.FAILED, PlanState.CANCELLED}),
    PlanState.COMPLETED: frozenset(),
    PlanState.FAILED: frozenset(),
    PlanState.CANCELLED: frozenset(),
}

STEP_TRANSITIONS: dict[PlanStepState, frozenset[PlanStepState]] = {
    PlanStepState.PENDING: frozenset({PlanStepState.READY, PlanStepState.BLOCKED, PlanStepState.CANCELLED}),
    PlanStepState.READY: frozenset({PlanStepState.RUNNING, PlanStepState.BLOCKED, PlanStepState.CANCELLED}),
    PlanStepState.RUNNING: frozenset({
        PlanStepState.SUCCEEDED,
        PlanStepState.FAILED,
        PlanStepState.BLOCKED,
        PlanStepState.CANCELLED,
    }),
    PlanStepState.BLOCKED: frozenset({PlanStepState.READY, PlanStepState.FAILED, PlanStepState.CANCELLED}),
    PlanStepState.SUCCEEDED: frozenset(),
    PlanStepState.FAILED: frozenset(),
    PlanStepState.CANCELLED: frozenset(),
}


def validate_plan_transition(current: PlanState, target: PlanState) -> None:
    if current == target:
        return
    if target not in PLAN_TRANSITIONS[current]:
        raise InvalidPlanTransition(f"invalid plan transition: {current.value} -> {target.value}")


def validate_step_transition(current: PlanStepState, target: PlanStepState) -> None:
    if current == target:
        return
    if target not in STEP_TRANSITIONS[current]:
        raise InvalidPlanStepTransition(
            f"invalid plan step transition: {current.value} -> {target.value}"
        )


@dataclass(frozen=True, slots=True)
class PlanRecord:
    id: str
    task_id: str
    objective: str
    revision: int = 1
    state: PlanState = PlanState.DRAFT
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def create(
        cls,
        *,
        task_id: str,
        objective: str,
        revision: int = 1,
        metadata: dict[str, Any] | None = None,
    ) -> "PlanRecord":
        if not task_id.strip():
            raise ValueError("plan task_id must not be empty")
        if not objective.strip():
            raise ValueError("plan objective must not be empty")
        if revision < 1:
            raise ValueError("plan revision must be >= 1")
        return cls(
            id=new_id("plan"),
            task_id=task_id,
            objective=objective.strip(),
            revision=revision,
            metadata=dict(metadata or {}),
        )


@dataclass(frozen=True, slots=True)
class PlanStepRecord:
    id: str
    plan_id: str
    task_id: str
    title: str
    kind: PlanStepKind
    state: PlanStepState = PlanStepState.PENDING
    spec: dict[str, Any] = field(default_factory=dict)
    execution_id: str | None = None
    claim_token: str | None = None
    claim_owner: str | None = None
    claim_expires_at: float | None = None
    priority: int = 0
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def create(
        cls,
        *,
        plan_id: str,
        task_id: str,
        title: str,
        kind: PlanStepKind,
        spec: dict[str, Any] | None = None,
        execution_id: str | None = None,
        claim_token: str | None = None,
        claim_owner: str | None = None,
        claim_expires_at: float | None = None,
        priority: int = 0,
    ) -> "PlanStepRecord":
        if not plan_id.strip():
            raise ValueError("step plan_id must not be empty")
        if not task_id.strip():
            raise ValueError("step task_id must not be empty")
        if not title.strip():
            raise ValueError("step title must not be empty")
        return cls(
            id=new_id("step"),
            plan_id=plan_id,
            task_id=task_id,
            title=title.strip(),
            kind=kind,
            spec=dict(spec or {}),
            execution_id=execution_id,
            claim_token=claim_token,
            claim_owner=claim_owner,
            claim_expires_at=claim_expires_at,
            priority=int(priority),
        )


def validate_plan_graph(
    steps: Iterable[PlanStepRecord],
    dependencies: dict[str, Iterable[str]],
) -> None:
    steps = list(steps)
    ids = {step.id for step in steps}
    if len(ids) != len(steps):
        raise InvalidPlan("duplicate plan step id")

    graph: dict[str, set[str]] = {step_id: set() for step_id in ids}
    indegree: dict[str, int] = {step_id: 0 for step_id in ids}

    for step_id, raw_deps in dependencies.items():
        if step_id not in ids:
            raise InvalidPlan(f"unknown dependency target: {step_id}")
        for dependency_id in set(raw_deps):
            if dependency_id not in ids:
                raise InvalidPlan(f"unknown dependency: {dependency_id}")
            if dependency_id == step_id:
                raise InvalidPlan(f"step cannot depend on itself: {step_id}")
            if step_id not in graph[dependency_id]:
                graph[dependency_id].add(step_id)
                indegree[step_id] += 1

    ready = [step_id for step_id, degree in indegree.items() if degree == 0]
    visited = 0
    while ready:
        current = ready.pop()
        visited += 1
        for child in graph[current]:
            indegree[child] -= 1
            if indegree[child] == 0:
                ready.append(child)

    if visited != len(ids):
        raise InvalidPlan("plan dependencies contain a cycle")
