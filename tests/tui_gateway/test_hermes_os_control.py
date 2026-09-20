from __future__ import annotations

from agent import estop
from hermes_cli import operations_audit
from tui_gateway import server


def _bind_estop_home(monkeypatch, home):
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setattr(estop, "_hermes_home", lambda: home)
    monkeypatch.setattr(estop, "_canonical_root", lambda: home)


def test_system_estop_rpc_uses_native_hermes_gate_and_audits(tmp_path, monkeypatch):
    _bind_estop_home(monkeypatch, tmp_path)
    operations_audit.reset_for_tests(home=tmp_path)

    engaged = server._methods["system.estop.set"](
        "pause",
        {"engaged": True, "reason": "operator test"},
    )
    assert engaged["result"]["engaged"] is True
    assert engaged["result"]["reason"] == "operator test"
    assert estop.is_engaged() is True

    status = server._methods["system.estop.get"]("status", {})
    assert status["result"]["engaged"] is True
    assert status["result"]["reason"] == "operator test"

    rows = operations_audit.list_events(home=tmp_path)
    assert rows[0]["event"] == "system.estop.engaged"
    assert rows[0]["category"] == "control"
    assert rows[0]["subject"] == "new_work"
    assert rows[0]["outcome"] == "operator test"

    resumed = server._methods["system.estop.set"]("resume", {"engaged": False})
    assert resumed["result"]["engaged"] is False
    assert estop.is_engaged() is False

    rows = operations_audit.list_events(home=tmp_path)
    assert rows[0]["event"] == "system.estop.disengaged"


def test_system_estop_set_is_idempotent(tmp_path, monkeypatch):
    _bind_estop_home(monkeypatch, tmp_path)

    first = server._methods["system.estop.set"]("one", {"engaged": True})
    second = server._methods["system.estop.set"]("two", {"engaged": True})

    assert first["result"]["engaged"] is True
    assert second["result"]["engaged"] is True

    first_resume = server._methods["system.estop.set"]("three", {"engaged": False})
    second_resume = server._methods["system.estop.set"]("four", {"engaged": False})

    assert first_resume["result"]["engaged"] is False
    assert second_resume["result"]["engaged"] is False
