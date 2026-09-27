"""Durable, metadata-only operator audit ledger for Hermes.

This is deliberately NOT a transcript, task database, or prompt store. It owns only
cross-cutting operator/security lifecycle facts that otherwise disappear with live
gateway state (for example a human gate being requested, answered, cancelled, or
timing out).

Security contract:
- never persist request/response payloads;
- never persist command text, secret values, clarification text, 2FA codes, URLs,
  headers, model prompts, or tool output;
- fixed scalar columns only;
- profile-scoped via the active Hermes home;
- append failures never break the primary Hermes operation.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from contextlib import closing
from pathlib import Path
from typing import Any

from hermes_constants import get_hermes_home

logger = logging.getLogger(__name__)

_DB_NAME = "operations-audit.db"
_MAX_ROWS = 50_000
_PRUNE_EVERY = 128
_write_lock = threading.Lock()
_write_count = 0


def _db_path(home: str | Path | None = None) -> Path:
    root = Path(home) if home is not None else get_hermes_home()
    return root / _DB_NAME


def _connect(home: str | Path | None = None) -> sqlite3.Connection:
    path = _db_path(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS audit_events (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event       TEXT NOT NULL,
            category    TEXT NOT NULL,
            session_id  TEXT,
            request_id  TEXT,
            subject     TEXT,
            outcome     TEXT,
            task_id     TEXT,
            run_id      INTEGER,
            project_id  TEXT,
            created_at  REAL NOT NULL
        )
        """
    )
    # Additive migration for homes created before task/run/project correlation existed.
    existing = {str(row["name"]) for row in conn.execute("PRAGMA table_info(audit_events)").fetchall()}
    for name, sql_type in (
        ("task_id", "TEXT"),
        ("run_id", "INTEGER"),
        ("project_id", "TEXT"),
    ):
        if name not in existing:
            conn.execute(f"ALTER TABLE audit_events ADD COLUMN {name} {sql_type}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_created ON audit_events(created_at DESC, id DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_session ON audit_events(session_id, id DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_task ON audit_events(task_id, id DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_run ON audit_events(run_id, id DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_events_project ON audit_events(project_id, id DESC)")
    return conn


def _safe_scalar(value: object, *, max_len: int = 160) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    # The caller passes only enumerated identifiers/outcomes. This final bound prevents
    # an accidental future giant value from turning the audit DB into a payload store.
    return text[:max_len]


def append_event(
    event: str,
    *,
    category: str,
    session_id: object = None,
    request_id: object = None,
    subject: object = None,
    outcome: object = None,
    task_id: object = None,
    run_id: object = None,
    project_id: object = None,
    created_at: float | None = None,
    home: str | Path | None = None,
) -> int | None:
    """Best-effort append of one metadata-only audit fact; returns the row id."""
    global _write_count
    row = (
        _safe_scalar(event, max_len=80),
        _safe_scalar(category, max_len=40),
        _safe_scalar(session_id),
        _safe_scalar(request_id),
        _safe_scalar(subject, max_len=80),
        _safe_scalar(outcome, max_len=80),
        _safe_scalar(task_id),
        int(run_id) if run_id is not None else None,
        _safe_scalar(project_id),
        float(created_at if created_at is not None else time.time()),
    )
    if not row[0] or not row[1]:
        return None
    try:
        with _write_lock, closing(_connect(home)) as conn:
            cursor = conn.execute(
                """
                INSERT INTO audit_events
                    (event, category, session_id, request_id, subject, outcome,
                     task_id, run_id, project_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )
            event_id = int(cursor.lastrowid)
            _write_count += 1
            if _write_count % _PRUNE_EVERY == 0:
                conn.execute(
                    """
                    DELETE FROM audit_events
                    WHERE id IN (
                        SELECT id FROM audit_events
                        ORDER BY id DESC
                        LIMIT -1 OFFSET ?
                    )
                    """,
                    (_MAX_ROWS,),
                )
            conn.commit()
            return event_id
    except Exception:
        logger.debug("operator audit append failed", exc_info=True)
        return None


def list_events(
    *,
    limit: int = 200,
    before_id: int | None = None,
    session_id: str | None = None,
    task_id: str | None = None,
    run_id: int | None = None,
    project_id: str | None = None,
    home: str | Path | None = None,
) -> list[dict[str, Any]]:
    """Newest-first metadata rows. No payload column exists to leak sensitive content."""
    bounded = max(1, min(int(limit or 200), 1000))
    clauses: list[str] = []
    args: list[Any] = []
    if before_id is not None:
        clauses.append("id < ?")
        args.append(int(before_id))
    if session_id:
        clauses.append("session_id = ?")
        args.append(str(session_id))
    if task_id:
        clauses.append("task_id = ?")
        args.append(str(task_id))
    if run_id is not None:
        clauses.append("run_id = ?")
        args.append(int(run_id))
    if project_id:
        clauses.append("project_id = ?")
        args.append(str(project_id))
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    args.append(bounded)
    try:
        with closing(_connect(home)) as conn:
            rows = conn.execute(
                f"""
                SELECT id, event, category, session_id, request_id, subject, outcome,
                       task_id, run_id, project_id, created_at
                FROM audit_events
                {where}
                ORDER BY id DESC
                LIMIT ?
                """,
                args,
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        logger.debug("operator audit read failed", exc_info=True)
        return []


def reset_for_tests(*, home: str | Path) -> None:
    path = _db_path(home)
    for suffix in ("", "-wal", "-shm"):
        try:
            Path(str(path) + suffix).unlink()
        except FileNotFoundError:
            pass
