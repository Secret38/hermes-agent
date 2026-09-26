from __future__ import annotations

import os

from agent.subagent_lifecycle import (
    SubagentHandle,
    SubagentReconnectResult,
    SubagentResult,
    SubagentState,
)

from agent_os.adapters.hermes_subagent import HermesSubagentRuntimeAdapter
from agent_os.agents.records import AgentInstanceRecord, AgentInstanceState


class FakeService:
    def __init__(self, reconnect_state=SubagentState.RUNNING, connected=True):
        self.reconnect_state = reconnect_state
        self.connected = connected
        self.launches = 0

    def launch(self, request):
        self.launches += 1
        return SubagentHandle(
            contract_version=1,
            subagent_id=f"sa-{self.launches}",
            parent_session_id="parent",
            correlation_id=request.correlation_id,
            created_at=1.0,
            provider="test",
            model="test",
            role=request.role,
            depth=1,
            capability="cap",
        )

    def reconnect(self, handle):
        return SubagentReconnectResult(
            self.connected,
            self.reconnect_state,
            None if self.connected else "RECONNECT_UNAVAILABLE",
        )

    def result(self, handle):
        return SubagentResult(
            handle,
            self.reconnect_state,
            True,
            summary="done",
        )


def make_agent(handle):
    return AgentInstanceRecord(
        id="agent-1",
        task_id="task-1",
        runtime="hermes-subagent",
        goal="work",
        state=AgentInstanceState.RUNNING,
        runtime_handle=handle,
    )


def test_foreign_live_owner_is_not_safe_to_restart(monkeypatch):
    adapter = HermesSubagentRuntimeAdapter(FakeService())
    monkeypatch.setattr(adapter, "_process_matches", lambda pid, created: True)

    snapshot = adapter.inspect(
        make_agent({
            "handle": {"contract_version": 1},
            "owner_pid": os.getpid() + 1000,
            "owner_create_time": 1.0,
        })
    )

    assert snapshot.connected is False
    assert snapshot.safe_to_restart is False
    assert snapshot.diagnostic == "OWNER_PROCESS_STILL_ALIVE"


def test_foreign_dead_owner_is_safe_to_restart(monkeypatch):
    adapter = HermesSubagentRuntimeAdapter(FakeService())
    monkeypatch.setattr(adapter, "_process_matches", lambda pid, created: False)

    snapshot = adapter.inspect(
        make_agent({
            "handle": {"contract_version": 1},
            "owner_pid": os.getpid() + 1000,
            "owner_create_time": 1.0,
        })
    )

    assert snapshot.safe_to_restart is True
    assert snapshot.diagnostic == "OWNER_PROCESS_GONE"


def test_same_owner_reconnects_and_maps_terminal_result(monkeypatch):
    service = FakeService(reconnect_state=SubagentState.SUCCEEDED)
    adapter = HermesSubagentRuntimeAdapter(service)
    current_created = adapter._process_create_time(os.getpid())
    handle = service.launch(type("Req", (), {"correlation_id": None, "role": "leaf"})())

    snapshot = adapter.inspect(
        make_agent({
            "handle": handle.to_dict(),
            "owner_pid": os.getpid(),
            "owner_create_time": current_created,
        })
    )

    assert snapshot.connected is True
    assert snapshot.state is AgentInstanceState.SUCCEEDED
    assert snapshot.result["summary"] == "done"
