"""Central risk classification primitives for Agent OS actions."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
import re
from typing import Protocol

from .contracts import ActionRecord


class RiskLevel(StrEnum):
    L0_OBSERVE = "L0"
    L1_REVERSIBLE = "L1"
    L2_PERSISTENT_LOCAL = "L2"
    L3_EXTERNAL_SIDE_EFFECT = "L3"
    L4_DESTRUCTIVE_OR_SENSITIVE = "L4"


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    level: RiskLevel
    reason: str
    classifier: str = "default"


class RiskClassifier(Protocol):
    def classify(self, action: ActionRecord) -> RiskAssessment: ...


class ConservativeRiskClassifier:
    """Deterministic fail-safe baseline classifier."""

    _READ_HINTS = (
        "read", "list", "get", "inspect", "status", "show", "search", "find",
        "screenshot", "snapshot", "capture", "observe", "query",
    )
    _EXTERNAL_HINTS = (
        "send", "post", "publish", "upload", "submit", "email", "message",
        "purchase", "buy", "deploy",
    )
    _DESTRUCTIVE_HINTS = (
        "rm -rf", "rmdir /s", "del /f", "format ", "diskpart", "drop database",
        "truncate table", "reg delete", "shutdown", "reboot", "credential",
        "password", "secret", "token", "disable firewall", "bcdedit",
    )

    @staticmethod
    def _matches(haystack: str, hint: str) -> bool:
        hint = hint.lower()
        if any(ch.isspace() for ch in hint) or any(ch in hint for ch in "/\\-"):
            return hint in haystack
        return re.search(
            rf"(?<![A-Za-z0-9_]){re.escape(hint)}(?![A-Za-z0-9_])",
            haystack,
        ) is not None

    def classify(self, action: ActionRecord) -> RiskAssessment:
        haystack = " ".join([action.tool, action.operation, str(action.input)]).lower()
        if any(self._matches(haystack, hint) for hint in self._DESTRUCTIVE_HINTS):
            return RiskAssessment(
                RiskLevel.L4_DESTRUCTIVE_OR_SENSITIVE,
                "destructive or security-sensitive operation detected",
                type(self).__name__,
            )
        if any(self._matches(haystack, hint) for hint in self._EXTERNAL_HINTS):
            return RiskAssessment(
                RiskLevel.L3_EXTERNAL_SIDE_EFFECT,
                "external side effect detected",
                type(self).__name__,
            )
        if any(self._matches(haystack, hint) for hint in self._READ_HINTS):
            return RiskAssessment(
                RiskLevel.L0_OBSERVE,
                "read-only/observation operation detected",
                type(self).__name__,
            )
        tool = action.tool.lower()
        operation = action.operation.lower().strip()
        if tool == "browser":
            if operation in {"navigate", "open", "back", "scroll"}:
                return RiskAssessment(
                    RiskLevel.L1_REVERSIBLE,
                    "reversible browser navigation operation",
                    type(self).__name__,
                )
            return RiskAssessment(
                RiskLevel.L2_PERSISTENT_LOCAL,
                "browser input may mutate page or remote application state",
                type(self).__name__,
            )
        if tool in {"computer", "computer_use"} and operation == "wait":
            return RiskAssessment(
                RiskLevel.L1_REVERSIBLE,
                "desktop wait has no persistent side effect",
                type(self).__name__,
            )
        return RiskAssessment(
            RiskLevel.L2_PERSISTENT_LOCAL,
            "unknown or persistent local operation defaults to L2",
            type(self).__name__,
        )
