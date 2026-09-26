"""Typed planner contract and fail-closed plan compiler."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol

from agent_os.contracts import TaskRecord
from agent_os.store import AgentOSStore

from .plan import (
    InvalidPlan,
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    validate_plan_graph,
)


class Planner(Protocol):
    def plan(self, task: TaskRecord) -> "PlanProposal": ...


@dataclass(frozen=True, slots=True)
class ProposedStep:
    key: str
    title: str
    kind: PlanStepKind
    spec: dict[str, Any] = field(default_factory=dict)
    depends_on: tuple[str, ...] = ()
    priority: int = 0

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "ProposedStep":
        key = str(raw.get("key") or "").strip()
        title = str(raw.get("title") or "").strip()
        if not key:
            raise InvalidPlan("proposed step key must not be empty")
        if not title:
            raise InvalidPlan(f"proposed step {key!r} title must not be empty")
        try:
            kind = PlanStepKind(str(raw.get("kind") or "").strip().upper())
        except ValueError as exc:
            raise InvalidPlan(f"proposed step {key!r} has invalid kind") from exc
        spec = dict(raw.get("spec") or {})
        try:
            json.dumps(spec, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise InvalidPlan(f"proposed step {key!r} spec must be JSON-serializable") from exc
        depends = tuple(str(item).strip() for item in (raw.get("depends_on") or ()))
        if any(not item for item in depends):
            raise InvalidPlan(f"proposed step {key!r} has an empty dependency key")
        return cls(
            key=key,
            title=title,
            kind=kind,
            spec=spec,
            depends_on=depends,
            priority=int(raw.get("priority", 0)),
        )


@dataclass(frozen=True, slots=True)
class PlanProposal:
    objective: str
    steps: tuple[ProposedStep, ...]
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "PlanProposal":
        objective = str(raw.get("objective") or "").strip()
        if not objective:
            raise InvalidPlan("plan objective must not be empty")
        raw_steps = raw.get("steps")
        if not isinstance(raw_steps, list):
            raise InvalidPlan("plan steps must be a list")
        steps = tuple(ProposedStep.from_dict(item) for item in raw_steps)
        metadata = dict(raw.get("metadata") or {})
        try:
            json.dumps(metadata, sort_keys=True)
        except (TypeError, ValueError) as exc:
            raise InvalidPlan("plan metadata must be JSON-serializable") from exc
        return cls(objective=objective, steps=steps, metadata=metadata)


class PlanCompiler:
    """Validate an untrusted planner proposal and persist a typed DAG."""

    def __init__(
        self,
        store: AgentOSStore,
        *,
        max_steps: int = 100,
        require_verification_coverage: bool = True,
        allowed_action_tools: set[str] | frozenset[str] | None = None,
        allowed_agent_runtimes: set[str] | frozenset[str] | None = None,
    ):
        if max_steps < 1:
            raise ValueError("max_steps must be >= 1")
        self.store = store
        self.max_steps = max_steps
        self.require_verification_coverage = require_verification_coverage
        self.allowed_action_tools = (
            None
            if allowed_action_tools is None
            else frozenset(str(item).strip() for item in allowed_action_tools if str(item).strip())
        )
        self.allowed_agent_runtimes = (
            None
            if allowed_agent_runtimes is None
            else frozenset(str(item).strip() for item in allowed_agent_runtimes if str(item).strip())
        )

    def compile(
        self,
        task: TaskRecord,
        proposal: PlanProposal,
        *,
        revision: int = 1,
        activate: bool = True,
    ) -> PlanRecord:
        self._validate_proposal(proposal)
        plan = PlanRecord.create(
            task_id=task.id,
            objective=proposal.objective,
            revision=revision,
            metadata=proposal.metadata,
        )

        by_key: dict[str, PlanStepRecord] = {}
        for proposed in proposal.steps:
            by_key[proposed.key] = PlanStepRecord.create(
                plan_id=plan.id,
                task_id=task.id,
                title=proposed.title,
                kind=proposed.kind,
                spec=proposed.spec,
                priority=proposed.priority,
            )

        dependencies = {
            by_key[step.key].id: [by_key[key].id for key in step.depends_on]
            for step in proposal.steps
            if step.depends_on
        }
        validate_plan_graph(list(by_key.values()), dependencies)
        self.store.create_plan(plan, list(by_key.values()), dependencies)
        if activate:
            plan = self.store.transition_plan(plan.id, PlanState.ACTIVE)
        return plan

    def _validate_proposal(self, proposal: PlanProposal) -> None:
        if not proposal.steps:
            raise InvalidPlan("plan must contain at least one step")
        if len(proposal.steps) > self.max_steps:
            raise InvalidPlan(
                f"plan has {len(proposal.steps)} steps; max allowed is {self.max_steps}"
            )

        keys = [step.key for step in proposal.steps]
        if len(keys) != len(set(keys)):
            raise InvalidPlan("plan step keys must be unique")
        key_set = set(keys)
        for step in proposal.steps:
            unknown = [key for key in step.depends_on if key not in key_set]
            if unknown:
                raise InvalidPlan(
                    f"step {step.key!r} depends on unknown keys: {', '.join(unknown)}"
                )
            if step.key in step.depends_on:
                raise InvalidPlan(f"step {step.key!r} cannot depend on itself")

        self._validate_capabilities(proposal)
        if self.require_verification_coverage:
            self._validate_verification_coverage(proposal)

    def _validate_capabilities(self, proposal: PlanProposal) -> None:
        for step in proposal.steps:
            if step.kind in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION}:
                tool = str(step.spec.get("tool") or "").strip()
                operation = str(step.spec.get("operation") or "").strip()
                if not tool or not operation:
                    raise InvalidPlan(
                        f"{step.kind.value} step {step.key!r} requires spec.tool and spec.operation"
                    )
                if (
                    self.allowed_action_tools is not None
                    and tool not in self.allowed_action_tools
                ):
                    raise InvalidPlan(
                        f"step {step.key!r} requests unavailable action tool: {tool}"
                    )
            elif step.kind is PlanStepKind.AGENT:
                runtime = str(step.spec.get("runtime") or "").strip()
                if not runtime:
                    raise InvalidPlan(
                        f"AGENT step {step.key!r} requires spec.runtime"
                    )
                if (
                    self.allowed_agent_runtimes is not None
                    and runtime not in self.allowed_agent_runtimes
                ):
                    raise InvalidPlan(
                        f"step {step.key!r} requests unavailable agent runtime: {runtime}"
                    )

    @staticmethod
    def _validate_verification_coverage(proposal: PlanProposal) -> None:
        verification = {
            step.key for step in proposal.steps
            if step.kind is PlanStepKind.VERIFICATION
        }
        if not verification:
            raise InvalidPlan("plan requires at least one VERIFICATION step")

        dependents: dict[str, set[str]] = {step.key: set() for step in proposal.steps}
        deps: dict[str, set[str]] = {
            step.key: set(step.depends_on) for step in proposal.steps
        }
        for step in proposal.steps:
            for dependency in step.depends_on:
                dependents[dependency].add(step.key)

        terminal_work = {
            step.key
            for step in proposal.steps
            if step.kind is not PlanStepKind.VERIFICATION
            and not dependents[step.key]
        }

        covered: set[str] = set()
        stack = list(verification)
        seen: set[str] = set()
        while stack:
            key = stack.pop()
            if key in seen:
                continue
            seen.add(key)
            for dependency in deps.get(key, set()):
                covered.add(dependency)
                stack.append(dependency)

        uncovered = sorted(terminal_work - covered)
        if uncovered:
            raise InvalidPlan(
                "terminal work branches are not covered by verification: "
                + ", ".join(uncovered)
            )
