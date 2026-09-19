"""config.get / config.set must honor params.profile (issue #95760).

A single dashboard backend in desktop app-global remote mode serves every
profile. projects.* RPCs already bind params.profile via @_profile_scoped;
config.get / config.set did not, so reads and persistent writes used the
launch profile's config.yaml for every focused profile.
"""

from __future__ import annotations

from pathlib import Path

import yaml

import tui_gateway.server as server


LAUNCH_CWD = "/workspace/default"
WORKER_CWD = "/workspace/code"
LAUNCH_ROOTS = ["/workspace/default"]
WORKER_ROOTS = ["/workspace/code"]


def _write_cfg(home: Path, cwd: str, roots: list[str]) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "terminal": {"cwd": cwd},
                "desktop": {"repo_scan_roots": list(roots)},
                "display": {"busy_input_mode": "queue"},
            }
        ),
        encoding="utf-8",
    )


def _homes(tmp_path: Path) -> tuple[Path, Path]:
    launch = tmp_path / "launch"
    worker = tmp_path / "profiles" / "code"
    _write_cfg(launch, LAUNCH_CWD, LAUNCH_ROOTS)
    _write_cfg(worker, WORKER_CWD, WORKER_ROOTS)
    return launch, worker


def _reset_cfg_cache() -> None:
    server._cfg_cache = None
    server._cfg_sig = None
    server._cfg_path = None


def _bind_homes(monkeypatch, launch: Path, worker: Path) -> None:
    monkeypatch.setattr(server, "_hermes_home", launch)
    monkeypatch.setattr(
        server,
        "_profile_home",
        lambda name: worker if (name or "").strip() == "code" else None,
    )
    _reset_cfg_cache()


def _get(params: dict) -> dict:
    return server._methods["config.get"]("rid-get", params)


def _set(params: dict) -> dict:
    return server._methods["config.set"]("rid-set", params)


def _read_yaml(home: Path) -> dict:
    return yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) or {}


def test_config_get_full_reads_params_profile_yaml_not_launch(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)
    _bind_homes(monkeypatch, launch, worker)

    launch_resp = _get({"key": "full"})
    assert launch_resp["result"]["config"]["terminal"]["cwd"] == LAUNCH_CWD
    assert launch_resp["result"]["config"]["desktop"]["repo_scan_roots"] == LAUNCH_ROOTS

    _reset_cfg_cache()
    worker_resp = _get({"key": "full", "profile": "code"})
    assert worker_resp["result"]["config"]["terminal"]["cwd"] == WORKER_CWD
    assert worker_resp["result"]["config"]["desktop"]["repo_scan_roots"] == WORKER_ROOTS

    # Launch file must be untouched by the focused-profile read.
    assert _read_yaml(launch)["terminal"]["cwd"] == LAUNCH_CWD


def test_config_set_persistent_write_lands_on_params_profile_yaml(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)
    _bind_homes(monkeypatch, launch, worker)

    resp = _set({"key": "busy", "value": "steer", "profile": "code"})
    assert resp["result"]["value"] == "steer"

    worker_cfg = _read_yaml(worker)
    launch_cfg = _read_yaml(launch)
    assert worker_cfg["display"]["busy_input_mode"] == "steer"
    assert launch_cfg["display"]["busy_input_mode"] == "queue"
    assert launch_cfg["terminal"]["cwd"] == LAUNCH_CWD
    assert worker_cfg["terminal"]["cwd"] == WORKER_CWD


def test_config_set_without_profile_still_writes_launch_home(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)
    _bind_homes(monkeypatch, launch, worker)

    resp = _set({"key": "busy", "value": "interrupt"})
    assert resp["result"]["value"] == "interrupt"
    assert _read_yaml(launch)["display"]["busy_input_mode"] == "interrupt"
    assert _read_yaml(worker)["display"]["busy_input_mode"] == "queue"


def test_computer_use_security_getter_is_profile_scoped_and_sanitized(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)
    manifest = worker / "private" / "capabilities.yaml"
    manifest.parent.mkdir()
    manifest.write_text("version: 3\napps: []\n", encoding="utf-8")

    launch_cfg = _read_yaml(launch)
    launch_cfg["computer_use"] = {"permission_mode": "standard", "cua_telemetry": False}
    (launch / "config.yaml").write_text(yaml.safe_dump(launch_cfg), encoding="utf-8")

    worker_cfg = _read_yaml(worker)
    worker_cfg["computer_use"] = {
        "permission_mode": "bounded",
        "capability_manifest": str(manifest),
        "cua_telemetry": True,
    }
    (worker / "config.yaml").write_text(yaml.safe_dump(worker_cfg), encoding="utf-8")

    _bind_homes(monkeypatch, launch, worker)

    launch_resp = _get({"key": "computer_use.security"})
    assert launch_resp["result"] == {
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

    _reset_cfg_cache()
    worker_resp = _get({"key": "computer_use.security", "profile": "code"})
    assert worker_resp["result"] == {
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
    assert str(manifest) not in repr(worker_resp)


def test_telemetry_security_getter_is_profile_scoped_and_sanitized(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)

    launch_cfg = _read_yaml(launch)
    launch_cfg["telemetry"] = {
        "shared_metrics": {
            "enabled": False,
            "send": True,
            "endpoint": "http://metrics.example.invalid/private/path",
        }
    }
    (launch / "config.yaml").write_text(yaml.safe_dump(launch_cfg), encoding="utf-8")

    worker_cfg = _read_yaml(worker)
    worker_cfg["telemetry"] = {
        "shared_metrics": {
            "enabled": True,
            "send": True,
            "endpoint": "https://metrics.example.internal/v1/private",
        }
    }
    (worker / "config.yaml").write_text(yaml.safe_dump(worker_cfg), encoding="utf-8")

    _bind_homes(monkeypatch, launch, worker)

    launch_resp = _get({"key": "telemetry.security"})
    assert launch_resp["result"] == {
        "shared_metrics": {
            "collection_enabled": False,
            "transmission_requested": True,
            "transmission_enabled": False,
            "destination": "blocked",
        }
    }
    assert "metrics.example.invalid" not in repr(launch_resp)
    assert "/private/path" not in repr(launch_resp)

    _reset_cfg_cache()
    worker_resp = _get({"key": "telemetry.security", "profile": "code"})
    assert worker_resp["result"] == {
        "shared_metrics": {
            "collection_enabled": True,
            "transmission_requested": True,
            "transmission_enabled": True,
            "destination": "custom_https",
        }
    }
    assert "metrics.example.internal" not in repr(worker_resp)
    assert "/v1/private" not in repr(worker_resp)


def test_telemetry_security_getter_handles_malformed_endpoint(tmp_path, monkeypatch):
    launch, worker = _homes(tmp_path)
    launch_cfg = _read_yaml(launch)
    launch_cfg["telemetry"] = {
        "shared_metrics": {
            "enabled": True,
            "send": True,
            "endpoint": "http://[broken",
        }
    }
    (launch / "config.yaml").write_text(yaml.safe_dump(launch_cfg), encoding="utf-8")
    _bind_homes(monkeypatch, launch, worker)

    resp = _get({"key": "telemetry.security"})

    assert resp["result"] == {
        "shared_metrics": {
            "collection_enabled": True,
            "transmission_requested": True,
            "transmission_enabled": False,
            "destination": "blocked",
        }
    }
