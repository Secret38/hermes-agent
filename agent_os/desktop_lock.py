"""Reserve one user's desktop across profiles, threads and backend processes."""

from __future__ import annotations

import errno
import threading
from pathlib import Path

from hermes_platform.host.facts import os_family


class InteractiveDesktopLock:
    """OS-owned file locks expire on process loss, without replaying work.

    Keep the file in place: unlinking it would let another process lock a
    different inode. The home-level identity deliberately ignores HERMES_HOME
    so separate profiles cannot drive the same user's input simultaneously.
    File locks can be released by the worker thread that finishes the mission.
    """

    def __init__(self, path: Path | None = None):
        self.path = path
        self._guard = threading.Lock()
        self._handle = None

    def acquire(self, blocking: bool = False) -> bool:
        if blocking:
            raise ValueError("Desktop reservations must be non-blocking")
        if not self._guard.acquire(blocking=False):
            return False
        handle = None
        try:
            path = self.path or Path.home() / ".hermes-agent-os" / "interactive-desktop.lock"
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = path.open("a+b")
            if path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            try:
                if os_family() == "win32":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                if exc.errno in {errno.EACCES, errno.EAGAIN, errno.EDEADLK}:
                    handle.close()
                    self._guard.release()
                    return False
                raise
            self._handle = handle
            return True
        except Exception:
            if handle is not None:
                handle.close()
            self._guard.release()
            raise

    def release(self) -> None:
        handle = self._handle
        if handle is None:
            raise RuntimeError("Desktop reservation is not held")
        self._handle = None
        try:
            if os_family() == "win32":
                import msvcrt

                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        finally:
            handle.close()
            self._guard.release()
