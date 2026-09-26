"""Ephemeral live-runtime frames for Agent OS Mission Control.

Frames are deliberately process-local and short lived. This module never writes
pixel data to disk, SQLite, events, logs, or Agent OS durable state.
"""

from __future__ import annotations

import base64
import binascii
import threading
import time
from dataclasses import dataclass
from typing import Any

_ALLOWED_MIME_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})
_DEFAULT_TTL_SECONDS = 8.0
_MAX_FRAME_BYTES = 6 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class LiveRuntimeFrame:
    task_id: str
    session_id: str
    action_id: str
    mime_type: str
    image_b64: str
    width: int | None
    height: int | None
    captured_at: float
    expires_at: float

    def payload(self) -> dict[str, Any]:
        """Return the websocket payload; callers must not persist it."""
        return {
            "type": "runtime.frame",
            "task_id": self.task_id,
            "session_id": self.session_id,
            "action_id": self.action_id,
            "mime_type": self.mime_type,
            "image_b64": self.image_b64,
            "width": self.width,
            "height": self.height,
        }


class LiveRuntimeFrameBroker:
    """Thread-safe, RAM-only latest-frame broker keyed by Agent OS task."""

    def __init__(
        self,
        *,
        ttl_seconds: float = _DEFAULT_TTL_SECONDS,
        max_frame_bytes: int = _MAX_FRAME_BYTES,
    ) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        if max_frame_bytes <= 0:
            raise ValueError("max_frame_bytes must be positive")
        self._ttl_seconds = float(ttl_seconds)
        self._max_frame_bytes = int(max_frame_bytes)
        self._frames: dict[str, LiveRuntimeFrame] = {}
        self._timers: dict[str, threading.Timer] = {}
        self._lock = threading.RLock()

    def publish_multimodal(
        self,
        *,
        task_id: str,
        session_id: str,
        action_id: str,
        raw: Any,
        now: float | None = None,
    ) -> LiveRuntimeFrame | None:
        """Extract and publish one validated image from a computer-use result."""
        identity = (str(task_id).strip(), str(session_id).strip(), str(action_id).strip())
        if not all(identity):
            return None

        image = _extract_data_image(raw)
        if image is None:
            return None
        mime_type, image_b64 = image
        meta = raw.get("meta") if isinstance(raw, dict) else None

        return self.publish_image(
            task_id=identity[0],
            session_id=identity[1],
            action_id=identity[2],
            mime_type=mime_type,
            image_b64=image_b64,
            width=meta.get("width") if isinstance(meta, dict) else None,
            height=meta.get("height") if isinstance(meta, dict) else None,
            now=now,
        )

    def publish_image(
        self,
        *,
        task_id: str,
        session_id: str,
        action_id: str,
        mime_type: str,
        image_b64: str,
        width: Any = None,
        height: Any = None,
        now: float | None = None,
    ) -> LiveRuntimeFrame | None:
        identity = (str(task_id).strip(), str(session_id).strip(), str(action_id).strip())
        mime = str(mime_type).strip().lower()
        if not all(identity) or mime not in _ALLOWED_MIME_TYPES:
            return None

        try:
            decoded = base64.b64decode(str(image_b64), validate=True)
        except (binascii.Error, ValueError):
            return None
        if not decoded or len(decoded) > self._max_frame_bytes:
            return None

        timestamp = time.monotonic() if now is None else float(now)
        frame = LiveRuntimeFrame(
            task_id=identity[0],
            session_id=identity[1],
            action_id=identity[2],
            mime_type=mime,
            image_b64=str(image_b64),
            width=_safe_dimension(width),
            height=_safe_dimension(height),
            captured_at=timestamp,
            expires_at=timestamp + self._ttl_seconds,
        )

        with self._lock:
            self._purge_locked(timestamp)
            previous = self._timers.pop(frame.task_id, None)
            if previous is not None:
                previous.cancel()
            self._frames[frame.task_id] = frame
            timer = threading.Timer(
                self._ttl_seconds,
                self._expire_frame,
                args=(frame.task_id, frame.captured_at),
            )
            timer.daemon = True
            self._timers[frame.task_id] = timer
            timer.start()
        return frame

    def latest(
        self,
        task_id: str,
        *,
        session_id: str | None = None,
        now: float | None = None,
    ) -> LiveRuntimeFrame | None:
        timestamp = time.monotonic() if now is None else float(now)
        key = str(task_id).strip()
        if not key:
            return None

        with self._lock:
            self._purge_locked(timestamp)
            frame = self._frames.get(key)
            if frame is None:
                return None
            if session_id is not None and frame.session_id != str(session_id).strip():
                return None
            return frame

    def clear_task(self, task_id: str) -> bool:
        key = str(task_id).strip()
        with self._lock:
            timer = self._timers.pop(key, None)
            if timer is not None:
                timer.cancel()
            return self._frames.pop(key, None) is not None

    def clear(self) -> None:
        with self._lock:
            for timer in self._timers.values():
                timer.cancel()
            self._timers.clear()
            self._frames.clear()

    def _expire_frame(self, task_id: str, captured_at: float) -> None:
        with self._lock:
            frame = self._frames.get(task_id)
            if frame is None or frame.captured_at != captured_at:
                return
            self._frames.pop(task_id, None)
            self._timers.pop(task_id, None)

    def _purge_locked(self, now: float) -> None:
        stale = [task_id for task_id, frame in self._frames.items() if frame.expires_at <= now]
        for task_id in stale:
            timer = self._timers.pop(task_id, None)
            if timer is not None:
                timer.cancel()
            self._frames.pop(task_id, None)


def _safe_dimension(value: Any) -> int | None:
    try:
        dimension = int(value)
    except (TypeError, ValueError):
        return None
    return dimension if 0 < dimension <= 100_000 else None


def _extract_data_image(raw: Any) -> tuple[str, str] | None:
    if not isinstance(raw, dict) or raw.get("_multimodal") is not True:
        return None
    content = raw.get("content")
    if not isinstance(content, list):
        return None

    for item in content:
        if not isinstance(item, dict) or item.get("type") != "image_url":
            continue
        image_url = item.get("image_url")
        url = image_url.get("url") if isinstance(image_url, dict) else None
        if not isinstance(url, str) or not url.startswith("data:"):
            continue
        header, separator, image_b64 = url.partition(",")
        if not separator or ";base64" not in header:
            continue
        mime_type = header[5:].split(";", 1)[0].strip().lower()
        if mime_type not in _ALLOWED_MIME_TYPES:
            continue
        if not image_b64:
            continue
        return mime_type, image_b64
    return None


live_runtime_frames = LiveRuntimeFrameBroker()
