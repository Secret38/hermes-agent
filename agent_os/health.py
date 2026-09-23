"""Production health contract for the Agent OS runtime."""

from __future__ import annotations

import os
import platform
import sqlite3
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Callable

from .store import AgentOSStore, SCHEMA_VERSION, default_db_path


class HealthStatus(StrEnum):
    PASS = "PASS"
    WARN = "WARN"
    FAIL = "FAIL"


@dataclass(frozen=True, slots=True)
class HealthCheck:
    name: str
    status: HealthStatus
    detail: str
    required_for_core: bool = False
    required_for_full: bool = False
    required_for_production_security: bool = False
    remediation: str | None = None

    @property
    def ok(self) -> bool:
        return self.status is not HealthStatus.FAIL

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "status": self.status.value,
            "detail": self.detail,
            "required_for_core": self.required_for_core,
            "required_for_full": self.required_for_full,
            "required_for_production_security": self.required_for_production_security,
            "remediation": self.remediation,
        }


@dataclass(frozen=True, slots=True)
class AgentOSHealthReport:
    platform: str
    store_path: str
    core_ready: bool
    full_ready: bool
    checks: tuple[HealthCheck, ...]
    production_security_ready: bool = False

    def to_dict(self) -> dict:
        return {
            "platform": self.platform,
            "store_path": self.store_path,
            "core_ready": self.core_ready,
            "full_ready": self.full_ready,
            "production_security_ready": self.production_security_ready,
            "checks": [check.to_dict() for check in self.checks],
        }


def _nearest_existing_parent(path: Path) -> Path:
    current = path
    while not current.exists() and current != current.parent:
        current = current.parent
    return current


def _store_check(path: Path, *, fix: bool) -> HealthCheck:
    if fix:
        try:
            info = AgentOSStore(path).initialize()
        except Exception as exc:
            return HealthCheck(
                "durable_store",
                HealthStatus.FAIL,
                f"store initialization failed: {type(exc).__name__}: {exc}",
                required_for_core=True,
                required_for_full=True,
                remediation="Check filesystem permissions and free space, then rerun hermes agent-os doctor --fix.",
            )
        if info.get("integrity") != "ok":
            return HealthCheck(
                "durable_store",
                HealthStatus.FAIL,
                f"SQLite quick_check returned {info.get('integrity')!r}",
                required_for_core=True,
                required_for_full=True,
                remediation="Restore the Agent OS database from backup or move the damaged database aside before retrying.",
            )
        return HealthCheck(
            "durable_store",
            HealthStatus.PASS,
            f"schema={info.get('schema_version')} integrity=ok",
            required_for_core=True,
            required_for_full=True,
        )

    if not path.exists():
        parent = _nearest_existing_parent(path.parent)
        writable = parent.exists() and os.access(parent, os.W_OK)
        return HealthCheck(
            "durable_store",
            HealthStatus.PASS if writable else HealthStatus.FAIL,
            (
                "not initialized yet; first run can create it"
                if writable
                else f"store is uninitialized and nearest existing parent is not writable: {parent}"
            ),
            required_for_core=True,
            required_for_full=True,
            remediation=None if writable else "Fix filesystem permissions for the Hermes home.",
        )

    try:
        uri = path.resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(uri, uri=True, timeout=5)
        try:
            quick = conn.execute("PRAGMA quick_check").fetchone()
            integrity = str(quick[0] if quick else "")
            has_meta = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'"
            ).fetchone()
            version = 0
            if has_meta:
                row = conn.execute(
                    "SELECT value FROM meta WHERE key='schema_version'"
                ).fetchone()
                if row is not None:
                    version = int(row[0])
        finally:
            conn.close()
    except Exception as exc:
        return HealthCheck(
            "durable_store",
            HealthStatus.FAIL,
            f"read-only store health check failed: {type(exc).__name__}: {exc}",
            required_for_core=True,
            required_for_full=True,
            remediation="Run hermes agent-os doctor --fix; restore from backup if integrity remains broken.",
        )

    if integrity != "ok":
        return HealthCheck(
            "durable_store",
            HealthStatus.FAIL,
            f"SQLite quick_check returned {integrity!r}",
            required_for_core=True,
            required_for_full=True,
            remediation="Restore the Agent OS database from backup or move the damaged database aside.",
        )
    if version > SCHEMA_VERSION:
        return HealthCheck(
            "durable_store",
            HealthStatus.FAIL,
            f"database schema {version} is newer than this runtime supports ({SCHEMA_VERSION})",
            required_for_core=True,
            required_for_full=True,
            remediation="Upgrade Hermes/Agent OS before opening this database.",
        )
    if version < SCHEMA_VERSION:
        return HealthCheck(
            "durable_store",
            HealthStatus.WARN,
            f"database schema {version} will migrate to {SCHEMA_VERSION} on first write",
            required_for_core=True,
            required_for_full=True,
            remediation="Run hermes agent-os doctor --fix to migrate now.",
        )
    return HealthCheck(
        "durable_store",
        HealthStatus.PASS,
        f"schema={version} integrity=ok",
        required_for_core=True,
        required_for_full=True,
    )


