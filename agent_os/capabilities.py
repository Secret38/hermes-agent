"""Single source of truth for Agent OS executable capabilities."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping, Any


@dataclass(frozen=True, slots=True)
class CapabilityCatalog:
    action_tools: frozenset[str]
    agent_runtimes: frozenset[str]

    @classmethod
    def create(
        cls,
        *,
        action_tools: Iterable[str] = (),
        agent_runtimes: Iterable[str] = (),
    ) -> "CapabilityCatalog":
        tools = frozenset(str(item).strip() for item in action_tools if str(item).strip())
        runtimes = frozenset(str(item).strip() for item in agent_runtimes if str(item).strip())
        return cls(tools, runtimes)

    @classmethod
    def from_execution(
        cls,
        *,
        action_kernels: Mapping[str, Any],
        agent_runtime_adapters: Iterable[Any],
    ) -> "CapabilityCatalog":
        runtimes: list[str] = []
        for adapter in agent_runtime_adapters:
            name = str(getattr(adapter, "runtime_name", "") or "").strip()
            if not name:
                raise ValueError("agent runtime adapter must expose non-empty runtime_name")
            runtimes.append(name)
        return cls.create(
            action_tools=action_kernels.keys(),
            agent_runtimes=runtimes,
        )

    def prompt_text(self) -> str:
        tools = ", ".join(sorted(self.action_tools)) or "(none)"
        runtimes = ", ".join(sorted(self.agent_runtimes)) or "(none)"
        return (
            f"Allowed ACTION/VERIFICATION tools: {tools}.\n"
            f"Allowed AGENT runtimes: {runtimes}."
        )
