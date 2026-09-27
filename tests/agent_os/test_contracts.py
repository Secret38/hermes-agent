from __future__ import annotations

import pytest

from agent_os.contracts import ActionRecord, TaskRecord


def test_task_create_requires_nonempty_goal():
    with pytest.raises(ValueError, match="goal"):
        TaskRecord.create("   ")


def test_action_create_validates_retry_and_timeout():
    task = TaskRecord.create("build project")

    with pytest.raises(ValueError, match="retry_budget"):
        ActionRecord.create(task.id, tool="terminal", operation="run", retry_budget=-1)

    with pytest.raises(ValueError, match="timeout_seconds"):
        ActionRecord.create(task.id, tool="terminal", operation="run", timeout_seconds=0)


def test_action_contract_defaults_to_verification_required():
    task = TaskRecord.create("build project")
    action = ActionRecord.create(
        task.id,
        tool="terminal",
        operation="npm test",
        expected_state={"exit_code": 0},
    )

    assert action.verification_required is True
    assert action.expected_state == {"exit_code": 0}
