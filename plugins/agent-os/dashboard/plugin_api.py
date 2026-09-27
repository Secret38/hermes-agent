"""Agent OS Mission Control dashboard API.

Mounted by Hermes under /api/plugins/agent-os/. Snapshot reads are fail-safe
and side-effect free: the projection opens agent_os.db in SQLite mode=ro +
query_only. Explicit mission/approval endpoints are the only mutating control
surface. The event socket only publishes the monotonic ledger sequence so
clients can invalidate their cached snapshot without receiving sensitive event
payloads over the socket.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from functools import lru_cache, partial
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from agent_os.dashboard import build_dashboard_snapshot, dashboard_event_sequence
from agent_os.live_frames import live_runtime_frames
from agent_os.mission_control import MissionBusyError, MissionPausedError, MissionRuntimeService

router = APIRouter()


class MissionCreateRequest(BaseModel):
    goal: str = Field(min_length=1, max_length=16_000)
    workspace_id: str | None = Field(default=None, max_length=4096)
    session_id: str | None = Field(default=None, max_length=512)


class ApprovalDecisionRequest(BaseModel):
    choice: Literal["allow_once", "deny"]


class MissionResumeRequest(BaseModel):
    confirm: Literal[True] = True


@lru_cache(maxsize=1)
def _mission_service() -> MissionRuntimeService:
    return MissionRuntimeService()



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
                    target = parsed.hostname or ""
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


@router.get("/missions")
async def mission_jobs(limit: int = Query(20, ge=1, le=100)):
    return {
        "jobs": await run_in_threadpool(
            partial(_mission_service().jobs, limit=limit)
        )
    }


@router.post("/missions")
async def create_mission(request: MissionCreateRequest):
    service = _mission_service()
    try:
        job = service.submit(
            request.goal,
            workspace_id=request.workspace_id,
            session_id=request.session_id,
        )
    except (MissionBusyError, MissionPausedError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "job": job}


@router.post("/missions/{job_id}/resume")
async def resume_mission(job_id: str, _request: MissionResumeRequest):
    service = _mission_service()
    try:
        job = service.resume(job_id)
    except (MissionBusyError, MissionPausedError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "job": job}


@router.get("/approvals")
async def pending_approvals():
    return {"approvals": _mission_service().approvals.pending()}


@router.post("/approvals/{request_id}")
async def resolve_approval(
    request_id: str,
    request: ApprovalDecisionRequest,
):
    try:
        resolved = _mission_service().approvals.resolve(
            request_id,
            request.choice,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not resolved:
        raise HTTPException(
            status_code=404,
            detail="Approval request is no longer pending.",
        )
    return {"ok": True, "request_id": request_id, "choice": request.choice}


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


@router.websocket("/live/{task_id}")
async def live_runtime_frames_socket(
    ws: WebSocket,
    task_id: str,
    session_id: str | None = None,
):
    """Stream the newest in-memory CUA frame for one exact Agent OS task.

    Opening this socket is the opt-in. The endpoint never triggers a capture,
    never persists pixels, and never replays expired frames.
    """

    if not _ws_upgrade_authorized(ws):
        await ws.close(code=4401)
        return

    task_key = str(task_id).strip()
    session_key = str(session_id or "").strip()
    if (
        not task_key
        or len(task_key) > 512
        or not session_key
        or len(session_key) > 512
    ):
        await ws.close(code=4400)
        return

    await ws.accept()
    last_token: tuple[str, float] | None = None
    announced_empty = False

    try:
        while True:
            frame = live_runtime_frames.latest(task_key, session_id=session_key)
            if frame is None:
                if last_token is not None:
                    last_token = None
                    announced_empty = True
                    await ws.send_json(
                        {"type": "runtime.frame.expired", "task_id": task_key}
                    )
                elif not announced_empty:
                    announced_empty = True
                    await ws.send_json(
                        {"type": "runtime.frame.waiting", "task_id": task_key}
                    )
            else:
                token = (frame.action_id, frame.captured_at)
                if token != last_token:
                    last_token = token
                    announced_empty = False
                    await ws.send_json(frame.payload())
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        return
