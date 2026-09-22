from __future__ import annotations

from types import SimpleNamespace

from tools.computer_use import permissions


def _doctor(status: str, label: str = "interactive session"):
    return {
        "ok": True,
        "checks": [
            {
                "label": label,
                "status": status,
                "message": "probe",
            }
        ],
    }


def test_windows_session_zero_warning_is_not_full_ready(monkeypatch):
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_daemon_ready",
        lambda binary: False,
    )

    assert (
        permissions._doctor_desktop_ready(
            "win32",
            _doctor("warn"),
            "cua-driver",
        )
        is False
    )


def test_windows_session_zero_can_proxy_to_interactive_daemon(monkeypatch):
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_daemon_ready",
        lambda binary: True,
    )

    assert (
        permissions._doctor_desktop_ready(
            "win32",
            _doctor("warn"),
            "cua-driver",
        )
        is True
    )


def test_windows_interactive_probe_passes_without_daemon(monkeypatch):
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_daemon_ready",
        lambda binary: False,
    )

    assert permissions._doctor_desktop_ready(
        "win32",
        _doctor("ok"),
        "cua-driver",
    )


def test_linux_display_warning_blocks_desktop_readiness():
    assert (
        permissions._doctor_desktop_ready(
            "linux",
            _doctor("warn", "display server"),
            "cua-driver",
        )
        is False
    )


def test_windows_daemon_status_requires_session_above_zero(monkeypatch):
    monkeypatch.setattr(
        permissions,
        "_run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout="Cua Driver daemon is running\\nsession: 0\\n",
        ),
    )
    assert permissions._windows_interactive_daemon_ready("cua-driver") is False

    monkeypatch.setattr(
        permissions,
        "_run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=0,
            stdout="Cua Driver daemon is running\\nsession: 2\\n",
        ),
    )
    assert permissions._windows_interactive_daemon_ready("cua-driver") is True


def test_windows_missing_doctor_session_probe_requires_interactive_context(monkeypatch):
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_context_ready",
        lambda binary: False,
    )
    assert (
        permissions._doctor_desktop_ready(
            "win32",
            {"ok": True, "checks": []},
            "cua-driver",
        )
        is False
    )


def test_windows_direct_interactive_session_satisfies_context(monkeypatch):
    monkeypatch.setattr(permissions, "_windows_process_session_id", lambda: 3)
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_daemon_ready",
        lambda binary: False,
    )
    assert permissions._windows_interactive_context_ready("cua-driver") is True


def test_windows_session_zero_needs_interactive_daemon(monkeypatch):
    monkeypatch.setattr(permissions, "_windows_process_session_id", lambda: 0)
    monkeypatch.setattr(
        permissions,
        "_windows_interactive_daemon_ready",
        lambda binary: True,
    )
    assert permissions._windows_interactive_context_ready("cua-driver") is True
