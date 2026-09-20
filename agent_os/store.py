"""SQLite-backed durable Agent OS execution ledger."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import replace
from pathlib import Path
from typing import Any

from hermes_cli.sqlite_util import open_db
from hermes_constants import get_hermes_home

from .agents.records import (
    AgentInstanceRecord,
    AgentInstanceState,
    agent_is_terminal,
    validate_agent_transition,
)
from .contracts import ActionRecord, TaskRecord, utc_now_iso
from .events import EventRecord, EventType
from .states import ActionState, TaskState, validate_action_transition, validate_task_transition

SCHEMA_VERSION = 2


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
        CREATE TABLE IF NOT EXISTS agent_instances (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            runtime TEXT NOT NULL,
            goal TEXT NOT NULL,
            state TEXT NOT NULL,
            parent_agent_id TEXT,
            role TEXT NOT NULL,
            launch_spec_json TEXT NOT NULL DEFAULT '{}',
            runtime_handle_json TEXT NOT NULL DEFAULT '{}',
            restart_count INTEGER NOT NULL DEFAULT 0,
            max_restarts INTEGER NOT NULL DEFAULT 1,
            result_json TEXT NOT NULL DEFAULT '{}',
            error TEXT,
            diagnostic TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT,
            FOREIGN KEY(task_id) REFERENCES tasks(id),
            FOREIGN KEY(parent_agent_id) REFERENCES agent_instances(id)
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
        CREATE INDEX IF NOT EXISTS idx_agents_task ON agent_instances(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_agents_state ON agent_instances(state, updated_at);
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
    """Canonical durable task/action/agent/event ledger."""

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
                """INSERT INTO tasks(
                    id, goal, state, parent_task_id, session_id, kanban_task_id,
                    workspace_id, metadata_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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

    def transition_task(self, task_id: str, target: TaskState, *, payload: dict[str, Any] | None = None) -> TaskRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown task: {task_id}")
            current = TaskState(row["state"])
            validate_task_transition(current, target)
            now = utc_now_iso()
            conn.execute("UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?", (target.value, now, task_id))
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=task_id,
                    type=EventType.TASK_STATE_CHANGED,
                    payload={"from": current.value, "to": target.value, **dict(payload or {})},
                ),
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
                """INSERT INTO actions(
                    id, task_id, parent_action_id, agent_id, tool, operation, state,
                    input_json, expected_state_json, risk_level, permission_policy,
                    workspace_id, checkpoint_id, timeout_seconds, retry_budget,
                    verification_required, verification_method, actual_state_json,
                    verification_result_json, recovery_attempts, error, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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

    def set_action_controls(
        self,
        action_id: str,
        *,
        risk_level: str,
        permission_policy: str,
        event_payload: dict[str, Any] | None = None,
    ) -> ActionRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown action: {action_id}")
            now = utc_now_iso()
            conn.execute(
                "UPDATE actions SET risk_level = ?, permission_policy = ?, updated_at = ? WHERE id = ?",
                (risk_level, permission_policy, now, action_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.RISK_CLASSIFIED,
                    payload={"risk_level": risk_level, "permission_policy": permission_policy, **dict(event_payload or {})},
                ),
            )
            conn.commit()
            return replace(
                self._action_from_row(row),
                risk_level=risk_level,
                permission_policy=permission_policy,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def bind_checkpoint(self, action_id: str, checkpoint_id: str) -> ActionRecord:
        if not checkpoint_id.strip():
            raise ValueError("checkpoint_id must not be empty")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown action: {action_id}")
            now = utc_now_iso()
            conn.execute(
                "UPDATE actions SET checkpoint_id = ?, updated_at = ? WHERE id = ?",
                (checkpoint_id, now, action_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.CHECKPOINT_BOUND,
                    payload={"checkpoint_id": checkpoint_id},
                ),
            )
            conn.commit()
            return replace(self._action_from_row(row), checkpoint_id=checkpoint_id, updated_at=now)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def record_recovery_attempt(
        self,
        action_id: str,
        *,
        decision: str,
        reason: str,
        error: str | None = None,
    ) -> ActionRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown action: {action_id}")
            attempts = int(row["recovery_attempts"]) + 1
            now = utc_now_iso()
            conn.execute(
                "UPDATE actions SET recovery_attempts = ?, updated_at = ? WHERE id = ?",
                (attempts, now, action_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.RECOVERY_ATTEMPTED,
                    payload={"attempt": attempts, "decision": decision, "reason": reason, "error": error},
                ),
            )
            conn.commit()
            return replace(self._action_from_row(row), recovery_attempts=attempts, updated_at=now)
        except Exception:
            conn.rollback()
            raise
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
            next_verification = _loads(row["verification_result_json"]) if verification_result is None else dict(verification_result)
            conn.execute(
                """UPDATE actions
                   SET state = ?, actual_state_json = ?, verification_result_json = ?,
                       error = ?, updated_at = ?
                 WHERE id = ?""",
                (target.value, _json(next_actual), _json(next_verification), error, now, action_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.ACTION_STATE_CHANGED,
                    payload={"from": current.value, "to": target.value, **dict(payload or {})},
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

    def create_agent(self, agent: AgentInstanceRecord) -> AgentInstanceRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (agent.task_id,)).fetchone() is None:
                raise KeyError(f"unknown task: {agent.task_id}")
            conn.execute(
                """INSERT INTO agent_instances(
                    id, task_id, runtime, goal, state, parent_agent_id, role,
                    launch_spec_json, runtime_handle_json, restart_count, max_restarts,
                    result_json, error, diagnostic, created_at, updated_at,
                    started_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    agent.id, agent.task_id, agent.runtime, agent.goal, agent.state.value,
                    agent.parent_agent_id, agent.role, _json(agent.launch_spec),
                    _json(agent.runtime_handle), agent.restart_count, agent.max_restarts,
                    _json(agent.result), agent.error, agent.diagnostic, agent.created_at,
                    agent.updated_at, agent.started_at, agent.completed_at,
                ),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=agent.task_id,
                    type=EventType.AGENT_CREATED,
                    payload={
                        "agent_id": agent.id,
                        "runtime": agent.runtime,
                        "state": agent.state.value,
                        "parent_agent_id": agent.parent_agent_id,
                    },
                ),
            )
            conn.commit()
            return agent
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_agent(self, agent_id: str) -> AgentInstanceRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM agent_instances WHERE id = ?", (agent_id,)).fetchone()
            return None if row is None else self._agent_from_row(row)
        finally:
            conn.close()

    def list_agents(self, *, active_only: bool = False) -> list[AgentInstanceRecord]:
        conn = self._connect()
        try:
            rows = conn.execute("SELECT * FROM agent_instances ORDER BY created_at").fetchall()
            agents = [self._agent_from_row(row) for row in rows]
            return [agent for agent in agents if not agent_is_terminal(agent.state)] if active_only else agents
        finally:
            conn.close()

    def bind_agent_handle(
        self,
        agent_id: str,
        runtime_handle: dict[str, Any],
        *,
        restarted: bool = False,
        diagnostic: str | None = None,
    ) -> AgentInstanceRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM agent_instances WHERE id = ?", (agent_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown agent: {agent_id}")
            restart_count = int(row["restart_count"]) + (1 if restarted else 0)
            now = utc_now_iso()
            started_at = row["started_at"] or now
            conn.execute(
                """UPDATE agent_instances
                   SET runtime_handle_json = ?, restart_count = ?, diagnostic = ?,
                       started_at = ?, updated_at = ?
                 WHERE id = ?""",
                (_json(runtime_handle), restart_count, diagnostic, started_at, now, agent_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.AGENT_RESTARTED if restarted else EventType.AGENT_HANDLE_BOUND,
                    payload={
                        "agent_id": agent_id,
                        "runtime": row["runtime"],
                        "restart_count": restart_count,
                    },
                ),
            )
            conn.commit()
            return replace(
                self._agent_from_row(row),
                runtime_handle=dict(runtime_handle),
                restart_count=restart_count,
                diagnostic=diagnostic,
                started_at=started_at,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def transition_agent(
        self,
        agent_id: str,
        target: AgentInstanceState,
        *,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        diagnostic: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> AgentInstanceRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM agent_instances WHERE id = ?", (agent_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown agent: {agent_id}")
            current = AgentInstanceState(row["state"])
            validate_agent_transition(current, target)
            now = utc_now_iso()
            next_result = _loads(row["result_json"]) if result is None else dict(result)
            started_at = row["started_at"] or (now if target in {AgentInstanceState.STARTING, AgentInstanceState.RUNNING} else None)
            completed_at = now if agent_is_terminal(target) else row["completed_at"]
            conn.execute(
                """UPDATE agent_instances
                   SET state = ?, result_json = ?, error = ?, diagnostic = ?,
                       started_at = ?, completed_at = ?, updated_at = ?
                 WHERE id = ?""",
                (
                    target.value, _json(next_result), error, diagnostic, started_at,
                    completed_at, now, agent_id,
                ),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.AGENT_STATE_CHANGED,
                    payload={
                        "agent_id": agent_id,
                        "from": current.value,
                        "to": target.value,
                        **dict(payload or {}),
                    },
                ),
            )
            conn.commit()
            return replace(
                self._agent_from_row(row),
                state=target,
                result=next_result,
                error=error,
                diagnostic=diagnostic,
                started_at=started_at,
                completed_at=completed_at,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def record_agent_reconcile(
        self,
        agent_id: str,
        *,
        connected: bool,
        runtime_state: str,
        diagnostic: str | None,
        safe_to_restart: bool,
    ) -> AgentInstanceRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM agent_instances WHERE id = ?", (agent_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown agent: {agent_id}")
            now = utc_now_iso()
            conn.execute(
                "UPDATE agent_instances SET diagnostic = ?, updated_at = ? WHERE id = ?",
                (diagnostic, now, agent_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.AGENT_RECONCILED,
                    payload={
                        "agent_id": agent_id,
                        "connected": connected,
                        "runtime_state": runtime_state,
                        "diagnostic": diagnostic,
                        "safe_to_restart": safe_to_restart,
                    },
                ),
            )
            conn.commit()
            return replace(self._agent_from_row(row), diagnostic=diagnostic, updated_at=now)
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
            rows = conn.execute("SELECT * FROM events WHERE task_id = ? ORDER BY sequence", (task_id,)).fetchall()
            return [self._event_from_row(row) for row in rows]
        finally:
            conn.close()

    @staticmethod
    def _insert_event(conn: sqlite3.Connection, event: EventRecord) -> None:
        conn.execute(
            "INSERT INTO events(id, task_id, action_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (event.id, event.task_id, event.action_id, event.type.value, _json(event.payload), event.created_at),
        )

    @staticmethod
    def _task_from_row(row: sqlite3.Row) -> TaskRecord:
        return TaskRecord(
            id=row["id"], goal=row["goal"], state=TaskState(row["state"]),
            parent_task_id=row["parent_task_id"], session_id=row["session_id"],
            kanban_task_id=row["kanban_task_id"], workspace_id=row["workspace_id"],
            metadata=_loads(row["metadata_json"]), created_at=row["created_at"], updated_at=row["updated_at"],
        )

    @staticmethod
    def _action_from_row(row: sqlite3.Row) -> ActionRecord:
        return ActionRecord(
            id=row["id"], task_id=row["task_id"], parent_action_id=row["parent_action_id"],
            agent_id=row["agent_id"], tool=row["tool"], operation=row["operation"],
            state=ActionState(row["state"]), input=_loads(row["input_json"]),
            expected_state=_loads(row["expected_state_json"]), risk_level=row["risk_level"],
            permission_policy=row["permission_policy"], workspace_id=row["workspace_id"],
            checkpoint_id=row["checkpoint_id"], timeout_seconds=row["timeout_seconds"],
            retry_budget=int(row["retry_budget"]), verification_required=bool(row["verification_required"]),
            verification_method=row["verification_method"], actual_state=_loads(row["actual_state_json"]),
            verification_result=_loads(row["verification_result_json"]),
            recovery_attempts=int(row["recovery_attempts"]), error=row["error"],
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    @staticmethod
    def _agent_from_row(row: sqlite3.Row) -> AgentInstanceRecord:
        return AgentInstanceRecord(
            id=row["id"], task_id=row["task_id"], runtime=row["runtime"],
            goal=row["goal"], state=AgentInstanceState(row["state"]),
            parent_agent_id=row["parent_agent_id"], role=row["role"],
            launch_spec=_loads(row["launch_spec_json"]),
            runtime_handle=_loads(row["runtime_handle_json"]),
            restart_count=int(row["restart_count"]), max_restarts=int(row["max_restarts"]),
            result=_loads(row["result_json"]), error=row["error"],
            diagnostic=row["diagnostic"], created_at=row["created_at"],
            updated_at=row["updated_at"], started_at=row["started_at"],
            completed_at=row["completed_at"],
        )

    @staticmethod
    def _event_from_row(row: sqlite3.Row) -> EventRecord:
        return EventRecord(
            id=row["id"], task_id=row["task_id"], action_id=row["action_id"],
            type=EventType(row["type"]), payload=_loads(row["payload_json"]), created_at=row["created_at"],
        )
