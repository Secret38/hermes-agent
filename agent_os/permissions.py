"""Permission decisions for Agent OS actions."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from .contracts import ActionRecord
from .risk import RiskAssessment, RiskLevel


class PermissionOutcome(StrEnum):
    ALLOW = "ALLOW"
    DENY = "DENY"


@dataclass(frozen=True, slots=True)
class PermissionDecision:
    outcome: PermissionOutcome
    decided_by: str
    reason: str = ""
    scope: str = "once"

    @property
    def allowed(self) -> bool:
        return self.outcome is PermissionOutcome.ALLOW


class PermissionGate(Protocol):
    def authorize(self, action: ActionRecord, risk: RiskAssessment) -> PermissionDecision: ...


class SafeDefaultPermissionGate:
    """Non-interactive fail-closed default.

    L0/L1 run automatically. L2+ require an explicit policy/user adapter.
    """

    def authorize(self, action: ActionRecord, risk: RiskAssessment) -> PermissionDecision:
        if risk.level in {RiskLevel.L0_OBSERVE, RiskLevel.L1_REVERSIBLE}:
            return PermissionDecision(
                PermissionOutcome.ALLOW,
                decided_by=type(self).__name__,
                reason=f"{risk.level.value} allowed by safe default",
            )
        return PermissionDecision(
            PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=f"{risk.level.value} requires explicit approval",
        )
