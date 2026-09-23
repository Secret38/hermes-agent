"""Agent OS Mission Control dashboard API.

Mounted by Hermes under /api/plugins/agent-os/. Reads are fail-safe and
side-effect free: the projection opens agent_os.db in SQLite mode=ro +
query_only. The event socket only publishes the monotonic ledger sequence so
clients can invalidate their cached snapshot without receiving sensitive event
payloads over the socket.
"""

from __future__ import annotations

import asyncio
from functools import partial

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from agent_os.dashboard import build_dashboard_snapshot, dashboard_event_sequence

router = APIRouter()


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
