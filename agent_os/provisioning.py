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

    _post_setup_agent_browser("agent_browser")


def _install_computer_use() -> bool:
    from hermes_cli.tools_config_cua import install_cua_driver

    return bool(install_cua_driver(upgrade=False))


def provision_agent_os_runtime(
    *,
    include_browser: bool = True,
    include_computer_use: bool = True,
    browser_probe: Callable[[], bool] | None = None,
    computer_use_probe: Callable[[], bool] | None = None,
    browser_installer: Callable[[], object] | None = None,
    computer_use_installer: Callable[[], object] | None = None,
) -> AgentOSProvisionReport:
    """Provision selected external runtimes and verify the resulting state.

    The operation is explicit and idempotent. Existing Hermes installers remain
    the only installation backends; Agent OS only orchestrates and verifies them.
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

    health = collect_agent_os_health(
        fix=False,
        browser_probe=browser_probe,
        computer_use_probe=computer_use_probe,
    )
    selected_ready = all(component.ready for component in components)
    return AgentOSProvisionReport(
        components=tuple(components),
        health=health,
        success=health.core_ready and selected_ready,
    )
