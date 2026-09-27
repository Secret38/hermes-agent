"""Explicit Agent OS runtime provisioning built from existing Hermes installers."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .health import AgentOSHealthReport, collect_agent_os_health
from .store import AgentOSStore


@dataclass(frozen=True, slots=True)
class ProvisionComponent:
    name: str
    ready: bool
    changed: bool
    detail: str = ""


@dataclass(frozen=True, slots=True)
class AgentOSProvisionReport:
    components: tuple[ProvisionComponent, ...]
    health: AgentOSHealthReport
    success: bool


def _browser_ready() -> bool:
    from .adapters.hermes_browser import browser_available

    return browser_available()


def _computer_use_ready() -> bool:
    from tools.computer_use.permissions import computer_use_status

    return bool(computer_use_status().get("ready") is True)


def _install_browser() -> None:
    from hermes_cli.tools_config_post_setup import _post_setup_agent_browser
    from tools.browser_tool_install import reset_browser_install_cache

    _post_setup_agent_browser("agent_browser")
    reset_browser_install_cache()


def _install_computer_use() -> bool:
    from hermes_cli.tools_config_cua import install_cua_driver

    return bool(install_cua_driver(upgrade=False))



_PRODUCTION_SECURITY_POLICY = {
    ("approvals", "mode"): "manual",
    ("approvals", "cron_mode"): "deny",
    ("approvals", "single_query_mode"): "deny",
    ("approvals", "unattended_mode"): "deny",
    ("approvals", "confirm_host_mutations"): True,
    ("security", "tirith_enabled"): True,
    ("security", "tirith_fail_open"): False,
}


def _configure_production_security() -> tuple[bool, str]:
    """Apply the explicit Agent OS fail-closed profile and provision Tirith.

    This is intentionally opt-in at the Agent OS product layer; ordinary Hermes
    CLI installs keep their existing approval/scanner defaults.
    """
    from hermes_cli.config import load_config, save_config
    from tools import tirith_security

    config = load_config()
    changed = False
    for path, desired in _PRODUCTION_SECURITY_POLICY.items():
        node = config
        for part in path[:-1]:
            child = node.get(part)
            if not isinstance(child, dict):
                child = {}
                node[part] = child
            node = child
        if node.get(path[-1]) != desired:
            node[path[-1]] = desired
            changed = True

    if changed:
        save_config(
            config,
            preserve_keys=set(_PRODUCTION_SECURITY_POLICY),
            merge_existing=True,
        )

    scanner = tirith_security.ensure_installed_sync(log_failures=True)
    if not scanner or not tirith_security.scanner_healthy():
        raise RuntimeError(
            "Tirith could not be provisioned as an executable local scanner"
        )
    return changed, scanner


def provision_agent_os_runtime(
    *,
    include_browser: bool = True,
    include_computer_use: bool = True,
    include_production_security: bool = False,
    browser_probe: Callable[[], bool] | None = None,
    computer_use_probe: Callable[[], bool] | None = None,
    browser_installer: Callable[[], object] | None = None,
    computer_use_installer: Callable[[], object] | None = None,
    production_security_provisioner: Callable[[], object] | None = None,
) -> AgentOSProvisionReport:
    """Provision selected external runtimes and verify the resulting state.

    The operation is explicit and idempotent. Existing Hermes installers remain
    the installation backends; the optional production-security profile is an
    Agent OS product policy and never changes ordinary Hermes installs implicitly.
    """

    AgentOSStore().initialize()
    browser_probe = browser_probe or _browser_ready
    computer_use_probe = computer_use_probe or _computer_use_ready
    components: list[ProvisionComponent] = []

    if include_browser:
        before = bool(browser_probe())
        install_error = ""
        if not before:
            try:
                (browser_installer or _install_browser)()
            except Exception as exc:
                install_error = f"{type(exc).__name__}: {exc}"
        after = bool(browser_probe())
        components.append(
            ProvisionComponent(
                "browser",
                after,
                changed=(not before and after),
                detail=(
                    "already ready"
                    if before
                    else "provisioned and verified"
                    if after
                    else f"provisioning failed{': ' + install_error if install_error else ''}"
                ),
            )
        )

    if include_computer_use:
        before = bool(computer_use_probe())
        install_error = ""
        if not before:
            try:
                result = (computer_use_installer or _install_computer_use)()
                if result is False:
                    install_error = "installer reported failure"
            except Exception as exc:
                install_error = f"{type(exc).__name__}: {exc}"
        after = bool(computer_use_probe())
        components.append(
            ProvisionComponent(
                "computer_use",
                after,
                changed=(not before and after),
                detail=(
                    "already ready"
                    if before
                    else "provisioned and verified"
                    if after
                    else f"provisioning failed{': ' + install_error if install_error else ''}"
                ),
            )
        )

    security_changed = False
    security_error = ""
    if include_production_security:
        try:
            result = (production_security_provisioner or _configure_production_security)()
            if isinstance(result, tuple) and result:
                security_changed = bool(result[0])
            else:
                security_changed = True
        except Exception as exc:
            security_error = f"{type(exc).__name__}: {exc}"

    health = collect_agent_os_health(
        fix=False,
        browser_probe=browser_probe,
        computer_use_probe=computer_use_probe,
    )
    if include_production_security:
        components.append(
            ProvisionComponent(
                "production_security",
                health.production_security_ready,
                changed=security_changed and health.production_security_ready,
                detail=(
                    "fail-closed profile and scanner verified"
                    if health.production_security_ready
                    else f"provisioning failed{': ' + security_error if security_error else ''}"
                ),
            )
        )
    selected_ready = all(component.ready for component in components)
    return AgentOSProvisionReport(
        components=tuple(components),
        health=health,
        success=health.core_ready and selected_ready,
    )
