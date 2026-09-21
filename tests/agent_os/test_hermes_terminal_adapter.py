from __future__ import annotations

import json

import pytest

from agent_os.adapters.hermes_terminal import (
    HermesTerminalExecutor,
    TerminalExecutionError,
    TerminalResultVerifier,
)
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.verification.gate import VerificationVerdict


def action(*, expected=None, input=None, operation="echo ok"):
    task = TaskRecord.create("terminal adapter")
    return ActionRecord.create(
        task.id,
        tool="terminal",
        operation=operation,
        input=input or {},
        expected_state=expected or {},
    )


def test_executor_maps_terminal_result(monkeypatch):
    seen = {}

    def fake_terminal_tool(**kwargs):
        seen.update(kwargs)
        return json.dumps({"output": "ok", "exit_code": 0, "error": None})

    monkeypatch.setattr(
        "agent_os.adapters.hermes_terminal.terminal_tool",
        fake_terminal_tool,
    )

    result = HermesTerminalExecutor(host_local=True).execute(
        action(input={"command": "printf ok", "workdir": "/tmp"})
    )

    assert result.actual_state["output"] == "ok"
    assert seen["force"] is True
    assert seen["_host_local"] is True
    assert seen["workdir"] == "/tmp"


def test_executor_raises_on_nonzero_exit(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_terminal.terminal_tool",
        lambda **kwargs: json.dumps(
            {"output": "boom", "exit_code": 2, "error": None}
        ),
    )

    with pytest.raises(TerminalExecutionError):
        HermesTerminalExecutor().execute(action())


def test_terminal_result_verifier_checks_exit_output_and_session():
    verifier = TerminalResultVerifier(default_exit_code=None)
    result = verifier.verify(
        action(
            expected={
                "exit_code": 0,
                "output_contains": "READY",
                "session_id_present": True,
            }
        ),
        {"exit_code": 0, "output": "server READY", "session_id": "proc-1"},
    )

    assert result.verdict is VerificationVerdict.PASSED


def test_terminal_result_verifier_fails_missing_assertion():
    verifier = TerminalResultVerifier()
    result = verifier.verify(
        action(expected={"output_contains": "needle"}),
        {"exit_code": 0, "output": "haystack"},
    )

    assert result.verdict is VerificationVerdict.FAILED
    assert "needle" in result.reason


def test_executor_allows_explicitly_expected_nonzero_exit(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_terminal.terminal_tool",
        lambda **kwargs: json.dumps(
            {"output": "SyntaxError", "exit_code": 1, "error": None}
        ),
    )

    result = HermesTerminalExecutor().execute(
        action(
            expected={"exit_code": 1, "output_contains": "SyntaxError"},
            operation="diagnose build",
        )
    )

    assert result.actual_state["exit_code"] == 1
