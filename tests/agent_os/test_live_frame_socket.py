from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from fastapi import WebSocketDisconnect

from agent_os.live_frames import LiveRuntimeFrame


class _FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.closed: list[int] = []
        self.sent: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int) -> None:
        self.closed.append(code)

    async def send_json(self, payload: dict) -> None:
        self.sent.append(payload)


def _plugin_api():
    path = (
        Path(__file__).resolve().parents[2]
        / "plugins"
        / "agent-os"
        / "dashboard"
        / "plugin_api.py"
    )
    spec = importlib.util.spec_from_file_location("agent_os_dashboard_plugin_api_live_test", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_live_socket_rejects_unauthorized_upgrade(monkeypatch):
    module = _plugin_api()
    ws = _FakeWebSocket()
    monkeypatch.setattr(module, "_ws_upgrade_authorized", lambda _ws: False)

    await module.live_runtime_frames_socket(ws, "task-1", "session-1")

    assert ws.accepted is False
    assert ws.closed == [4401]
    assert ws.sent == []


@pytest.mark.asyncio
async def test_live_socket_requires_task_and_session_scope(monkeypatch):
    module = _plugin_api()
    ws = _FakeWebSocket()
    monkeypatch.setattr(module, "_ws_upgrade_authorized", lambda _ws: True)

    await module.live_runtime_frames_socket(ws, "task-1", None)

    assert ws.accepted is False
    assert ws.closed == [4400]


@pytest.mark.asyncio
async def test_live_socket_reads_only_exact_task_and_session(monkeypatch):
    module = _plugin_api()
    ws = _FakeWebSocket()
    seen: list[tuple[str, str | None]] = []
    frame = LiveRuntimeFrame(
        task_id="task-1",
        session_id="session-1",
        action_id="action-1",
        mime_type="image/png",
        image_b64="ZnJhbWU=",
        width=640,
        height=480,
        captured_at=10.0,
        expires_at=18.0,
    )

    monkeypatch.setattr(module, "_ws_upgrade_authorized", lambda _ws: True)

    def latest(task_id: str, *, session_id: str | None = None):
        seen.append((task_id, session_id))
        return frame

    monkeypatch.setattr(module.live_runtime_frames, "latest", latest)

    async def stop_after_first_frame(_seconds: float) -> None:
        raise WebSocketDisconnect()

    monkeypatch.setattr(module.asyncio, "sleep", stop_after_first_frame)

    await module.live_runtime_frames_socket(ws, "task-1", "session-1")

    assert ws.accepted is True
    assert seen == [("task-1", "session-1")]
    assert ws.sent == [frame.payload()]
    assert "captured_at" not in ws.sent[0]
    assert "expires_at" not in ws.sent[0]
