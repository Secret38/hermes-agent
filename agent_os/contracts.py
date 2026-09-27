"""Durable Agent OS task/action contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from .states import ActionState, TaskState


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


@dataclass(frozen=True, slots=True)
class TaskRecord:
    id: str
    goal: str
    state: TaskState = TaskState.CREATED
    parent_task_id: str | None = None
    session_id: str | None = None
    kanban_task_id: str | None = None
    workspace_id: str | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def create(
        cls,
        goal: str,
        *,
        parent_task_id: str | None = None,
        session_id: str | None = None,
        kanban_task_id: str | None = None,
        workspace_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> "TaskRecord":
        goal = goal.strip()
        if not goal:
            raise ValueError("task goal must not be empty")
        return cls(
            id=new_id("task"),
            goal=goal,
            parent_task_id=parent_task_id,
            session_id=session_id,
            kanban_task_id=kanban_task_id,
            workspace_id=workspace_id,
            metadata=dict(metadata or {}),
        )


@dataclass(frozen=True, slots=True)
class ActionRecord:
    id: str
    task_id: str
    tool: str
    operation: str
    state: ActionState = ActionState.PLANNED
    parent_action_id: str | None = None
    agent_id: str | None = None
    input: dict[str, Any] = field(default_factory=dict)
    expected_state: dict[str, Any] = field(default_factory=dict)
    risk_level: str | None = None
    permission_policy: str | None = None
    workspace_id: str | None = None
    checkpoint_id: str | None = None
    timeout_seconds: float | None = None
    retry_budget: int = 0
    verification_required: bool = True
    verification_method: str | None = None
    actual_state: dict[str, Any] = field(default_factory=dict)
    verification_result: dict[str, Any] = field(default_factory=dict)
    recovery_attempts: int = 0
    execution_owner_pid: int | None = None
    execution_owner_create_time: float | None = None
    execution_attempts: int = 0
    error: str | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    @classmethod
    def create(
        cls,
        task_id: str,
        *,
        tool: str,
        operation: str,
        input: dict[str, Any] | None = None,
        expected_state: dict[str, Any] | None = None,
        parent_action_id: str | None = None,
        agent_id: str | None = None,
        workspace_id: str | None = None,
        timeout_seconds: float | None = None,
        retry_budget: int = 0,
        verification_required: bool = True,
        verification_method: str | None = None,
    ) -> "ActionRecord":
        if not task_id.strip():
            raise ValueError("action task_id must not be empty")
        if not tool.strip():
            raise ValueError("action tool must not be empty")
        if not operation.strip():
            raise ValueError("action operation must not be empty")
        if retry_budget < 0:
            raise ValueError("retry_budget must be >= 0")
        if timeout_seconds is not None and timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be > 0")
        return cls(
            id=new_id("action"),
            task_id=task_id,
            tool=tool.strip(),
            operation=operation.strip(),
            input=dict(input or {}),
            expected_state=dict(expected_state or {}),
            parent_action_id=parent_action_id,
            agent_id=agent_id,
            workspace_id=workspace_id,
            timeout_seconds=timeout_seconds,
            retry_budget=retry_budget,
            verification_required=verification_required,
            verification_method=verification_method,
        )
