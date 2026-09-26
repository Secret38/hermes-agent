"""Persistent supervisor adapter for Hermes in-process subagents."""

from __future__ import annotations

import dataclasses
import os
from typing import Any

import psutil

from agent.subagent_lifecycle import (
    SubagentHandle,
    SubagentLaunchRequest,
    SubagentLifecycleService,
    SubagentState,
)

from agent_os.agents.records import AgentInstanceRecord, AgentInstanceState
from agent_os.agents.runtime import RuntimeLaunch, RuntimeSnapshot


class HermesSubagentRuntimeAdapter:
    """Bridge the process-local Hermes lifecycle into the durable Agent OS supervisor.

    A serialized Hermes handle is reconnectable only inside the process whose
    capability secret created it. We persist the owner PID + process create time.
    Re-dispatch is safe only after that exact owner process is confirmed gone.
    """

    runtime_name = "hermes-subagent"

    def __init__(self, service: SubagentLifecycleService):
        self.service = service

    def launch(self, agent: AgentInstanceRecord) -> RuntimeLaunch:
        spec = dict(agent.launch_spec)
        request = SubagentLaunchRequest(
            goal=agent.goal,
            context=spec.get("context"),
            role=agent.role,
            model=spec.get("model"),
            allowed_toolsets=self._tuple_or_none(spec.get("allowed_toolsets")),
            blocked_tools=tuple(spec.get("blocked_tools") or ()),
            working_directory=spec.get("working_directory"),
            correlation_id=spec.get("correlation_id"),
            metadata=dict(spec.get("metadata") or {}),
            timeout_seconds=spec.get("timeout_seconds"),
        )
        handle = self.service.launch(request)
        return RuntimeLaunch(
            handle={
                "handle": handle.to_dict(),
                "owner_pid": os.getpid(),
                "owner_create_time": self._process_create_time(os.getpid()),
            },
            state=AgentInstanceState.STARTING,
        )

    def inspect(self, agent: AgentInstanceRecord) -> RuntimeSnapshot:
        raw = dict(agent.runtime_handle or {})
        handle_raw = raw.get("handle")
        owner_pid = raw.get("owner_pid")
        owner_create_time = raw.get("owner_create_time")

        if not isinstance(handle_raw, dict):
            return RuntimeSnapshot(
                False,
                AgentInstanceState.ORPHANED,
                "MISSING_RUNTIME_HANDLE",
                safe_to_restart=False,
            )

        if not isinstance(owner_pid, int) or not isinstance(owner_create_time, (int, float)):
            return RuntimeSnapshot(
                False,
                AgentInstanceState.ORPHANED,
                "MISSING_OWNER_FINGERPRINT",
                safe_to_restart=False,
            )

        current_pid = os.getpid()
        current_create_time = self._process_create_time(current_pid)
        same_owner = (
            owner_pid == current_pid
            and current_create_time is not None
            and abs(float(owner_create_time) - current_create_time) < 0.01
        )

        if not same_owner:
            owner_alive = self._process_matches(owner_pid, float(owner_create_time))
            return RuntimeSnapshot(
                False,
                AgentInstanceState.ORPHANED,
                "OWNER_PROCESS_STILL_ALIVE" if owner_alive else "OWNER_PROCESS_GONE",
                safe_to_restart=not owner_alive,
            )

        try:
            handle = SubagentHandle.from_dict(handle_raw)
            reconnect = self.service.reconnect(handle)
        except Exception as exc:
            return RuntimeSnapshot(
                False,
                AgentInstanceState.ORPHANED,
                f"RECONNECT_ERROR:{type(exc).__name__}",
                safe_to_restart=False,
            )

        if not reconnect.connected:
            return RuntimeSnapshot(
                False,
                AgentInstanceState.ORPHANED,
                reconnect.diagnostic or "RECONNECT_UNAVAILABLE",
                safe_to_restart=False,
            )

        state = self._map_state(reconnect.state)
        result_payload: dict[str, Any] = {}
        error: str | None = None
        diagnostic = reconnect.diagnostic

        if state in {
            AgentInstanceState.SUCCEEDED,
            AgentInstanceState.FAILED,
            AgentInstanceState.CANCELLED,
        }:
            try:
                result = self.service.result(handle)
                if result.ready:
                    result_payload = dataclasses.asdict(result)
                    error = result.error_message
            except Exception as exc:
                diagnostic = f"RESULT_READ_ERROR:{type(exc).__name__}"

        return RuntimeSnapshot(
            True,
            state,
            diagnostic=diagnostic,
            safe_to_restart=False,
            result=result_payload,
            error=error,
        )

    @staticmethod
    def _map_state(state: SubagentState) -> AgentInstanceState:
        return {
            SubagentState.PENDING: AgentInstanceState.STARTING,
            SubagentState.STARTING: AgentInstanceState.STARTING,
            SubagentState.RUNNING: AgentInstanceState.RUNNING,
            SubagentState.CANCEL_REQUESTED: AgentInstanceState.CANCELLING,
            SubagentState.CANCELLED: AgentInstanceState.CANCELLED,
            SubagentState.SUCCEEDED: AgentInstanceState.SUCCEEDED,
            SubagentState.FAILED: AgentInstanceState.FAILED,
            SubagentState.INTERRUPTED: AgentInstanceState.FAILED,
            SubagentState.UNKNOWN: AgentInstanceState.ORPHANED,
        }[state]

    @staticmethod
    def _tuple_or_none(value) -> tuple[str, ...] | None:
        if value is None:
            return None
        return tuple(str(item) for item in value)

    @staticmethod
    def _process_create_time(pid: int) -> float | None:
        try:
            return float(psutil.Process(pid).create_time())
        except (psutil.Error, OSError):
            return None

    @classmethod
    def _process_matches(cls, pid: int, create_time: float) -> bool:
        observed = cls._process_create_time(pid)
        return observed is not None and abs(observed - create_time) < 0.01
