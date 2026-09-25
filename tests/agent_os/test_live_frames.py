from __future__ import annotations

import base64

from agent_os.live_frames import LiveRuntimeFrameBroker


def _multimodal(payload: bytes = b"png") -> dict:
    encoded = base64.b64encode(payload).decode("ascii")
    return {
        "_multimodal": True,
        "content": [
            {"type": "text", "text": "capture"},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{encoded}"},
            },
        ],
        "meta": {"width": 1280, "height": 720},
    }


def test_live_frame_broker_keeps_latest_frame_in_memory_with_ttl():
    broker = LiveRuntimeFrameBroker(ttl_seconds=5, max_frame_bytes=1024)

    first = broker.publish_multimodal(
        task_id="task-1",
        session_id="session-1",
        action_id="action-1",
        raw=_multimodal(b"first"),
        now=10,
    )
    assert first is not None
    assert broker.latest("task-1", session_id="session-1", now=14) == first
    assert broker.latest("task-1", session_id="wrong", now=14) is None
    assert broker.latest("task-1", now=15) is None


def test_live_frame_broker_replaces_frames_per_task_without_cross_task_leakage():
    broker = LiveRuntimeFrameBroker(ttl_seconds=10, max_frame_bytes=1024)

    broker.publish_multimodal(
        task_id="task-a",
        session_id="session-a",
        action_id="action-a1",
        raw=_multimodal(b"a1"),
        now=1,
    )
    latest_a = broker.publish_multimodal(
        task_id="task-a",
        session_id="session-a",
        action_id="action-a2",
        raw=_multimodal(b"a2"),
        now=2,
    )
    broker.publish_multimodal(
        task_id="task-b",
        session_id="session-b",
        action_id="action-b",
        raw=_multimodal(b"b"),
        now=2,
    )

    assert broker.latest("task-a", now=3) == latest_a
    assert broker.latest("task-a", now=3).action_id == "action-a2"
    assert broker.latest("task-b", now=3).task_id == "task-b"


def test_live_frame_broker_rejects_invalid_oversized_or_non_image_payloads():
    broker = LiveRuntimeFrameBroker(ttl_seconds=10, max_frame_bytes=4)

    assert broker.publish_multimodal(
        task_id="task",
        session_id="session",
        action_id="action",
        raw=_multimodal(b"12345"),
        now=1,
    ) is None

    assert broker.publish_multimodal(
        task_id="task",
        session_id="session",
        action_id="action",
        raw={
            "_multimodal": True,
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": "data:text/plain;base64,SGVsbG8="},
                }
            ],
        },
        now=1,
    ) is None

    assert broker.publish_multimodal(
        task_id="task",
        session_id="session",
        action_id="action",
        raw={"ok": True},
        now=1,
    ) is None


def test_live_frame_broker_physically_expires_without_followup_read(monkeypatch):
    timers = []

    class FakeTimer:
        def __init__(self, interval, function, args=()):
            self.interval = interval
            self.function = function
            self.args = args
            self.daemon = False
            self.cancelled = False
            timers.append(self)

        def start(self):
            return None

        def cancel(self):
            self.cancelled = True

        def fire(self):
            self.function(*self.args)

    monkeypatch.setattr("agent_os.live_frames.threading.Timer", FakeTimer)
    broker = LiveRuntimeFrameBroker(ttl_seconds=30, max_frame_bytes=1024)
    frame = broker.publish_multimodal(
        task_id="task-ttl",
        session_id="session-ttl",
        action_id="action-ttl",
        raw=_multimodal(b"frame"),
        now=10,
    )

    assert frame is not None
    assert len(timers) == 1
    assert timers[0].daemon is True

    timers[0].fire()

    assert broker.latest("task-ttl", now=11) is None
