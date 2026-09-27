from __future__ import annotations

from agent_os import health


def test_default_computer_use_probe_requires_driver_health_not_binary_only(monkeypatch):
    monkeypatch.setattr(
        "tools.computer_use.permissions.computer_use_status",
        lambda: {"installed": True, "ready": False},
    )
    assert health._computer_use_probe() is False

    monkeypatch.setattr(
        "tools.computer_use.permissions.computer_use_status",
        lambda: {"installed": True, "ready": True},
    )
    assert health._computer_use_probe() is True
