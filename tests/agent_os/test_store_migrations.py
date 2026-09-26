from __future__ import annotations

import sqlite3

import pytest

import agent_os.store as store_module
from agent_os.agents.records import AgentInstanceRecord
from agent_os.contracts import TaskRecord
from agent_os.orchestration.plan import PlanRecord
from agent_os.store import AgentOSStore, SCHEMA_VERSION


_V1_SCHEMA = """
CREATE TABLE meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT INTO meta(key, value) VALUES ('schema_version', '1');

CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    goal TEXT NOT NULL,
    state TEXT NOT NULL,
    parent_task_id TEXT,
    session_id TEXT,
    kanban_task_id TEXT,
    workspace_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE actions (
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
    updated_at TEXT NOT NULL
);
CREATE TABLE events (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    task_id TEXT NOT NULL,
    action_id TEXT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
);
"""


def test_v1_database_upgrades_without_losing_existing_task(tmp_path):
    path = tmp_path / "agent_os.db"
    conn = sqlite3.connect(path)
    try:
        conn.executescript(_V1_SCHEMA)
        conn.execute(
            """INSERT INTO tasks(
                id, goal, state, metadata_json, created_at, updated_at
            ) VALUES ('legacy-task', 'legacy goal', 'CREATED', '{}', 'a', 'a')"""
        )
        conn.commit()
    finally:
        conn.close()

    store = AgentOSStore(path)
    legacy = store.get_task("legacy-task")
    assert legacy is not None
    assert legacy.goal == "legacy goal"

    agent = store.create_agent(
        AgentInstanceRecord.create(
            task_id="legacy-task",
            runtime="fake",
            goal="continue",
        )
    )
    plan = store.create_plan(
        PlanRecord.create(task_id="legacy-task", objective="continue"),
        [],
        {},
    )

    assert store.get_agent(agent.id) is not None
    assert store.get_plan(plan.id) is not None

    conn = sqlite3.connect(path)
    try:
        assert conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0] == str(SCHEMA_VERSION)
    finally:
        conn.close()


def test_future_database_version_fails_closed(tmp_path):
    path = tmp_path / "agent_os.db"
    conn = sqlite3.connect(path)
    try:
        conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION + 1),),
        )
        conn.commit()
    finally:
        conn.close()

    with pytest.raises(RuntimeError, match="newer than supported"):
        AgentOSStore(path).get_task("anything")


def test_fresh_database_reaches_current_version(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    task = store.create_task(TaskRecord.create("fresh"))

    assert store.get_task(task.id) is not None
    conn = sqlite3.connect(path)
    try:
        version = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0]
    finally:
        conn.close()
    assert version == str(SCHEMA_VERSION)


def test_v3_database_adds_execution_binding_column(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    task = store.create_task(TaskRecord.create("migrate binding"))

    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "UPDATE meta SET value = '3' WHERE key = 'schema_version'"
        )
        conn.execute("DROP INDEX IF EXISTS idx_plan_steps_execution")
        conn.commit()
    finally:
        conn.close()

    upgraded = AgentOSStore(path)
    assert upgraded.get_task(task.id) is not None

    conn = sqlite3.connect(path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(plan_steps)").fetchall()
        }
        version = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0]
    finally:
        conn.close()

    assert "execution_id" in columns
    assert version == str(SCHEMA_VERSION)


def test_failed_migration_rolls_back_schema_and_version(tmp_path, monkeypatch):
    path = tmp_path / "agent_os.db"
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        conn.execute(
            "INSERT INTO meta(key, value) VALUES ('schema_version', '3')"
        )
        conn.execute(
            "CREATE TABLE plan_steps (id TEXT PRIMARY KEY)"
        )
        conn.commit()
    finally:
        conn.close()

    def broken_migration(conn):
        conn.execute("ALTER TABLE plan_steps ADD COLUMN transient_col TEXT")
        raise RuntimeError("synthetic migration failure")

    monkeypatch.setitem(store_module._MIGRATIONS, 4, broken_migration)

    with pytest.raises(RuntimeError, match="synthetic migration failure"):
        AgentOSStore(path).get_task("unused")

    conn = sqlite3.connect(path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(plan_steps)").fetchall()
        }
        version = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0]
    finally:
        conn.close()

    assert "transient_col" not in columns
    assert version == "3"


def test_v4_database_adds_plan_claim_lease_columns(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    task = store.create_task(TaskRecord.create("lease migration"))

    conn = sqlite3.connect(path)
    try:
        conn.execute("UPDATE meta SET value = '4' WHERE key = 'schema_version'")
        conn.execute("DROP INDEX IF EXISTS idx_plan_steps_claim")
        conn.commit()
    finally:
        conn.close()

    upgraded = AgentOSStore(path)
    assert upgraded.get_task(task.id) is not None

    conn = sqlite3.connect(path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(plan_steps)").fetchall()
        }
        version = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0]
    finally:
        conn.close()

    assert {"claim_token", "claim_owner", "claim_expires_at"} <= columns
    assert version == str(SCHEMA_VERSION)


def test_v5_database_adds_action_execution_owner_columns(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    task = store.create_task(TaskRecord.create("action owner migration"))

    conn = sqlite3.connect(path)
    try:
        conn.execute("UPDATE meta SET value = '5' WHERE key = 'schema_version'")
        conn.execute("DROP INDEX IF EXISTS idx_actions_execution_owner")
        conn.commit()
    finally:
        conn.close()

    upgraded = AgentOSStore(path)
    assert upgraded.get_task(task.id) is not None

    conn = sqlite3.connect(path)
    try:
        columns = {
            row[1] for row in conn.execute("PRAGMA table_info(actions)").fetchall()
        }
        version = conn.execute(
            "SELECT value FROM meta WHERE key='schema_version'"
        ).fetchone()[0]
    finally:
        conn.close()

    assert {
        "execution_owner_pid",
        "execution_owner_create_time",
        "execution_attempts",
    } <= columns
    assert version == str(SCHEMA_VERSION)