def _probe_check(
    name: str,
    probe: Callable[[], bool],
    *,
    required_for_core: bool,
    required_for_full: bool,
    success: str,
    failure: str,
    remediation: str,
) -> HealthCheck:
    try:
        available = bool(probe())
    except Exception as exc:
        return HealthCheck(
            name,
            HealthStatus.FAIL,
            f"probe failed: {type(exc).__name__}: {exc}",
            required_for_core=required_for_core,
            required_for_full=required_for_full,
            remediation=remediation,
        )
    return HealthCheck(
        name,
        HealthStatus.PASS if available else HealthStatus.FAIL,
        success if available else failure,
        required_for_core=required_for_core,
        required_for_full=required_for_full,
        remediation=None if available else remediation,
    )


def _browser_probe() -> bool:
    from .adapters.hermes_browser import browser_available

    return browser_available()


def _computer_use_probe() -> bool:
    from tools.computer_use.permissions import computer_use_status

    status = computer_use_status()
    return bool(status.get("ready") is True)


def _production_security_check() -> HealthCheck:
    """Verify fail-closed policy for remote/content-driven production use."""

    try:
        from tools import approval_context

        mode = approval_context._get_approval_mode()
        cron_mode = approval_context._get_cron_approval_mode()
        single_query_mode = approval_context._get_single_query_approval_mode()
        unattended_mode = approval_context._get_unattended_approval_mode()
        confirm_host_mutations = approval_context._confirm_host_mutations()
        tirith_fail_open = approval_context._tirith_fail_open()
        from tools import tirith_security
        tirith_scanner_healthy = tirith_security.scanner_healthy()
    except Exception as exc:
        return HealthCheck(
            "production_security",
            HealthStatus.FAIL,
            f"production security policy could not be resolved: {type(exc).__name__}: {exc}",
            required_for_production_security=True,
            remediation=(
                "Repair config access and verify docs/agent-os-production-security.md."
            ),
        )

    unsafe: list[str] = []
    if mode != "manual":
        unsafe.append(f"approvals.mode={mode}")
    if cron_mode != "deny":
        unsafe.append(f"approvals.cron_mode={cron_mode}")
    if single_query_mode != "deny":
        unsafe.append(f"approvals.single_query_mode={single_query_mode}")
    if unattended_mode != "deny":
        unsafe.append(f"approvals.unattended_mode={unattended_mode}")
    if not confirm_host_mutations:
        unsafe.append("approvals.confirm_host_mutations=false")
    if tirith_fail_open:
        unsafe.append("Tirith disabled or security.tirith_fail_open=true")
    elif not tirith_scanner_healthy:
        unsafe.append("Tirith scanner is not installed, executable, or healthy")
    if "SUDO_PASSWORD" in os.environ:
        unsafe.append("SUDO_PASSWORD is configured")

    if unsafe:
        return HealthCheck(
            "production_security",
            HealthStatus.FAIL,
            "unsafe production policy: " + ", ".join(unsafe),
            required_for_production_security=True,
            remediation=(
                "Use manual approvals with approvals.confirm_host_mutations=true; "
                "deny cron/single-query/unattended approvals; "
                "enable Tirith with security.tirith_fail_open=false; remove SUDO_PASSWORD "
                "from the Agent environment. See docs/agent-os-production-security.md."
            ),
        )

    return HealthCheck(
        "production_security",
        HealthStatus.PASS,
        "manual approvals; host mutations require exact consent; unattended contexts deny; "
        "Tirith scanner healthy and fail-closed; no stored sudo password",
        required_for_production_security=True,
    )


def collect_agent_os_health(
    *,
    db_path: Path | str | None = None,
    fix: bool = False,
    browser_probe: Callable[[], bool] | None = None,
    computer_use_probe: Callable[[], bool] | None = None,
) -> AgentOSHealthReport:
    """Collect non-network Agent OS readiness with optional local store repair."""

    path = Path(db_path) if db_path is not None else default_db_path()
    checks = [
        HealthCheck(
            "runtime_core",
            HealthStatus.PASS,
            f"Agent OS runtime loaded on Python {platform.python_version()}",
            required_for_core=True,
            required_for_full=True,
        ),
        _store_check(path, fix=fix),
        _probe_check(
            "browser",
            browser_probe or _browser_probe,
            required_for_core=False,
            required_for_full=True,
            success="Hermes browser runtime is available",
            failure="Hermes browser runtime is unavailable",
            remediation="Run hermes agent-os provision to install and verify the browser runtime.",
        ),
        _probe_check(
            "computer_use",
            computer_use_probe or _computer_use_probe,
            required_for_core=False,
            required_for_full=True,
            success="Hermes computer-use runtime is available",
            failure="Hermes computer-use runtime is unavailable",
            remediation="Run hermes agent-os provision, then re-run hermes agent-os status --require-full.",
        ),
        _production_security_check(),
    ]

    core_ready = all(check.ok for check in checks if check.required_for_core)
    full_ready = core_ready and all(
        check.ok for check in checks if check.required_for_full
    )
    production_security_ready = all(
        check.ok for check in checks if check.required_for_production_security
    )
    return AgentOSHealthReport(
        platform=platform.platform(),
        store_path=str(path),
        core_ready=core_ready,
        full_ready=full_ready,
        checks=tuple(checks),
        production_security_ready=production_security_ready,
    )