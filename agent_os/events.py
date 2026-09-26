"""Canonical append-only Agent OS event model."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from .contracts import new_id, utc_now_iso


class EventType(StrEnum):
    TASK_CREATED = "task.created"
    TASK_STATE_CHANGED = "task.state_changed"
    ACTION_CREATED = "action.created"
    ACTION_STATE_CHANGED = "action.state_changed"
    RISK_CLASSIFIED = "risk.classified"
    APPROVAL_REQUESTED = "approval.requested"
    APPROVAL_RESOLVED = "approval.resolved"
    VERIFICATION_RECORDED = "verification.recorded"
    RECOVERY_ATTEMPTED = "recovery.attempted"
    CHECKPOINT_BOUND = "checkpoint.bound"
    ARTIFACT_RECORDED = "artifact.recorded"
    AGENT_CREATED = "agent.created"
    AGENT_STATE_CHANGED = "agent.state_changed"
    AGENT_HANDLE_BOUND = "agent.handle_bound"
    AGENT_RECONCILED = "agent.reconciled"
    AGENT_RESTART_ATTEMPTED = "agent.restart_attempted"
    AGENT_RESTARTED = "agent.restarted"
    PLAN_CREATED = "plan.created"
    PLAN_STATE_CHANGED = "plan.state_changed"
    PLAN_STEP_CREATED = "plan_step.created"
    PLAN_STEP_STATE_CHANGED = "plan_step.state_changed"
    PLAN_STEP_BOUND = "plan_step.bound"


@dataclass(frozen=True, slots=True)
class EventRecord:
    id: str
    task_id: str
    type: EventType
    action_id: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def create(
        cls,
        *,
        task_id: str,
        type: EventType,
        action_id: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> "EventRecord":
        if not task_id.strip():
            raise ValueError("event task_id must not be empty")
        return cls(
            id=new_id("evt"),
            task_id=task_id,
            type=type,
            action_id=action_id,
            payload=dict(payload or {}),
        )
