"""Canonical Agent OS task and action state machines."""

from __future__ import annotations

from enum import StrEnum


class InvalidTransition(ValueError):
    """Raised when a state transition violates the Agent OS lifecycle."""


class TaskState(StrEnum):
    CREATED = "CREATED"
    INTERPRETING = "INTERPRETING"
    PLANNING = "PLANNING"
    READY = "READY"
    RUNNING = "RUNNING"
    VERIFYING = "VERIFYING"
    WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL"
    WAITING_FOR_USER = "WAITING_FOR_USER"
    RECOVERING = "RECOVERING"
    BLOCKED = "BLOCKED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class ActionState(StrEnum):
    PLANNED = "PLANNED"
    WAITING_PERMISSION = "WAITING_PERMISSION"
    EXECUTING = "EXECUTING"
    OBSERVING = "OBSERVING"
    VERIFYING = "VERIFYING"
    SUCCEEDED = "SUCCEEDED"
    RECOVERING = "RECOVERING"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


_TERMINAL_TASK_STATES = frozenset(
    {TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED}
)
_TERMINAL_ACTION_STATES = frozenset(
    {ActionState.SUCCEEDED, ActionState.FAILED, ActionState.CANCELLED}
)

TASK_TRANSITIONS: dict[TaskState, frozenset[TaskState]] = {
    TaskState.CREATED: frozenset({TaskState.INTERPRETING, TaskState.PLANNING, TaskState.CANCELLED}),
    TaskState.INTERPRETING: frozenset({TaskState.PLANNING, TaskState.WAITING_FOR_USER, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.PLANNING: frozenset({TaskState.READY, TaskState.WAITING_FOR_USER, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.READY: frozenset({TaskState.RUNNING, TaskState.WAITING_FOR_APPROVAL, TaskState.BLOCKED, TaskState.CANCELLED}),
    TaskState.RUNNING: frozenset({
        TaskState.VERIFYING,
        TaskState.WAITING_FOR_APPROVAL,
        TaskState.WAITING_FOR_USER,
        TaskState.RECOVERING,
        TaskState.BLOCKED,
        TaskState.FAILED,
        TaskState.CANCELLED,
    }),
    TaskState.VERIFYING: frozenset({
        TaskState.COMPLETED,
        TaskState.RECOVERING,
        TaskState.BLOCKED,
        TaskState.FAILED,
        TaskState.CANCELLED,
    }),
    TaskState.WAITING_FOR_APPROVAL: frozenset({TaskState.RUNNING, TaskState.BLOCKED, TaskState.CANCELLED}),
    TaskState.WAITING_FOR_USER: frozenset({TaskState.PLANNING, TaskState.RUNNING, TaskState.BLOCKED, TaskState.CANCELLED}),
    TaskState.RECOVERING: frozenset({TaskState.RUNNING, TaskState.VERIFYING, TaskState.BLOCKED, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.BLOCKED: frozenset({TaskState.READY, TaskState.RUNNING, TaskState.RECOVERING, TaskState.FAILED, TaskState.CANCELLED}),
    TaskState.COMPLETED: frozenset(),
    TaskState.FAILED: frozenset(),
    TaskState.CANCELLED: frozenset(),
}

ACTION_TRANSITIONS: dict[ActionState, frozenset[ActionState]] = {
    ActionState.PLANNED: frozenset({ActionState.WAITING_PERMISSION, ActionState.EXECUTING, ActionState.CANCELLED}),
    ActionState.WAITING_PERMISSION: frozenset({ActionState.EXECUTING, ActionState.BLOCKED, ActionState.CANCELLED}),
    ActionState.EXECUTING: frozenset({ActionState.OBSERVING, ActionState.VERIFYING, ActionState.RECOVERING, ActionState.FAILED, ActionState.CANCELLED}),
    ActionState.OBSERVING: frozenset({ActionState.VERIFYING, ActionState.SUCCEEDED, ActionState.RECOVERING, ActionState.FAILED, ActionState.CANCELLED}),
    ActionState.VERIFYING: frozenset({ActionState.SUCCEEDED, ActionState.RECOVERING, ActionState.BLOCKED, ActionState.FAILED, ActionState.CANCELLED}),
    ActionState.RECOVERING: frozenset({ActionState.EXECUTING, ActionState.OBSERVING, ActionState.VERIFYING, ActionState.BLOCKED, ActionState.FAILED, ActionState.CANCELLED}),
    ActionState.BLOCKED: frozenset({ActionState.WAITING_PERMISSION, ActionState.EXECUTING, ActionState.RECOVERING, ActionState.FAILED, ActionState.CANCELLED}),
    ActionState.SUCCEEDED: frozenset(),
    ActionState.FAILED: frozenset(),
    ActionState.CANCELLED: frozenset(),
}


def validate_task_transition(current: TaskState, target: TaskState) -> None:
    if target == current:
        return
    if target not in TASK_TRANSITIONS[current]:
        raise InvalidTransition(f"invalid task transition: {current.value} -> {target.value}")


def validate_action_transition(current: ActionState, target: ActionState) -> None:
    if target == current:
        return
    if target not in ACTION_TRANSITIONS[current]:
        raise InvalidTransition(f"invalid action transition: {current.value} -> {target.value}")


def task_is_terminal(state: TaskState) -> bool:
    return state in _TERMINAL_TASK_STATES


def action_is_terminal(state: ActionState) -> bool:
    return state in _TERMINAL_ACTION_STATES
