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



def test_provision_production_security_profile_is_explicit(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    calls = {"security": 0}

    def security_provisioner():
        calls["security"] += 1
        return True, "tirith.exe"

    monkeypatch.setattr(
        provisioning,
        "collect_agent_os_health",
        lambda **_kwargs: SimpleNamespace(
            core_ready=True,
            full_ready=True,
            production_security_ready=True,
        ),
    )

    report = provisioning.provision_agent_os_runtime(
        include_browser=False,
        include_computer_use=False,
        include_production_security=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
        production_security_provisioner=security_provisioner,
    )

    assert calls["security"] == 1
    assert report.success is True
    assert len(report.components) == 1
    component = report.components[0]
    assert component.name == "production_security"
    assert component.ready is True
    assert component.detail == "fail-closed profile and scanner verified"


def test_provision_does_not_change_security_profile_unless_requested(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    called = False

    def security_provisioner():
        nonlocal called
        called = True
        raise AssertionError("security provisioner must remain opt-in")

    report = provisioning.provision_agent_os_runtime(
        include_browser=False,
        include_computer_use=False,
        include_production_security=False,
        browser_probe=lambda: False,
        computer_use_probe=lambda: False,
        production_security_provisioner=security_provisioner,
    )

    assert called is False
    assert report.success is True


def test_provision_security_failure_is_part_of_success_contract(tmp_path, monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(
        provisioning,
        "collect_agent_os_health",
        lambda **_kwargs: SimpleNamespace(
            core_ready=True,
            full_ready=True,
            production_security_ready=False,
        ),
    )

    report = provisioning.provision_agent_os_runtime(
        include_browser=False,
        include_computer_use=False,
        include_production_security=True,
        browser_probe=lambda: True,
        computer_use_probe=lambda: True,
        production_security_provisioner=lambda: (_ for _ in ()).throw(
            RuntimeError("scanner install failed")
        ),
    )

    assert report.success is False
    component = report.components[0]
    assert component.name == "production_security"
    assert component.ready is False
    assert "scanner install failed" in component.detail
