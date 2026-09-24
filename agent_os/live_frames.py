"""Process-local ephemeral live frame broker for Agent OS computer use.

Raw desktop pixels live only in this broker and the connected renderer. The
broker never touches AgentOSStore, SQLite, the event ledger, or the filesystem.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable


_ALLOWED_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
_MAX_DATA_URL_CHARS = 8_000_000


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _dimension(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


@dataclass(frozen=True, slots=True)
class LiveFrame:
    sequence: int
    task_id: str
    action_id: str
    mime_type: str
    data_url: str
    width: int | None
    height: int | None
    captured_at: str
    expires_at: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "sequence": self.sequence,
            "task_id": self.task_id,
            "action_id": self.action_id,
            "mime_type": self.mime_type,
            "data_url": self.data_url,
            "width": self.width,
            "height": self.height,
            "captured_at": self.captured_at,
            "expires_at": self.expires_at,
        }


@dataclass(slots=True)
class _StoredFrame:
    frame: LiveFrame
    expires_monotonic: float


class LiveFrameBroker:
    """Bounded, task-scoped RAM store for the newest Agent OS CUA frame."""

    def __init__(
        self,
        *,
        ttl_seconds: float = 20.0,
        max_tasks: int = 8,
        clock: Callable[[], float] = time.monotonic,
        wall_clock: Callable[[], datetime] = _utc_now,
    ):
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be > 0")
        if max_tasks <= 0:
            raise ValueError("max_tasks must be > 0")
        self.ttl_seconds = float(ttl_seconds)
        self.max_tasks = int(max_tasks)
        self._clock = clock
        self._wall_clock = wall_clock
        self._lock = threading.RLock()
        self._sequence = 0
        self._frames: dict[str, _StoredFrame] = {}
        self._watchers: dict[str, int] = {}

    def publish(
        self,
        *,
        task_id: str,
        action_id: str,
        data_url: str,
        width: Any = None,
        height: Any = None,
    ) -> LiveFrame | None:
        task = str(task_id or "").strip()
        action = str(action_id or "").strip()
        if not task or not action or not isinstance(data_url, str):
            return None
        if not data_url or len(data_url) > _MAX_DATA_URL_CHARS:
            return None

        header, separator, payload = data_url.partition(",")
        if not separator or not payload or not header.endswith(";base64"):
            return None
        if not header.startswith("data:image/"):
            return None
        mime_type = header[5:-7].lower()
        if mime_type not in _ALLOWED_IMAGE_MIME_TYPES:
            return None

        now_mono = self._clock()
        now_wall = self._wall_clock()
        if now_wall.tzinfo is None:
            now_wall = now_wall.replace(tzinfo=timezone.utc)
        expires_wall = now_wall + timedelta(seconds=self.ttl_seconds)

        with self._lock:
            self._purge_locked(now_mono)
            if self._watchers.get(task, 0) <= 0:
                return None
            self._sequence += 1
            frame = LiveFrame(
                sequence=self._sequence,
                task_id=task,
                action_id=action,
                mime_type=mime_type,
                data_url=data_url,
                width=_dimension(width),
                height=_dimension(height),
                captured_at=now_wall.astimezone(timezone.utc).isoformat(),
                expires_at=expires_wall.astimezone(timezone.utc).isoformat(),
            )
            if task not in self._frames and len(self._frames) >= self.max_tasks:
                oldest = min(
                    self._frames,
                    key=lambda key: self._frames[key].frame.sequence,
                )
                self._frames.pop(oldest, None)
            self._frames[task] = _StoredFrame(
                frame=frame,
                expires_monotonic=now_mono + self.ttl_seconds,
            )
            return frame

    def begin_watch(self, task_id: str) -> bool:
        task = str(task_id or "").strip()
        if not task:
            return False
        with self._lock:
            self._watchers[task] = self._watchers.get(task, 0) + 1
        return True

    def end_watch(self, task_id: str) -> None:
        task = str(task_id or "").strip()
        if not task:
            return
        with self._lock:
            count = self._watchers.get(task, 0)
            if count <= 1:
                self._watchers.pop(task, None)
                self._frames.pop(task, None)
            else:
                self._watchers[task] = count - 1

    def latest(self, task_id: str) -> LiveFrame | None:
        task = str(task_id or "").strip()
        if not task:
            return None
        with self._lock:
            self._purge_locked(self._clock())
            stored = self._frames.get(task)
            return stored.frame if stored is not None else None

    def clear_task(self, task_id: str) -> None:
        with self._lock:
            self._frames.pop(str(task_id or "").strip(), None)

    def clear_all(self) -> None:
        with self._lock:
            self._frames.clear()
            self._watchers.clear()

    def _purge_locked(self, now: float) -> None:
        expired = [
            task_id
            for task_id, stored in self._frames.items()
            if stored.expires_monotonic <= now
        ]
        for task_id in expired:
            self._frames.pop(task_id, None)


_BROKER = LiveFrameBroker()


def live_frame_broker() -> LiveFrameBroker:
    return _BROKER
