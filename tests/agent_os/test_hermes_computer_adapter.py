from __future__ import annotations

import json

import pytest

from agent_os.adapters.hermes_computer import (
    ComputerUseExecutionError,
    HermesComputerUseExecutor,
    HermesComputerUseVerifier,
)
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.execution_context import authorized_execution
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.verification.gate import VerificationVerdict


def action(operation, payload=None, expected=None):
    task = TaskRecord.create("computer")
    return ActionRecord.create(
        task.id,
        tool="computer_use",
        operation=operation,
        input=payload or {},
        expected_state=expected or {},
    )


def test_executor_bridges_only_current_agent_os_approval(monkeypatch):
    seen = {}

    def fake_handle(args, **kwargs):
        seen["approval"] = kwargs["approval_callback"]("cmd", "desc")
        return json.dumps(
            {
                "ok": True,
                "action": "click",
                "verified": True,
                "verdict": {"decision": "done"},
            }
        )

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )
    current = action("click", {"action": "click", "element": 1})
    risk = RiskAssessment(RiskLevel.L2_PERSISTENT_LOCAL, "test")
    decision = PermissionDecision(PermissionOutcome.ALLOW, decided_by="test")

    with authorized_execution(current, risk, decision):
        result = HermesComputerUseExecutor().execute(current)

    assert seen["approval"] == "once"
    assert result.actual_state["verified"] is True


def test_executor_denies_bridge_outside_authorized_scope(monkeypatch):
    def fake_handle(args, **kwargs):
        choice = kwargs["approval_callback"]("cmd", "desc")
        return json.dumps({"error": f"approval={choice}"})

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )

    with pytest.raises(ComputerUseExecutionError, match="approval=deny"):
        HermesComputerUseExecutor().execute(action("click"))


def test_verifier_checks_fresh_app_listing(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        lambda args, **kwargs: json.dumps(
            {
                "apps": [{"name": "Notepad", "pid": 42}],
                "count": 1,
            }
        ),
    )

    result = HermesComputerUseVerifier().verify(
        action("list_apps", expected={"app_present": "Notepad"}),
        {"apps": []},
    )

    assert result.verdict is VerificationVerdict.PASSED


def test_computer_use_availability_requires_healthy_driver(monkeypatch):
    from agent_os.adapters.hermes_computer import computer_use_available

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.computer_use_status",
        lambda: {"installed": True, "ready": False},
    )
    assert computer_use_available() is False

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.computer_use_status",
        lambda: {"installed": True, "ready": True},
    )
    assert computer_use_available() is True
