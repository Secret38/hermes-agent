from pathlib import Path

from tools.computer_use import cua_backend


def _patch_config(monkeypatch, config):
    monkeypatch.setattr("hermes_cli.config.load_config", lambda: config)


def test_security_summary_defaults_safe_and_sanitized(monkeypatch):
    _patch_config(monkeypatch, {})

    summary = cua_backend.computer_use_security_summary()

    assert summary == {
        "permission_mode": "standard",
        "telemetry_enabled": False,
        "manifest": {
            "configured": False,
            "readable": False,
            "version": None,
            "mode_independent": False,
            "required": False,
        },
    }


def test_security_summary_reports_bounded_v3_without_manifest_path(tmp_path, monkeypatch):
    manifest = tmp_path / "private" / "capabilities.yaml"
    manifest.parent.mkdir()
    manifest.write_text("version: 3\napps: []\n", encoding="utf-8")

    _patch_config(
        monkeypatch,
        {
            "computer_use": {
                "permission_mode": "bounded",
                "capability_manifest": str(manifest),
                "cua_telemetry": True,
            }
        },
    )

    summary = cua_backend.computer_use_security_summary()

    assert summary == {
        "permission_mode": "bounded",
        "telemetry_enabled": True,
        "manifest": {
            "configured": True,
            "readable": True,
            "version": 3,
            "mode_independent": True,
            "required": True,
        },
    }
    assert str(manifest) not in repr(summary)
    assert str(manifest.parent) not in repr(summary)


def test_security_summary_marks_unreadable_manifest_without_error_details(tmp_path, monkeypatch):
    missing = tmp_path / "secret-location" / "missing.yaml"
    _patch_config(
        monkeypatch,
        {"computer_use": {"permission_mode": "bounded", "capability_manifest": str(missing)}},
    )

    summary = cua_backend.computer_use_security_summary()

    assert summary["manifest"] == {
        "configured": True,
        "readable": False,
        "version": None,
        "mode_independent": False,
        "required": True,
    }
    assert str(missing) not in repr(summary)
