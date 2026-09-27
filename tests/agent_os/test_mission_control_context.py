from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_plugin_api():
    repo = Path(__file__).resolve().parents[2]
    path = repo / "plugins" / "agent-os" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("agent_os_mission_control_plugin_api", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_mission_context_mcp_target_never_exposes_url_credentials(monkeypatch):
    api = _load_plugin_api()

    from hermes_cli import mcp_config

    monkeypatch.setattr(
        mcp_config,
        "_get_mcp_servers",
        lambda: {
            "private-server": {
                "url": "https://user:super-secret@example.test/path",
                "auth": "oauth",
                "enabled": True,
            }
        },
    )

    rows = api._safe_mcp_servers()

    assert rows == [
        {
            "name": "private-server",
            "transport": "http",
            "auth": "oauth",
            "enabled": True,
            "target": "example.test",
            "tool_count": None,
        }
    ]
    assert "super-secret" not in repr(rows)
    assert "user:" not in repr(rows)


def test_mission_context_marks_active_memory_provider(monkeypatch):
    api = _load_plugin_api()

    from hermes_cli import config, web_server_memory

    monkeypatch.setattr(config, "load_config", lambda: {"memory": {"provider": "mem0"}})
    monkeypatch.setattr(
        web_server_memory,
        "_discover_memory_provider_statuses",
        lambda: [
            {
                "name": "honcho",
                "description": "Honcho",
                "available": True,
                "configured": True,
                "status": "ready",
            },
            {
                "name": "mem0",
                "description": "Mem0",
                "available": True,
                "configured": True,
                "status": "ready",
            },
        ],
    )

    projected = api._safe_memory_providers()

    assert projected["active"] == "mem0"
    rows = {row["name"]: row for row in projected["providers"]}
    assert rows["mem0"]["active"] is True
    assert rows["honcho"]["active"] is False


def test_mission_context_exposes_learning_graph_without_breaking_other_context(monkeypatch):
    api = _load_plugin_api()

    from agent import learning_graph

    monkeypatch.setattr(
        learning_graph,
        "build_learning_graph",
        lambda: {
            "nodes": [{"id": "memory:memory:0", "label": "Preference", "kind": "memory"}],
            "edges": [],
            "clusters": [{"category": "memory", "count": 1}],
            "memory": [{"source": "memory", "title": "Preference", "body": "Use concise output."}],
            "stats": {"memory_nodes": 1, "memory_skill_edges": 0, "learned_skills": 0},
        },
    )
    monkeypatch.setattr(api, "_safe_mcp_servers", lambda: [])
    monkeypatch.setattr(api, "_safe_memory_providers", lambda: {"active": "built-in", "providers": []})

    snapshot = api._mission_context_snapshot()

    assert snapshot["learning"]["stats"]["memory_nodes"] == 1
    assert snapshot["learning"]["memory"][0]["body"] == "Use concise output."
    assert snapshot["integrations"]["mcp_servers"] == []
    assert snapshot["integrations"]["memory_providers"]["active"] == "built-in"
    assert snapshot["generated_at"].endswith("+00:00")
