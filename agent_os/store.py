"""SQLite-backed durable Agent OS execution ledger."""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import replace

import psutil
from pathlib import Path
from typing import Any

from hermes_cli.sqlite_util import add_column_if_missing, open_db
from hermes_constants import get_hermes_home

from .agents.records import (
    AgentInstanceRecord,
    AgentInstanceState,
    agent_is_terminal,
    validate_agent_transition,
)
from .contracts import ActionRecord, TaskRecord, new_id, utc_now_iso
from .events import EventRecord, EventType
from .orchestration.plan import (
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    PlanStepState,
    validate_plan_graph,
    validate_plan_transition,
    validate_step_transition,
)
from .states import ActionState, TaskState, validate_action_transition, validate_task_transition

SCHEMA_VERSION = 6


def default_db_path() -> Path:
    return get_hermes_home() / "agent-os" / "agent_os.db"


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _loads(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    parsed = json.loads(value)
    return parsed if isinstance(parsed, dict) else {}


def _schema_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
    if row is None:
        return 0
    try:
        return int(row["value"] if isinstance(row, sqlite3.Row) else row[0])
    except (TypeError, ValueError):
        raise RuntimeError("agent_os.db has an invalid schema_version")


def _execute_ddl(conn: sqlite3.Connection, script: str) -> None:
    """Execute DDL statement-by-statement without sqlite3.executescript auto-commits."""

    for statement in script.split(";"):
        statement = statement.strip()
        if statement:
            conn.execute(statement)


def _migration_1(conn: sqlite3.Connection) -> None:
    _execute_ddl(conn, 
        """
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


def _migration_2(conn: sqlite3.Connection) -> None:
    _execute_ddl(conn, 
        """
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
        CREATE INDEX IF NOT EXISTS idx_agents_task ON agent_instances(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_agents_state ON agent_instances(state, updated_at);
        """
    )


def _migration_3(conn: sqlite3.Connection) -> None:
    _execute_ddl(conn, 
        """
        CREATE TABLE IF NOT EXISTS plans (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL,
            objective TEXT NOT NULL,
            revision INTEGER NOT NULL,
            state TEXT NOT NULL,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        CREATE TABLE IF NOT EXISTS plan_steps (
            id TEXT PRIMARY KEY,
            plan_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            title TEXT NOT NULL,
            kind TEXT NOT NULL,
            state TEXT NOT NULL,
            spec_json TEXT NOT NULL DEFAULT '{}',
            priority INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE,
            FOREIGN KEY(task_id) REFERENCES tasks(id)
        );
        CREATE TABLE IF NOT EXISTS plan_step_dependencies (
            step_id TEXT NOT NULL,
            dependency_step_id TEXT NOT NULL,
            PRIMARY KEY(step_id, dependency_step_id),
            FOREIGN KEY(step_id) REFERENCES plan_steps(id) ON DELETE CASCADE,
            FOREIGN KEY(dependency_step_id) REFERENCES plan_steps(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_plans_task ON plans(task_id, revision);
        CREATE INDEX IF NOT EXISTS idx_plan_steps_plan_state
            ON plan_steps(plan_id, state, priority, created_at);
        CREATE INDEX IF NOT EXISTS idx_plan_deps_step ON plan_step_dependencies(step_id);
        """
    )


def _migration_4(conn: sqlite3.Connection) -> None:
    add_column_if_missing(
        conn,
        "plan_steps",
        "execution_id",
        "execution_id TEXT",
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_steps_execution ON plan_steps(execution_id)"
    )


def _migration_5(conn: sqlite3.Connection) -> None:
    add_column_if_missing(conn, "plan_steps", "claim_token", "claim_token TEXT")
    add_column_if_missing(conn, "plan_steps", "claim_owner", "claim_owner TEXT")
    add_column_if_missing(
        conn,
        "plan_steps",
        "claim_expires_at",
        "claim_expires_at REAL",
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_steps_claim "
        "ON plan_steps(plan_id, state, claim_expires_at)"
    )


def _migration_6(conn: sqlite3.Connection) -> None:
    add_column_if_missing(
        conn,
        "actions",
        "execution_owner_pid",
        "execution_owner_pid INTEGER",
    )
    add_column_if_missing(
        conn,
        "actions",
        "execution_owner_create_time",
        "execution_owner_create_time REAL",
    )
    add_column_if_missing(
        conn,
        "actions",
        "execution_attempts",
        "execution_attempts INTEGER NOT NULL DEFAULT 0",
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_actions_execution_owner "
        "ON actions(state, execution_owner_pid, execution_owner_create_time)"
    )


_MIGRATIONS = {
    1: _migration_1,
    2: _migration_2,
    3: _migration_3,
    4: _migration_4,
    5: _migration_5,
    6: _migration_6,
}


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Upgrade agent_os.db transactionally to the current schema version."""

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.commit()

    conn.execute("BEGIN IMMEDIATE")
    try:
        version = _schema_version(conn)
        if version > SCHEMA_VERSION:
            raise RuntimeError(
                f"agent_os.db schema {version} is newer than supported {SCHEMA_VERSION}"
            )

        while version < SCHEMA_VERSION:
            target = version + 1
            migration = _MIGRATIONS.get(target)
            if migration is None:
                raise RuntimeError(f"missing Agent OS schema migration {target}")
            migration(conn)
            conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)",
                (str(target),),
            )
            version = target
        conn.commit()
    except Exception:
        conn.rollback()
        raise


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

    def initialize(self) -> dict[str, Any]:
        """Create/migrate the durable store and verify its SQLite integrity."""

        conn = self._connect()
        try:
            row = conn.execute("PRAGMA quick_check").fetchone()
            integrity = str(row[0] if row else "")
            return {
                "path": str(self.path),
                "schema_version": _schema_version(conn),
                "integrity": integrity,
            }
        finally:
            conn.close()

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

    def list_tasks(self) -> list[TaskRecord]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM tasks ORDER BY created_at, id"
            ).fetchall()
            return [self._task_from_row(row) for row in rows]
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

    def list_actions(
        self,
        *,
        states: set[ActionState] | None = None,
    ) -> list[ActionRecord]:
        conn = self._connect()
        try:
            if states:
                values = sorted(state.value for state in states)
                marks = ",".join("?" for _ in values)
                rows = conn.execute(
                    f"SELECT * FROM actions WHERE state IN ({marks}) ORDER BY created_at, id",
                    values,
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM actions ORDER BY created_at, id"
                ).fetchall()
            return [self._action_from_row(row) for row in rows]
        finally:
            conn.close()

    def start_action_execution(self, action_id: str) -> ActionRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM actions WHERE id = ?", (action_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown action: {action_id}")
            current = ActionState(row["state"])
            validate_action_transition(current, ActionState.EXECUTING)

            pid = os.getpid()
            try:
                create_time = float(psutil.Process(pid).create_time())
            except (psutil.Error, OSError) as exc:
                raise RuntimeError("cannot fingerprint action execution owner") from exc

            attempts = int(row["execution_attempts"] or 0) + 1
            now = utc_now_iso()
            conn.execute(
                """UPDATE actions
                      SET state = ?, execution_owner_pid = ?,
                          execution_owner_create_time = ?, execution_attempts = ?,
                          updated_at = ?
                    WHERE id = ?""",
                (
                    ActionState.EXECUTING.value,
                    pid,
                    create_time,
                    attempts,
                    now,
                    action_id,
                ),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    action_id=action_id,
                    type=EventType.ACTION_STATE_CHANGED,
                    payload={
                        "from": current.value,
                        "to": ActionState.EXECUTING.value,
                        "execution_owner_pid": pid,
                        "execution_owner_create_time": create_time,
                        "execution_attempt": attempts,
                    },
                ),
            )
            conn.commit()
            return replace(
                self._action_from_row(row),
                state=ActionState.EXECUTING,
                execution_owner_pid=pid,
                execution_owner_create_time=create_time,
                execution_attempts=attempts,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
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

    def create_plan(
        self,
        plan: PlanRecord,
        steps: list[PlanStepRecord],
        dependencies: dict[str, list[str]] | None = None,
    ) -> PlanRecord:
        dependencies = dependencies or {}
        validate_plan_graph(steps, dependencies)
        if any(step.plan_id != plan.id or step.task_id != plan.task_id for step in steps):
            raise ValueError("all plan steps must belong to the supplied plan/task")

        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            if conn.execute("SELECT 1 FROM tasks WHERE id = ?", (plan.task_id,)).fetchone() is None:
                raise KeyError(f"unknown task: {plan.task_id}")
            conn.execute(
                """INSERT INTO plans(id, task_id, objective, revision, state, metadata_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    plan.id, plan.task_id, plan.objective, plan.revision, plan.state.value,
                    _json(plan.metadata), plan.created_at, plan.updated_at,
                ),
            )
            for step in steps:
                conn.execute(
                    """INSERT INTO plan_steps(
                        id, plan_id, task_id, title, kind, state, spec_json,
                        execution_id, priority, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        step.id, step.plan_id, step.task_id, step.title, step.kind.value,
                        step.state.value, _json(step.spec), step.execution_id,
                        step.priority, step.created_at, step.updated_at,
                    ),
                )
                self._insert_event(
                    conn,
                    EventRecord.create(
                        task_id=plan.task_id,
                        type=EventType.PLAN_STEP_CREATED,
                        payload={
                            "plan_id": plan.id,
                            "step_id": step.id,
                            "kind": step.kind.value,
                            "state": step.state.value,
                        },
                    ),
                )
            for step_id, dependency_ids in dependencies.items():
                for dependency_id in set(dependency_ids):
                    conn.execute(
                        "INSERT INTO plan_step_dependencies(step_id, dependency_step_id) VALUES (?, ?)",
                        (step_id, dependency_id),
                    )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=plan.task_id,
                    type=EventType.PLAN_CREATED,
                    payload={"plan_id": plan.id, "revision": plan.revision, "step_count": len(steps)},
                ),
            )
            conn.commit()
            return plan
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_plan(self, plan_id: str) -> PlanRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
            return None if row is None else self._plan_from_row(row)
        finally:
            conn.close()

    def latest_plan_for_task(self, task_id: str) -> PlanRecord | None:
        conn = self._connect()
        try:
            row = conn.execute(
                """SELECT * FROM plans
                    WHERE task_id = ?
                    ORDER BY revision DESC, created_at DESC, id DESC
                    LIMIT 1""",
                (task_id,),
            ).fetchone()
            return None if row is None else self._plan_from_row(row)
        finally:
            conn.close()

    def get_plan_step(self, step_id: str) -> PlanStepRecord | None:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
            return None if row is None else self._plan_step_from_row(row)
        finally:
            conn.close()

    def list_plan_steps(self, plan_id: str) -> list[PlanStepRecord]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY priority DESC, created_at, id",
                (plan_id,),
            ).fetchall()
            return [self._plan_step_from_row(row) for row in rows]
        finally:
            conn.close()

    def transition_plan(self, plan_id: str, target: PlanState) -> PlanRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown plan: {plan_id}")
            current = PlanState(row["state"])
            validate_plan_transition(current, target)
            now = utc_now_iso()
            conn.execute("UPDATE plans SET state = ?, updated_at = ? WHERE id = ?", (target.value, now, plan_id))
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.PLAN_STATE_CHANGED,
                    payload={"plan_id": plan_id, "from": current.value, "to": target.value},
                ),
            )
            conn.commit()
            return replace(self._plan_from_row(row), state=target, updated_at=now)
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def bind_plan_step_execution(self, step_id: str, execution_id: str) -> PlanStepRecord:
        if not execution_id.strip():
            raise ValueError("execution_id must not be empty")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown plan step: {step_id}")
            if PlanStepState(row["state"]) is not PlanStepState.RUNNING:
                raise RuntimeError("plan step must be RUNNING before execution can be bound")

            kind = PlanStepKind(row["kind"])
            if kind in {PlanStepKind.ACTION, PlanStepKind.VERIFICATION}:
                target = conn.execute(
                    "SELECT task_id FROM actions WHERE id = ?",
                    (execution_id,),
                ).fetchone()
            elif kind is PlanStepKind.AGENT:
                target = conn.execute(
                    "SELECT task_id FROM agent_instances WHERE id = ?",
                    (execution_id,),
                ).fetchone()
            else:
                raise RuntimeError("manual plan steps cannot bind an automatic execution")

            if target is None:
                raise KeyError(f"unknown execution target: {execution_id}")
            if target["task_id"] != row["task_id"]:
                raise ValueError("execution target belongs to a different task")

            now = utc_now_iso()
            conn.execute(
                """UPDATE plan_steps
                      SET execution_id = ?, claim_token = NULL, claim_owner = NULL,
                          claim_expires_at = NULL, updated_at = ?
                    WHERE id = ?""",
                (execution_id, now, step_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.PLAN_STEP_BOUND,
                    payload={
                        "plan_id": row["plan_id"],
                        "step_id": step_id,
                        "kind": kind.value,
                        "execution_id": execution_id,
                    },
                ),
            )
            conn.commit()
            return replace(
                self._plan_step_from_row(row),
                execution_id=execution_id,
                claim_token=None,
                claim_owner=None,
                claim_expires_at=None,
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def transition_plan_step(self, step_id: str, target: PlanStepState) -> PlanStepRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM plan_steps WHERE id = ?", (step_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown plan step: {step_id}")
            current = PlanStepState(row["state"])
            validate_step_transition(current, target)
            now = utc_now_iso()
            clear_claim = target is not PlanStepState.RUNNING
            conn.execute(
                """UPDATE plan_steps
                      SET state = ?,
                          claim_token = CASE WHEN ? THEN NULL ELSE claim_token END,
                          claim_owner = CASE WHEN ? THEN NULL ELSE claim_owner END,
                          claim_expires_at = CASE WHEN ? THEN NULL ELSE claim_expires_at END,
                          updated_at = ?
                    WHERE id = ?""",
                (
                    target.value,
                    int(clear_claim),
                    int(clear_claim),
                    int(clear_claim),
                    now,
                    step_id,
                ),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.PLAN_STEP_STATE_CHANGED,
                    payload={
                        "plan_id": row["plan_id"],
                        "step_id": step_id,
                        "from": current.value,
                        "to": target.value,
                    },
                ),
            )
            conn.commit()
            return replace(
                self._plan_step_from_row(row),
                state=target,
                claim_token=None if clear_claim else row["claim_token"],
                claim_owner=None if clear_claim else row["claim_owner"],
                claim_expires_at=None if clear_claim else row["claim_expires_at"],
                updated_at=now,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def refresh_plan_readiness(self, plan_id: str) -> dict[str, list[str]]:
        conn = self._connect()
        ready_ids: list[str] = []
        blocked_ids: list[str] = []
        try:
            conn.execute("BEGIN IMMEDIATE")
            plan = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
            if plan is None:
                raise KeyError(f"unknown plan: {plan_id}")
            if PlanState(plan["state"]) is not PlanState.ACTIVE:
                conn.commit()
                return {"ready": ready_ids, "blocked": blocked_ids}

            rows = conn.execute(
                "SELECT * FROM plan_steps WHERE plan_id = ? ORDER BY priority DESC, created_at, id",
                (plan_id,),
            ).fetchall()
            state_by_id = {row["id"]: PlanStepState(row["state"]) for row in rows}
            deps_rows = conn.execute(
                """SELECT d.step_id, d.dependency_step_id
                     FROM plan_step_dependencies d
                     JOIN plan_steps s ON s.id = d.step_id
                    WHERE s.plan_id = ?""",
                (plan_id,),
            ).fetchall()
            deps: dict[str, list[str]] = {}
            for dep_row in deps_rows:
                deps.setdefault(dep_row["step_id"], []).append(dep_row["dependency_step_id"])

            now = utc_now_iso()
            for row in rows:
                current = PlanStepState(row["state"])
                if current not in {PlanStepState.PENDING, PlanStepState.BLOCKED}:
                    continue
                dependency_states = [state_by_id[dep] for dep in deps.get(row["id"], [])]
                if any(state in {PlanStepState.FAILED, PlanStepState.CANCELLED} for state in dependency_states):
                    target = PlanStepState.BLOCKED
                elif all(state is PlanStepState.SUCCEEDED for state in dependency_states):
                    target = PlanStepState.READY
                else:
                    continue
                if current == target:
                    continue
                validate_step_transition(current, target)
                conn.execute(
                    "UPDATE plan_steps SET state = ?, updated_at = ? WHERE id = ?",
                    (target.value, now, row["id"]),
                )
                self._insert_event(
                    conn,
                    EventRecord.create(
                        task_id=row["task_id"],
                        type=EventType.PLAN_STEP_STATE_CHANGED,
                        payload={
                            "plan_id": plan_id,
                            "step_id": row["id"],
                            "from": current.value,
                            "to": target.value,
                            "reason": "dependency_refresh",
                        },
                    ),
                )
                state_by_id[row["id"]] = target
                (ready_ids if target is PlanStepState.READY else blocked_ids).append(row["id"])
            conn.commit()
            return {"ready": ready_ids, "blocked": blocked_ids}
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def reclaim_expired_unbound_plan_steps(
        self,
        plan_id: str,
        *,
        now: float | None = None,
    ) -> list[str]:
        cutoff = time.time() if now is None else float(now)
        conn = self._connect()
        reclaimed: list[str] = []
        try:
            conn.execute("BEGIN IMMEDIATE")
            rows = conn.execute(
                """SELECT * FROM plan_steps
                    WHERE plan_id = ?
                      AND state = ?
                      AND execution_id IS NULL
                      AND claim_expires_at IS NOT NULL
                      AND claim_expires_at <= ?
                    ORDER BY claim_expires_at, id""",
                (plan_id, PlanStepState.RUNNING.value, cutoff),
            ).fetchall()
            updated_at = utc_now_iso()
            for row in rows:
                updated = conn.execute(
                    """UPDATE plan_steps
                          SET state = ?, claim_token = NULL, claim_owner = NULL,
                              claim_expires_at = NULL, updated_at = ?
                        WHERE id = ? AND state = ? AND execution_id IS NULL
                          AND claim_expires_at IS NOT NULL
                          AND claim_expires_at <= ?""",
                    (
                        PlanStepState.READY.value,
                        updated_at,
                        row["id"],
                        PlanStepState.RUNNING.value,
                        cutoff,
                    ),
                )
                if updated.rowcount != 1:
                    continue
                reclaimed.append(row["id"])
                self._insert_event(
                    conn,
                    EventRecord.create(
                        task_id=row["task_id"],
                        type=EventType.PLAN_STEP_STATE_CHANGED,
                        payload={
                            "plan_id": plan_id,
                            "step_id": row["id"],
                            "from": PlanStepState.RUNNING.value,
                            "to": PlanStepState.READY.value,
                            "reason": "claim_lease_expired_unbound",
                            "previous_claim_owner": row["claim_owner"],
                            "previous_claim_token": row["claim_token"],
                        },
                    ),
                )
            conn.commit()
            return reclaimed
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def claim_next_plan_step(
        self,
        plan_id: str,
        *,
        claim_owner: str,
        lease_seconds: float = 60.0,
    ) -> PlanStepRecord | None:
        if not claim_owner.strip():
            raise ValueError("claim_owner must not be empty")
        if lease_seconds <= 0:
            raise ValueError("lease_seconds must be > 0")
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                """SELECT * FROM plan_steps
                    WHERE plan_id = ? AND state = ?
                    ORDER BY priority DESC, created_at, id
                    LIMIT 1""",
                (plan_id, PlanStepState.READY.value),
            ).fetchone()
            if row is None:
                conn.commit()
                return None
            now_iso = utc_now_iso()
            claim_token = new_id("claim")
            claim_expires_at = time.time() + float(lease_seconds)
            updated = conn.execute(
                """UPDATE plan_steps
                      SET state = ?, claim_token = ?, claim_owner = ?,
                          claim_expires_at = ?, updated_at = ?
                    WHERE id = ? AND state = ?""",
                (
                    PlanStepState.RUNNING.value,
                    claim_token,
                    claim_owner,
                    claim_expires_at,
                    now_iso,
                    row["id"],
                    PlanStepState.READY.value,
                ),
            )
            if updated.rowcount != 1:
                conn.rollback()
                return None
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.PLAN_STEP_STATE_CHANGED,
                    payload={
                        "plan_id": plan_id,
                        "step_id": row["id"],
                        "from": PlanStepState.READY.value,
                        "to": PlanStepState.RUNNING.value,
                        "reason": "scheduler_claim",
                        "claim_owner": claim_owner,
                        "claim_token": claim_token,
                        "claim_expires_at": claim_expires_at,
                    },
                ),
            )
            conn.commit()
            return replace(
                self._plan_step_from_row(row),
                state=PlanStepState.RUNNING,
                claim_token=claim_token,
                claim_owner=claim_owner,
                claim_expires_at=claim_expires_at,
                updated_at=now_iso,
            )
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def evaluate_plan_state(self, plan_id: str) -> PlanState | None:
        plan = self.get_plan(plan_id)
        if plan is None:
            raise KeyError(f"unknown plan: {plan_id}")
        if plan.state is not PlanState.ACTIVE:
            return plan.state if plan.state in {PlanState.COMPLETED, PlanState.FAILED, PlanState.CANCELLED} else None

        states = [step.state for step in self.list_plan_steps(plan_id)]
        if states and all(state is PlanStepState.SUCCEEDED for state in states):
            return self.transition_plan(plan_id, PlanState.COMPLETED).state

        active = {PlanStepState.PENDING, PlanStepState.READY, PlanStepState.RUNNING}
        if states and not any(state in active for state in states) and any(
            state in {PlanStepState.FAILED, PlanStepState.BLOCKED, PlanStepState.CANCELLED}
            for state in states
        ):
            return self.transition_plan(plan_id, PlanState.FAILED).state
        return None

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

    def record_agent_restart_attempt(
        self,
        agent_id: str,
        *,
        diagnostic: str | None = None,
    ) -> AgentInstanceRecord:
        conn = self._connect()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute("SELECT * FROM agent_instances WHERE id = ?", (agent_id,)).fetchone()
            if row is None:
                raise KeyError(f"unknown agent: {agent_id}")
            restart_count = int(row["restart_count"]) + 1
            if restart_count > int(row["max_restarts"]):
                raise RuntimeError(f"agent restart budget exhausted: {agent_id}")
            now = utc_now_iso()
            conn.execute(
                "UPDATE agent_instances SET restart_count = ?, diagnostic = ?, updated_at = ? WHERE id = ?",
                (restart_count, diagnostic, now, agent_id),
            )
            self._insert_event(
                conn,
                EventRecord.create(
                    task_id=row["task_id"],
                    type=EventType.AGENT_RESTART_ATTEMPTED,
                    payload={
                        "agent_id": agent_id,
                        "restart_count": restart_count,
                        "max_restarts": int(row["max_restarts"]),
                    },
                ),
            )
            conn.commit()
            return replace(
                self._agent_from_row(row),
                restart_count=restart_count,
                diagnostic=diagnostic,
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
            recovery_attempts=int(row["recovery_attempts"]),
            execution_owner_pid=row["execution_owner_pid"],
            execution_owner_create_time=row["execution_owner_create_time"],
            execution_attempts=int(row["execution_attempts"] or 0),
            error=row["error"],
            created_at=row["created_at"], updated_at=row["updated_at"],
        )

    @staticmethod
    def _plan_from_row(row: sqlite3.Row) -> PlanRecord:
        return PlanRecord(
            id=row["id"],
            task_id=row["task_id"],
            objective=row["objective"],
            revision=int(row["revision"]),
            state=PlanState(row["state"]),
            metadata=_loads(row["metadata_json"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
        )

    @staticmethod
    def _plan_step_from_row(row: sqlite3.Row) -> PlanStepRecord:
        return PlanStepRecord(
            id=row["id"],
            plan_id=row["plan_id"],
            task_id=row["task_id"],
            title=row["title"],
            kind=PlanStepKind(row["kind"]),
            state=PlanStepState(row["state"]),
            spec=_loads(row["spec_json"]),
            execution_id=row["execution_id"],
            claim_token=row["claim_token"],
            claim_owner=row["claim_owner"],
            claim_expires_at=row["claim_expires_at"],
            priority=int(row["priority"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
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