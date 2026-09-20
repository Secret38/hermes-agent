"""Runtime-neutral agent supervisor contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .records import AgentInstanceRecord, AgentInstanceState


@dataclass(frozen=True, slots=True)
class RuntimeLaunch:
    handle: dict[str, Any]
    state: AgentInstanceState = AgentInstanceState.STARTING
    diagnostic: str | None = None


@dataclass(frozen=True, slots=True)
class RuntimeSnapshot:
    connected: bool
    state: AgentInstanceState
    diagnostic: str | None = None
    safe_to_restart: bool = False
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


class AgentRuntimeAdapter(Protocol):
    runtime_name: str

    def launch(self, agent: AgentInstanceRecord) -> RuntimeLaunch: ...

    def inspect(self, agent: AgentInstanceRecord) -> RuntimeSnapshot: ...
