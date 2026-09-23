"""Agent OS Mission Control dashboard API.

Mounted by Hermes under /api/plugins/agent-os/. All endpoints are read-only;
the projection itself opens agent_os.db with SQLite mode=ro + query_only.
"""

from __future__ import annotations

from functools import partial

from fastapi import APIRouter, Query
from starlette.concurrency import run_in_threadpool

from agent_os.dashboard import build_dashboard_snapshot

router = APIRouter()


@router.get("/snapshot")
async def snapshot(limit: int = Query(40, ge=1, le=100)):
    return await run_in_threadpool(partial(build_dashboard_snapshot, limit=limit))
