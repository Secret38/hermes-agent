from __future__ import annotations

from pathlib import Path


def _source(name: str) -> str:
    repo = Path(__file__).resolve().parents[2]
    return (repo / "apps" / "desktop" / "src" / "plugins" / "agent-os" / name).read_text(encoding="utf-8")


def test_mission_control_keeps_interactive_process_visualization_contract():
    page = _source("page.tsx")

    for marker in (
        "Process map",
        "Step inspector",
        "Event inspector",
        "Action inspector",
        "Needs attention",
        "All execution events",
        "Open originating session",
        "Agent topology",
        "Actions · risk · verification",
    ):
        assert marker in page

    assert "setSelectedStepId" in page
    assert "setSelectedEventId" in page
    assert "setSelectedActionId" in page
    assert "WAITING_PERMISSION" in page
    assert "verification_result" in page


def test_mission_control_keeps_semantic_memory_and_connection_visualization_contract():
    page = _source("page.tsx")
    context = _source("context.tsx")
    api = _source("api.ts")

    assert "SemanticMemorySection" in page
    assert "ExternalConnectionsSection" in page

    for marker in (
        "Semantic memory graph",
        "Hermes knowledge",
        "Connected to",
        "External connections",
        "MCP servers",
        "Memory providers",
        "Manage capabilities",
    ):
        assert marker in context

    assert "fetchAgentOSContext" in api
    assert "AGENT_OS_CONTEXT_KEY" in api


def test_mission_control_refresh_covers_live_and_slow_context():
    page = _source("page.tsx")

    assert "refetch()" in page
    assert "invalidateQueries({ queryKey: AGENT_OS_CONTEXT_KEY })" in page
    assert "Refresh Agent OS state, memory and connections" in page
