from __future__ import annotations

from agent_os import provisioning


def test_provision_is_idempotent_when_components_are_ready(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    calls = {"browser": 0, "computer": 0}

    report = provisioning.provision_agent_os_runtime(
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
        browser_installer=lambda: calls.__setitem__("browser", calls["browser"] + 1),
        computer_use_installer=lambda: calls.__setitem__("computer", calls["computer"] + 1),
    )

    assert report.success is True
    assert calls == {"browser": 0, "computer": 0}
    assert all(component.ready for component in report.components)


def test_provision_installs_missing_components_then_reprobes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    state = {"browser": False, "computer": False}

    def install_browser():
        state["browser"] = True

    def install_computer():
        state["computer"] = True
        return True

    report = provisioning.provision_agent_os_runtime(
        browser_probe=lambda: state["browser"],
        computer_use_probe=lambda: state["computer"],
        browser_installer=install_browser,
        computer_use_installer=install_computer,
    )

    assert report.success is True
    assert all(component.changed for component in report.components)


def test_provision_fails_when_installer_returns_without_runtime(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    report = provisioning.provision_agent_os_runtime(
        include_browser=False,
        computer_use_probe=lambda: False,
        computer_use_installer=lambda: True,
        browser_probe=lambda: True,
    )

    assert report.success is False
    component = report.components[0]
    assert component.name == "computer_use"
    assert component.ready is False


def test_provision_can_target_core_without_external_components(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    report = provisioning.provision_agent_os_runtime(
        include_browser=False,
        include_computer_use=False,
        browser_probe=lambda: False,
        computer_use_probe=lambda: False,
    )

    assert report.success is True
    assert report.components == ()
    assert report.health.core_ready is True
    assert report.health.full_ready is False
