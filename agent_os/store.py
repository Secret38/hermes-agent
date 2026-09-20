"""SQLite-backed durable Agent OS execution ledger."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any, Iterable

from hermes_cli.sqlite_util import open_db
from hermes_constants import get_hermes_home

from .contracts import ActionRecord, TaskRecord, utc_now_iso
from .events import EventRecord, EventType
from .states import (
    ActionState,
    TaskState,
    validate_action_transition,
    validate_task_transition,
)

SCHEMA_VERSION = 1


def default_db_path() -> Path:
    return get_hermes_home() / "agent-os" / "agent_os.db"


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            goal TEXT NOT NULL,
            state TEXT NOT NULL,
            parent_task_id TEXT,
            session_id TEXT,
            kanban_task_id TEXT,
            workspace_id TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(parent_task_id) REFERENCES tasks(id)
        );

        CREATE TABLE IF NOT EXISTS actions (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            parent_action_id TEXT,
            agent_id TEXT,
            tool TEXT NOT NULL,
            operation TEXT NOT NULL,
            state TEXT NOT NULL,
            input_json TEXT NOT NULL DEFAULT '{}',
            expected_state_json TEXT NOT NULL DEFAULT '{}',
            risk_level TEXT,
            permission_policy TEXT,
            workspace_id TEXT,
            checkpoint_id TEXT,
            timeout_seconds REAL,
            retry_budget INTEGER NOT NULL DEFAULT 0,
            verification_required INTEGER NOT NULL DEFAULT 1,
            verification_method TEXT,
            actual_state_json TEXT NOT NULL DEFAULT '{}',
            verification_result_json TEXT NOT NULL DEFAULT '{}',
            recovery_attempts INTEGER NOT NULL DEFAULT 0,
            error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id),
            FOREIGN KEY(parent_action_id) REFERENCES actions(id)
        );

        CREATE TABLE IF NOT EXISTS events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL UNIQUE,
            task_id TEXT NOT NULL,
            action_id TEXT,
            type TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id),
            FOREIGN KEY(action_id) REFERENCES actions(id)
        );

        CREATE INDEX IF NOT EXISTS idx_actions_task ON actions(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_events_task_seq ON events(task_id, sequence);
        CREATE INDEX IF NOT EXISTS idx_events_action_seq ON events(action_id, sequence);
        """
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
        (str(SCHEMA_VERSION),),
    )
    conn.commit()


