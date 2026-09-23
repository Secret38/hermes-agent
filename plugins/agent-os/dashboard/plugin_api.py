"""Agent OS Mission Control dashboard API.

Mounted by Hermes under /api/plugins/agent-os/. Reads are fail-safe and
side-effect free: the projection opens agent_os.db in SQLite mode=ro +
query_only. The event socket only publishes the monotonic ledger sequence so
clients can invalidate their cached snapshot without receiving sensitive event
payloads over the socket.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from functools import partial
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from agent_os.dashboard import build_dashboard_snapshot, dashboard_event_sequence

router = APIRouter()


def _safe_learning_graph():
    try:
        from agent.learning_graph import build_learning_graph

        return build_learning_graph()
    except Exception as exc:
        return {
            "nodes": [],
            "edges": [],
            "clusters": [],
            "memory": [],
            "stats": {
                "nodes": 0,
                "related_edges": 0,
                "memory_nodes": 0,
                "memory_skill_edges": 0,
                "learned_skills": 0,
            },
            "error": f"{type(exc).__name__}: {exc}",
        }


def _safe_mcp_servers():
    try:
        from hermes_cli.mcp_config import _get_mcp_servers
        from hermes_cli.web_server_mcp import _mcp_server_summary

        rows = []
        for name, cfg in sorted(_get_mcp_servers().items()):
            item = _mcp_server_summary(name, cfg)
            target = ""
            if item.get("url"):
                try:
                    parsed = urlparse(str(item["url"]))
                    target = parsed.netloc or parsed.hostname or ""
                except ValueError:
                    target = ""
            elif item.get("command"):
                target = Path(str(item["command"])).name
            tools = item.get("tools")
            rows.append({
                "name": str(item.get("name") or name),
                "transport": str(item.get("transport") or "unknown"),
                "auth": item.get("auth"),
                "enabled": bool(item.get("enabled", True)),
                "target": target,
                "tool_count": len(tools) if isinstance(tools, list) else None,
            })
        return rows
    except Exception as exc:
        return [{"name": "MCP inventory", "transport": "unknown", "auth": None, "enabled": False,
                 "target": "", "tool_count": None, "error": f"{type(exc).__name__}: {exc}"}]


def _safe_memory_providers():
    try:
        from hermes_cli.config import load_config
        from hermes_cli.web_server_memory import _discover_memory_provider_statuses

        cfg = load_config() or {}
        memory = cfg.get("memory") if isinstance(cfg.get("memory"), dict) else {}
        active = str((memory or {}).get("provider") or "").strip()
        if active.lower() in {"built-in", "builtin", "none"}:
            active = ""
        rows = []
        for raw in _discover_memory_provider_statuses():
            rows.append({
                "name": str(raw.get("name") or ""),
                "description": str(raw.get("description") or ""),
                "available": bool(raw.get("available")),
                "configured": bool(raw.get("configured")),
                "status": str(raw.get("status") or "unknown"),
                "active": bool(active and str(raw.get("name") or "") == active),
            })
        return {"active": active or "built-in", "providers": rows}
    except Exception as exc:
        return {"active": "unknown", "providers": [], "error": f"{type(exc).__name__}: {exc}"}


def _mission_context_snapshot():
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "learning": _safe_learning_graph(),
        "integrations": {
            "mcp_servers": _safe_mcp_servers(),
            "memory_providers": _safe_memory_providers(),
        },
    }


def _ws_upgrade_authorized(ws: WebSocket) -> bool:
    """Use the dashboard's canonical websocket auth gate when available."""

    try:
        from hermes_cli import web_server_chat as websocket_auth
    except Exception:
        # Bare FastAPI/unit-test harness: the canonical dashboard auth module is
        # not present, so preserve the same testing contract as bundled Kanban.
        return True
    return bool(websocket_auth._ws_auth_ok(ws))


@router.get("/snapshot")
async def snapshot(limit: int = Query(40, ge=1, le=100)):
    return await run_in_threadpool(partial(build_dashboard_snapshot, limit=limit))


@router.get("/context")
async def context_snapshot():
    """Slower semantic-memory and integration inventory for Mission Control."""

    return await run_in_threadpool(_mission_context_snapshot)


@router.websocket("/events")
async def events(ws: WebSocket):
    if not _ws_upgrade_authorized(ws):
        await ws.close(code=4401)
        return

    await ws.accept()
    last_sequence = -1

    try:
        while True:
            sequence = await run_in_threadpool(dashboard_event_sequence)
            if sequence != last_sequence:
                last_sequence = sequence
                await ws.send_json({"type": "ledger.changed", "sequence": sequence})
            await asyncio.sleep(0.75)
    except WebSocketDisconnect:
        return
