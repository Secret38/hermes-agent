from __future__ import annotations

import pytest

from agent_os.states import (
    ActionState,
    InvalidTransition,
    TaskState,
    action_is_terminal,
    task_is_terminal,
    validate_action_transition,
    validate_task_transition,
)


def test_task_happy_path():
    path = [
        TaskState.CREATED,
        TaskState.INTERPRETING,
        TaskState.PLANNING,
        TaskState.READY,
        TaskState.RUNNING,
        TaskState.VERIFYING,
        TaskState.COMPLETED,
    ]
    for current, target in zip(path, path[1:]):
        validate_task_transition(current, target)


def test_task_cannot_skip_verification_to_completed():
    with pytest.raises(InvalidTransition):
        validate_task_transition(TaskState.RUNNING, TaskState.COMPLETED)


def test_terminal_task_cannot_reopen():
    assert task_is_terminal(TaskState.COMPLETED)
    with pytest.raises(InvalidTransition):
        validate_task_transition(TaskState.COMPLETED, TaskState.RUNNING)


def test_action_happy_path_and_terminal():
    path = [
        ActionState.PLANNED,
        ActionState.EXECUTING,
        ActionState.OBSERVING,
        ActionState.VERIFYING,
        ActionState.SUCCEEDED,
    ]
    for current, target in zip(path, path[1:]):
        validate_action_transition(current, target)
    assert action_is_terminal(ActionState.SUCCEEDED)


def test_action_cannot_jump_from_planned_to_succeeded():
    with pytest.raises(InvalidTransition):
        validate_action_transition(ActionState.PLANNED, ActionState.SUCCEEDED)
