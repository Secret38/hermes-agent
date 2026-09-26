from __future__ import annotations

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.execution_context import authorized_execution, current_authorized_execution
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel


def test_authorization_context_is_scoped_and_reset():
    task = TaskRecord.create("context")
    action = ActionRecord.create(task.id, tool="computer_use", operation="click")
    risk = RiskAssessment(RiskLevel.L2_PERSISTENT_LOCAL, "test")
    decision = PermissionDecision(PermissionOutcome.ALLOW, decided_by="test")

    assert current_authorized_execution() is None
    with authorized_execution(action, risk, decision):
        current = current_authorized_execution()
        assert current is not None
        assert current.action_id == action.id
        assert current.permission_allowed is True
    assert current_authorized_execution() is None
