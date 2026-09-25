from __future__ import annotations

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.verification.gate import VerificationResult, VerificationVerdict
from agent_os.verification.router import VerifierRouter


class FixedVerifier:
    def __init__(self, method):
        self.method = method

    def verify(self, action, actual_state):
        return VerificationResult(
            VerificationVerdict.PASSED,
            self.method,
            evidence={"actual_state": actual_state},
        )


def action(method=None):
    task = TaskRecord.create("verify")
    return ActionRecord.create(
        task.id,
        tool="terminal",
        operation="read status",
        verification_method=method,
    )


def test_router_uses_default_without_explicit_method():
    result = VerifierRouter(FixedVerifier("default")).verify(action(), {"ok": True})

    assert result.passed
    assert result.method == "default"


def test_router_uses_named_verifier():
    result = VerifierRouter(
        FixedVerifier("default"),
        {"project": FixedVerifier("project")},
    ).verify(action("project"), {"ok": True})

    assert result.passed
    assert result.method == "project"


def test_router_blocks_unknown_explicit_method():
    result = VerifierRouter(FixedVerifier("default")).verify(
        action("invented"),
        {"ok": True},
    )

    assert result.verdict is VerificationVerdict.BLOCKED
    assert "unknown verification method" in result.reason
