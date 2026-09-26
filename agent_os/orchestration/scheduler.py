"""Deterministic durable plan scheduler."""

from __future__ import annotations

from dataclasses import dataclass

from agent_os.contracts import new_id
from agent_os.store import AgentOSStore

from .plan import PlanState, PlanStepRecord, PlanStepState


@dataclass(frozen=True, slots=True)
class SchedulerTick:
    plan_id: str
    ready: tuple[str, ...]
    blocked: tuple[str, ...]
    terminal_state: PlanState | None = None


class DurablePlanScheduler:
    """Refresh dependencies and atomically claim runnable plan steps."""

    def __init__(
        self,
        store: AgentOSStore,
        *,
        owner_id: str | None = None,
        lease_seconds: float = 60.0,
    ):
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be > 0")
        self.store = store
        self.owner_id = owner_id or new_id("scheduler")
        self.lease_seconds = float(lease_seconds)

    def tick(self, plan_id: str) -> SchedulerTick:
        self.store.reclaim_expired_unbound_plan_steps(plan_id)
        changes = self.store.refresh_plan_readiness(plan_id)
        terminal = self.store.evaluate_plan_state(plan_id)
        return SchedulerTick(
            plan_id=plan_id,
            ready=tuple(changes["ready"]),
            blocked=tuple(changes["blocked"]),
            terminal_state=terminal,
        )

    def claim_next(self, plan_id: str) -> PlanStepRecord | None:
        self.store.reclaim_expired_unbound_plan_steps(plan_id)
        self.store.refresh_plan_readiness(plan_id)
        return self.store.claim_next_plan_step(
            plan_id,
            claim_owner=self.owner_id,
            lease_seconds=self.lease_seconds,
        )