class AgentOSStore:
    """Canonical durable task/action/event ledger.

    Each mutating operation uses BEGIN IMMEDIATE and commits its state change
    together with the corresponding event. This makes replay/recovery observe
    either both records or neither record after a crash.
    """

    def __init__(self, path: Path | str | None = None):
        self.path = Path(path) if path is not None else default_db_path()

    def _connect(self) -> sqlite3.Connection:
        return open_db(
            self.path,
            db_label="agent_os.db",
            foreign_keys=True,
            synchronous_full=True,
            wal_lock_retries=3,
            initialize=_ensure_schema,
        )

    def create_task(self, task: TaskRecord) -> TaskRecord:
        event = EventRecord.create(task_id=task.id, type=EventType.TASK_CREATED, payload={"state": task.state.value})
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            conn.execute(
                """
                INSERT INTO tasks(
                    id, goal, state, parent_task_id, session_id, kanban_task_id,
                    workspace_id, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task.id, task.goal, task.state.value, task.parent_task_id,
                    task.session_id, task.kanban_task_id, task.workspace_id,
                    _json(task.metadata), task.created_at, task.updated_at,
                ),
            )
            self._insert_event(conn, event)
            conn.commit()
            return task
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_task(self, task_id: str) -> TaskRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return None if row is None else self._task_from_row(row)
        finally:
            conn.close()

    def transition_task(
        self,
        task_id: str,
        target: TaskState,
        *,
        payload: dict[str, Any] | None = None,
    ) -> TaskRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown task: {task_id}")
            current = TaskState(row["state"])
            validate_task_transition(current, target)
            now = utc_now_iso()
            conn.execute(
                "UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?",
                (target.value, now, task_id),
            )
            event_payload = {"from": current.value, "to": target.value, **dict(payload or {})}
            self._insert_event(
                conn,
                EventRecord.create(task_id=task_id, type=EventType.TASK_STATE_CHANGED, payload=event_payload),
            )
            conn.commit()
            return replace(self._task_from_row(row), state=target, updated_at=now)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def create_action(self, action: ActionRecord) -> ActionRecord:
        event = EventRecord.create(
            task_id=action.task_id,
            action_id=action.id,
            type=EventType.ACTION_CREATED,
            payload={"state": action.state.value, "tool": action.tool, "operation": action.operation},
        )
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (action.task_id,)).fetchone() is None:
                raise KeyError(f"unknown task: {action.task_id}")
            conn.execute(
                """
                INSERT INTO actions(
                    id, task_id, parent_action_id, agent_id, tool, operation, state,
                    input_json, expected_state_json, risk_level, permission_policy,
                    workspace_id, checkpoint_id, timeout_seconds, retry_budget,
                    verification_required, verification_method, actual_state_json,
                    verification_result_json, recovery_attempts, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    action.id, action.task_id, action.parent_action_id, action.agent_id,
                    action.tool, action.operation, action.state.value, _json(action.input),
                    _json(action.expected_state), action.risk_level, action.permission_policy,
                    action.workspace_id, action.checkpoint_id, action.timeout_seconds,
                    action.retry_budget, int(action.verification_required),
                    action.verification_method, _json(action.actual_state),
                    _json(action.verification_result), action.recovery_attempts, action.error,
                    action.created_at, action.updated_at,
                ),
            )
            self._insert_event(conn, event)
            conn.commit()
            return action
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_action(self, action_id: str) -> ActionRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            return None if row is None else self._action_from_row(row)
        finally:
            conn.close()

    def transition_action(
        self,
        action_id: str,
        target: ActionState,
        *,
        actual_state: dict[str, Any] | None = None,
        verification_result: dict[str, Any] | None = None,
        error: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> ActionRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown action: {action_id}")
            current = ActionState(row["state"])
            validate_action_transition(current, target)
            now = utc_now_iso()
            next_actual = _loads(row["actual_state_json"]) if actual_state is None else dict(actual_state)
            next_verification = (
                _loads(row["verification_result_json"])
                if verification_result is None
                else dict(verification_result)
            )
            conn.execute(
                """
                UPDATE actions
                   SET state = ?, actual_state_json = ?, verification_result_json = ?,
                       error = ?, updated_at = ?
                 WHERE id = ?
                """,
                (
                    target.value, _json(next_actual), _json(next_verification),
                    error, now, action_id,
                ),
            )
            event_payload = {"from": current.value, "to": target.value, **dict(payload or {})}
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.ACTION_STATE_CHANGED,
                    payload=event_payload,
                ),
            )
            conn.commit()
            return replace(
                self._action_from_row(row),
                state=target,
                actual_state=next_actual,
                verification_result=next_verification,
                error=error,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def append_event(self, event: EventRecord) -> EventRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            self._insert_event(conn, event)
            conn.commit()
            return event
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def list_events(self, task_id: str) -> list[EventRecord]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM events WHERE task_id = ? ORDER BY sequence",
                (task_id,),
            ).fetchall()
            return [self._event_from_row(row) for row in rows]
        finally:
            conn.close()

    @staticmethod
    def _insert_event(conn: sqlite3.Connection, event: EventRecord) -> None:
        conn.execute(
            """
            INSERT INTO events(id, task_id, action_id, type, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                event.id, event.task_id, event.action_id, event.type.value,
                _json(event.payload), event.created_at,
            ),
        )

    @staticmethod
    def _task_from_row(row: sqlite3.Row) -> TaskRecord:
        return TaskRecord(
            id=row["id"],
            goal=row["goal"],
            state=TaskState(row["state"]),
            parent_task_id=row["parent_task_id"],
            session_id=row["session_id"],
            kanban_task_id=row["kanban_task_id"],
            workspace_id=row["workspace_id"],
            metadata=_loads(row["metadata_json"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _action_from_row(row: sqlite3.Row) -> ActionRecord:
        return ActionRecord(
            id=row["id"],
            task_id=row["task_id"],
            parent_action_id=row["parent_action_id"],
            agent_id=row["agent_id"],
            tool=row["tool"],
            operation=row["operation"],
            state=ActionState(row["state"]),
            input=_loads(row["input_json"]),
            expected_state=_loads(row["expected_state_json"]),
            risk_level=row["risk_level"],
            permission_policy=row["permission_policy"],
            workspace_id=row["workspace_id"],
            checkpoint_id=row["checkpoint_id"],
            timeout_seconds=row["timeout_seconds"],
            retry_budget=int(row["retry_budget"]),
            verification_required=bool(row["verification_required"]),
            verification_method=row["verification_method"],
            actual_state=_loads(row["actual_state_json"]),
            verification_result=_loads(row["verification_result_json"]),
            recovery_attempts=int(row["recovery_attempts"]),
            error=row["error"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> EventRecord:
        return EventRecord(
            id=row["id"],
            task_id=row["task_id"],
            action_id=row["action_id"],
            type=EventType(row["type"]),
            payload=_loads(row["payload_json"]),
            created_at=row["created_at"],
        )
