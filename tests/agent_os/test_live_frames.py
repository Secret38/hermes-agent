from __future__ import annotations

from datetime import datetime, timezone

from agent_os.live_frames import LiveFrameBroker


def test_live_frame_broker_is_task_scoped_bounded_and_expires():
    now = [100.0]
    broker = LiveFrameBroker(
        ttl_seconds=5,
        max_tasks=2,
        clock=lambda: now[0],
        wall_clock=lambda: datetime(2026, 1, 1, tzinfo=timezone.utc),
    )

    assert broker.begin_watch("task-1") is True
    assert broker.begin_watch("task-2") is True
    assert broker.begin_watch("task-3") is True

    first = broker.publish(
        task_id="task-1",
        action_id="action-1",
        data_url="data:image/png;base64,AAAA",
        width=100,
        height=80,
    )
    second = broker.publish(
        task_id="task-2",
        action_id="action-2",
        data_url="data:image/jpeg;base64,BBBB",
    )

    assert first is not None
    assert second is not None
    assert broker.latest("task-1") == first
    assert broker.latest("task-2") == second
    assert broker.latest("task-missing") is None

    third = broker.publish(
        task_id="task-3",
        action_id="action-3",
        data_url="data:image/webp;base64,CCCC",
    )
    assert third is not None
    assert broker.latest("task-1") is None
    assert broker.latest("task-3") == third

    now[0] = 106.0
    assert broker.latest("task-2") is None
    assert broker.latest("task-3") is None



def test_live_frame_broker_rejects_non_image_payloads():
    broker = LiveFrameBroker(ttl_seconds=5, max_tasks=2)
    assert broker.begin_watch("task-b") is True

    assert (
        broker.publish(
            task_id="task-b",
            action_id="action-b",
            data_url="data:text/plain;base64,AAAA",
        )
        is None
    )
    assert (
        broker.publish(
            task_id="task-b",
            action_id="action-b",
            data_url="data:image/png,not-base64",
        )
        is None
    )


def test_live_frame_dashboard_socket_is_authenticated_and_task_scoped():
    from pathlib import Path

    source = (
        Path(__file__).resolve().parents[2]
        / "plugins"
        / "agent-os"
        / "dashboard"
        / "plugin_api.py"
    ).read_text(encoding="utf-8")

    route = source.index('@router.websocket("/live-frames")')
    auth = source.index("if not _ws_upgrade_authorized(ws):", route)
    accept = source.index("await ws.accept()", route)
    task_lookup = source.index("_mission_service().store.get_task", route)

    assert route < auth < task_lookup < accept
    assert 'ws.query_params.get("task_id")' in source[route:]
    assert "live_frame_broker()" in source[route:]



def test_live_frame_broker_keeps_no_pixels_without_an_active_watcher():
    broker = LiveFrameBroker(ttl_seconds=5, max_tasks=2)

    assert (
        broker.publish(
            task_id="task-private",
            action_id="action-1",
            data_url="data:image/png;base64,AAAA",
        )
        is None
    )
    assert broker.latest("task-private") is None

    assert broker.begin_watch("task-private") is True
    frame = broker.publish(
        task_id="task-private",
        action_id="action-2",
        data_url="data:image/png;base64,BBBB",
    )
    assert frame is not None
    assert broker.latest("task-private") == frame

    broker.end_watch("task-private")
    assert broker.latest("task-private") is None
