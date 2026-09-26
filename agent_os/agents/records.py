"""Persistent Agent OS agent-instance contract and lifecycle."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from agent_os.contracts import new_id, utc_now_iso


class InvalidAgentTransition(ValueError):
    """Raised when an agent-instance state transition is invalid."""


class AgentInstanceState(StrEnum):
    CREATED = "CREATED"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    CANCELLING = "CANCELLING"
    ORPHANED = "ORPHANED"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


AGENT_TRANSITIONS: dict[AgentInstanceState, frozenset[AgentInstanceState]] = {
    AgentInstanceState.CREATED: frozenset({
        AgentInstanceState.STARTING,
        AgentInstanceState.CANCELLED,
        AgentInstanceState.FAILED,
    }),
    AgentInstanceState.STARTING: frozenset({
        AgentInstanceState.RUNNING,
        AgentInstanceState.ORPHANED,
        AgentInstanceState.SUCCEEDED,
        AgentInstanceState.FAILED,
        AgentInstanceState.CANCELLED,
    }),
    AgentInstanceState.RUNNING: frozenset({
        AgentInstanceState.CANCELLING,
        AgentInstanceState.ORPHANED,
        AgentInstanceState.SUCCEEDED,
        AgentInstanceState.FAILED,
    }),
    AgentInstanceState.CANCELLING: frozenset({
        AgentInstanceState.ORPHANED,
        AgentInstanceState.CANCELLED,
        AgentInstanceState.FAILED,
    }),
    AgentInstanceState.ORPHANED: frozenset({
        AgentInstanceState.STARTING,
        AgentInstanceState.RUNNING,
        AgentInstanceState.SUCCEEDED,
        AgentInstanceState.FAILED,
        AgentInstanceState.CANCELLED,
    }),
    AgentInstanceState.SUCCEEDED: frozenset(),
    AgentInstanceState.FAILED: frozenset(),
    AgentInstanceState.CANCELLED: frozenset(),
}

_TERMINAL = frozenset({
    AgentInstanceState.SUCCEEDED,
    AgentInstanceState.FAILED,
    AgentInstanceState.CANCELLED,
})


def validate_agent_transition(current: AgentInstanceState, target: AgentInstanceState) -> None:
    if current == target:
        return
    if target not in AGENT_TRANSITIONS[current]:
        raise InvalidAgentTransition(
            f"invalid agent transition: {current.value} -> {target.value}"
        )


def agent_is_terminal(state: AgentInstanceState) -> bool:
    return state in _TERMINAL


@dataclass(frozen=True, slots=True)
class AgentInstanceRecord:
    id: str
    task_id: str
    runtime: str
    goal: str
    state: AgentInstanceState = AgentInstanceState.CREATED
    parent_agent_id: str | None = None
    role: str = "leaf"
    launch_spec: dict[str, Any] = field(default_factory=dict)
    runtime_handle: dict[str, Any] = field(default_factory=dict)
    restart_count: int = 0
    max_restarts: int = 1
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    diagnostic: str | None = None
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)
    started_at: str | None = None
    completed_at: str | None = None

    @classmethod
    def create(
        cls,
        *,
        task_id: str,
        runtime: str,
        goal: str,
        parent_agent_id: str | None = None,
        role: str = "leaf",
        launch_spec: dict[str, Any] | None = None,
        max_restarts: int = 1,
    ) -> "AgentInstanceRecord":
        if not task_id.strip():
            raise ValueError("agent task_id must not be empty")
        if not runtime.strip():
            raise ValueError("agent runtime must not be empty")
        if not goal.strip():
            raise ValueError("agent goal must not be empty")
        if max_restarts < 0:
            raise ValueError("max_restarts must be >= 0")
        return cls(
            id=new_id("agent"),
            task_id=task_id,
            runtime=runtime.strip(),
            goal=goal.strip(),
            parent_agent_id=parent_agent_id,
            role=role.strip() or "leaf",
            launch_spec=dict(launch_spec or {}),
            max_restarts=max_restarts,
        )
