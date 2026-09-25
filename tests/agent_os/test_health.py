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


def test_production_security_is_separate_from_runtime_readiness(monkeypatch, tmp_path):
    from tools import approval_context

    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "off")
    monkeypatch.setattr(approval_context, "_get_cron_approval_mode", lambda: "approve")
    monkeypatch.setattr(approval_context, "_get_single_query_approval_mode", lambda: "approve")
    monkeypatch.setattr(approval_context, "_get_unattended_approval_mode", lambda: "approve")
    monkeypatch.setattr(approval_context, "_tirith_fail_open", lambda: True)

    report = collect_agent_os_health(
        db_path=tmp_path / "agent_os.db",
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.full_ready is True
    assert report.production_security_ready is False
    security = next(c for c in report.checks if c.name == "production_security")
    assert security.status is HealthStatus.FAIL
    assert security.required_for_full is False
    assert security.required_for_production_security is True


def test_production_security_passes_only_for_fail_closed_policy(monkeypatch, tmp_path):
    from tools import approval_context, tirith_security

    monkeypatch.delenv("SUDO_PASSWORD", raising=False)
    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "manual")
    monkeypatch.setattr(approval_context, "_get_cron_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_single_query_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_unattended_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: True)
    monkeypatch.setattr(approval_context, "_tirith_fail_open", lambda: False)
    monkeypatch.setattr(tirith_security, "scanner_healthy", lambda: True)

    report = collect_agent_os_health(
        db_path=tmp_path / "agent_os.db",
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.production_security_ready is True
    security = next(c for c in report.checks if c.name == "production_security")
    assert security.status is HealthStatus.PASS

def test_production_security_rejects_stored_sudo_password(monkeypatch, tmp_path):
    from tools import approval_context, tirith_security

    monkeypatch.setenv("SUDO_PASSWORD", "configured-secret")
    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "manual")
    monkeypatch.setattr(approval_context, "_get_cron_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_single_query_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_unattended_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: True)
    monkeypatch.setattr(approval_context, "_tirith_fail_open", lambda: False)
    monkeypatch.setattr(tirith_security, "scanner_healthy", lambda: True)

    report = collect_agent_os_health(
        db_path=tmp_path / "agent_os.db",
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.production_security_ready is False
    security = next(c for c in report.checks if c.name == "production_security")
    assert security.status is HealthStatus.FAIL
    assert "SUDO_PASSWORD" in security.detail

def test_production_security_rejects_unhealthy_tirith_scanner(monkeypatch, tmp_path):
    from tools import approval_context, tirith_security

    monkeypatch.delenv("SUDO_PASSWORD", raising=False)
    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "manual")
    monkeypatch.setattr(approval_context, "_get_cron_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_single_query_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_unattended_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: True)
    monkeypatch.setattr(approval_context, "_tirith_fail_open", lambda: False)
    monkeypatch.setattr(tirith_security, "scanner_healthy", lambda: False)

    report = collect_agent_os_health(
        db_path=tmp_path / "agent_os.db",
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.full_ready is True
    assert report.production_security_ready is False
    security = next(c for c in report.checks if c.name == "production_security")
    assert security.status is HealthStatus.FAIL
    assert "not installed, executable, or healthy" in security.detail



def test_production_security_rejects_missing_tirith_binary(monkeypatch, tmp_path):
    from tools import approval_context, tirith_security

    monkeypatch.delenv("SUDO_PASSWORD", raising=False)
    monkeypatch.setattr(approval_context, "_get_approval_mode", lambda: "manual")
    monkeypatch.setattr(approval_context, "_get_cron_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_single_query_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_get_unattended_approval_mode", lambda: "deny")
    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: True)
    monkeypatch.setattr(approval_context, "_tirith_fail_open", lambda: False)
    monkeypatch.setattr(tirith_security, "scanner_healthy", lambda: False)

    report = collect_agent_os_health(
        db_path=tmp_path / "agent_os.db",
        fix=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
    )

    assert report.full_ready is True
    assert report.production_security_ready is False
    security = next(c for c in report.checks if c.name == "production_security")
    assert security.status is HealthStatus.FAIL
    assert "not installed, executable, or healthy" in security.detail
