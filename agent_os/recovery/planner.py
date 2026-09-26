"""Recovery-decision contract for failed Agent OS actions."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from agent_os.contracts import ActionRecord
from agent_os.verification.gate import VerificationResult


class RecoveryAction(StrEnum):
    RETRY = "RETRY"
    REPLAN = "REPLAN"
    ROLLBACK = "ROLLBACK"
    ASK_USER = "ASK_USER"
    FAIL = "FAIL"


@dataclass(frozen=True, slots=True)
class RecoveryDecision:
    action: RecoveryAction
    reason: str


class RecoveryPlanner(Protocol):
    def decide(
        self,
        action: ActionRecord,
        *,
        error: Exception | None,
        verification: VerificationResult | None,
        attempts: int,
    ) -> RecoveryDecision: ...


class RetryBudgetRecoveryPlanner:
    """Bounded baseline: retry while budget remains, otherwise fail."""

    def decide(
        self,
        action: ActionRecord,
        *,
        error: Exception | None,
        verification: VerificationResult | None,
        attempts: int,
    ) -> RecoveryDecision:
        if attempts < action.retry_budget:
            why = (
                f"execution error: {type(error).__name__}"
                if error is not None
                else f"verification {verification.verdict.value if verification else 'failed'}"
            )
            return RecoveryDecision(RecoveryAction.RETRY, why)
        return RecoveryDecision(RecoveryAction.FAIL, "retry budget exhausted")
