"""Mandatory verification contract for Agent OS actions."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from agent_os.contracts import ActionRecord


class VerificationVerdict(StrEnum):
    PASSED = "PASSED"
    FAILED = "FAILED"
    BLOCKED = "BLOCKED"


@dataclass(frozen=True, slots=True)
class VerificationResult:
    verdict: VerificationVerdict
    method: str
    evidence: dict[str, Any] = field(default_factory=dict)
    reason: str = ""

    @property
    def passed(self) -> bool:
        return self.verdict is VerificationVerdict.PASSED


class Verifier(Protocol):
    def verify(self, action: ActionRecord, actual_state: dict[str, Any]) -> VerificationResult: ...
