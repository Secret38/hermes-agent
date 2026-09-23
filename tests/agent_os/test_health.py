from __future__ import annotations

import sqlite3

from agent_os.health import HealthStatus, collect_agent_os_health
from agent_os.store import AgentOSStore, SCHEMA_VERSION


def test_health_uninitialized_store_is_core_ready_when_parent_writable(tmp_path):
    report = collect_agent_os_health(
        db_path=tmp_path / "agent-os" / "agent_os.db",
        browser_probe=lambda: False,
        computer_use_probe=lambda: False,
    )

    assert report.core_ready is True
    assert report.full_ready is False
    store = next(c for c in report.checks if c.name == "durable_store")
    assert store.status is HealthStatus.PASS


def test_health_fix_initializes_store_and_schema(tmp_path):
    path = tmp_path / "agent_os.db"

    report = collect_agent_os_health(
        db_path=path,
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.core_ready is True
    assert report.full_ready is True
    with sqlite3.connect(path) as conn:
        version = int(
            conn.execute(
                "SELECT value FROM meta WHERE key='schema_version'"
            ).fetchone()[0]
        )
    assert version == SCHEMA_VERSION


def test_health_rejects_newer_store_schema(tmp_path):
    path = tmp_path / "agent_os.db"
    AgentOSStore(path).initialize()
    with sqlite3.connect(path) as conn:
        conn.execute(
            "UPDATE meta SET value=? WHERE key='schema_version'",
            (str(SCHEMA_VERSION + 1),),
        )
        conn.commit()

    report = collect_agent_os_health(
        db_path=path,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    store = next(c for c in report.checks if c.name == "durable_store")
    assert store.status is HealthStatus.FAIL
    assert report.core_ready is False
    assert report.full_ready is False


def test_full_ready_requires_browser_and_computer_use(tmp_path):
    path = tmp_path / "agent_os.db"
    AgentOSStore(path).initialize()

    report = collect_agent_os_health(
        db_path=path,
        browser_probe=lambda: True,
        computer_use_probe=lambda: False,
    )

    assert report.core_ready is True
    assert report.full_ready is False
    computer = next(c for c in report.checks if c.name == "computer_use")
    assert computer.remediation
