"""Fail-closed Golden Task benchmark contracts for Agent OS."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Callable, Iterable


class GoldenTaskOutcome(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    BLOCKED = "BLOCKED"
    NOT_IMPLEMENTED = "NOT_IMPLEMENTED"
    ERROR = "ERROR"


@dataclass(frozen=True, slots=True)
class GoldenTaskDefinition:
    id: str
    name: str
    category: str
    goal: str
    handler: str
    verification_required: bool = True
    platform: str = "any"
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "GoldenTaskDefinition":
        required = ("id", "name", "category", "goal", "handler")
        missing = [key for key in required if not str(value.get(key) or "").strip()]
        if missing:
            raise ValueError(f"golden task missing required fields: {', '.join(missing)}")
        return cls(
            id=str(value["id"]).strip(),
            name=str(value["name"]).strip(),
            category=str(value["category"]).strip(),
            goal=str(value["goal"]).strip(),
            handler=str(value["handler"]).strip(),
            verification_required=bool(value.get("verification_required", True)),
            platform=str(value.get("platform") or "any").strip().lower(),
            metadata=dict(value.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True)
class GoldenTaskResult:
    task_id: str
    outcome: GoldenTaskOutcome
    verified: bool = False
    duration_seconds: float = 0.0
    human_interventions: int = 0
    recovery_attempts: int = 0
    false_completion: bool = False
    evidence: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True, slots=True)
class GoldenTaskSummary:
    total: int
    passed: int
    verified_passed: int
    failed: int
    blocked: int
    not_implemented: int
    errors: int
    false_completions: int
    human_interventions: int
    recovery_attempts: int
    duration_seconds: float

    @property
    def success_rate(self) -> float:
        return 1.0 if self.total == 0 else self.passed / self.total

    @property
    def verified_success_rate(self) -> float:
        return 1.0 if self.total == 0 else self.verified_passed / self.total

    @property
    def production_ready(self) -> bool:
        return (
            self.total > 0
            and self.passed == self.total
            and self.verified_passed == self.total
            and self.false_completions == 0
            and self.not_implemented == 0
            and self.errors == 0
            and self.blocked == 0
            and self.failed == 0
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "passed": self.passed,
            "verified_passed": self.verified_passed,
            "failed": self.failed,
            "blocked": self.blocked,
            "not_implemented": self.not_implemented,
            "errors": self.errors,
            "false_completions": self.false_completions,
            "human_interventions": self.human_interventions,
            "recovery_attempts": self.recovery_attempts,
            "duration_seconds": self.duration_seconds,
            "success_rate": self.success_rate,
            "verified_success_rate": self.verified_success_rate,
            "production_ready": self.production_ready,
        }


GoldenTaskHandler = Callable[[GoldenTaskDefinition], GoldenTaskResult]


class GoldenTaskRunner:
    """Run canonical tasks; missing handlers are explicit failures, never skips."""

    def __init__(
        self,
        definitions: Iterable[GoldenTaskDefinition],
        handlers: dict[str, GoldenTaskHandler] | None = None,
    ):
        self.definitions = tuple(definitions)
        self.handlers = dict(handlers or {})
        ids = [definition.id for definition in self.definitions]
        if len(ids) != len(set(ids)):
            raise ValueError("duplicate golden task id")

    def run_one(self, definition: GoldenTaskDefinition) -> GoldenTaskResult:
        handler = self.handlers.get(definition.handler)
        if handler is None:
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.NOT_IMPLEMENTED,
                verified=False,
                error=f"missing handler: {definition.handler}",
            )

        started = time.monotonic()
        try:
            result = handler(definition)
        except Exception as exc:
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.ERROR,
                verified=False,
                duration_seconds=time.monotonic() - started,
                error=f"{type(exc).__name__}: {exc}",
            )

        if result.task_id != definition.id:
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.ERROR,
                verified=False,
                duration_seconds=time.monotonic() - started,
                error=f"handler returned result for {result.task_id}",
            )

        duration = result.duration_seconds or (time.monotonic() - started)
        if (
            result.outcome is GoldenTaskOutcome.PASS
            and definition.verification_required
            and not result.verified
        ):
            return GoldenTaskResult(
                task_id=definition.id,
                outcome=GoldenTaskOutcome.FAIL,
                verified=False,
                duration_seconds=duration,
                human_interventions=result.human_interventions,
                recovery_attempts=result.recovery_attempts,
                false_completion=True,
                evidence=dict(result.evidence),
                error="handler reported PASS without required verification",
            )
        return GoldenTaskResult(
            task_id=result.task_id,
            outcome=result.outcome,
            verified=result.verified,
            duration_seconds=duration,
            human_interventions=result.human_interventions,
            recovery_attempts=result.recovery_attempts,
            false_completion=result.false_completion,
            evidence=dict(result.evidence),
            error=result.error,
        )

    def run_all(self) -> tuple[GoldenTaskResult, ...]:
        return tuple(self.run_one(definition) for definition in self.definitions)

    @staticmethod
    def summarize(results: Iterable[GoldenTaskResult]) -> GoldenTaskSummary:
        results = tuple(results)
        return GoldenTaskSummary(
            total=len(results),
            passed=sum(r.outcome is GoldenTaskOutcome.PASS for r in results),
            verified_passed=sum(
                r.outcome is GoldenTaskOutcome.PASS and r.verified for r in results
            ),
            failed=sum(r.outcome is GoldenTaskOutcome.FAIL for r in results),
            blocked=sum(r.outcome is GoldenTaskOutcome.BLOCKED for r in results),
            not_implemented=sum(
                r.outcome is GoldenTaskOutcome.NOT_IMPLEMENTED for r in results
            ),
            errors=sum(r.outcome is GoldenTaskOutcome.ERROR for r in results),
            false_completions=sum(bool(r.false_completion) for r in results),
            human_interventions=sum(r.human_interventions for r in results),
            recovery_attempts=sum(r.recovery_attempts for r in results),
            duration_seconds=sum(r.duration_seconds for r in results),
        )


def load_golden_tasks(path: str | Path) -> tuple[GoldenTaskDefinition, ...]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("golden task manifest must be a JSON array")
    definitions = tuple(GoldenTaskDefinition.from_dict(item) for item in raw)
    ids = [definition.id for definition in definitions]
    if len(ids) != len(set(ids)):
        raise ValueError("duplicate golden task id")
    return definitions
