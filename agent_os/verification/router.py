"""Deterministic verifier routing for Agent OS actions."""

from __future__ import annotations

from collections.abc import Mapping

from agent_os.contracts import ActionRecord

from .gate import VerificationResult, VerificationVerdict, Verifier


class VerifierRouter:
    """Dispatch verification by action.verification_method.

    An explicit unknown method is BLOCKED rather than silently falling back to
    a weaker verifier. Missing methods use the configured default.
    """

    def __init__(
        self,
        default: Verifier,
        methods: Mapping[str, Verifier] | None = None,
    ):
        self.default = default
        self.methods = {
            str(name).strip(): verifier
            for name, verifier in (methods or {}).items()
            if str(name).strip()
        }

    def verify(
        self,
        action: ActionRecord,
        actual_state: dict,
    ) -> VerificationResult:
        method = str(action.verification_method or "").strip()
        if not method:
            return self.default.verify(action, actual_state)

        verifier = self.methods.get(method)
        if verifier is None:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "agent-os.verifier-router",
                evidence={"requested_method": method},
                reason=f"unknown verification method: {method}",
            )
        return verifier.verify(action, actual_state)
