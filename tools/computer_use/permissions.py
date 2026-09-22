"""Cross-platform Computer Use readiness + macOS permission helpers. "Ready to drive" differs per platform: macOS
needs explicit TCC grants (Accessibility + Screen Recording) via cua-driver ``permissions status`` / ``permissions
grant``; Windows/Linux have no TCC toggles, so readiness == driver health. The grants attach to cua-driver's OWN
identity (``com.trycua.driver``), not Hermes, so ``grant`` launches CuaDriver via LaunchServices for correct dialog
attribution. ``cua-driver doctor --json`` is the universal signal; ``computer_use_status`` folds it with the macOS
detail into one payload for the desktop card, the ``permissions`` CLI and ``/api/tools/computer-use/status``."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from contextlib import suppress
from typing import Any, Dict, Optional

from hermes_cli._subprocess_compat import windows_hide_flags

_RUNTIME_PLATFORMS = frozenset({"darwin", "win32", "linux"})  # mirrors the toolset platform_gate
_BOOLS = ("accessibility", "screen_recording", "screen_recording_capturable")
_OK_PROBE_STATUSES = frozenset({"ok", "pass", "passed", "ready", "success"})

def _child_env() -> Dict[str, str]:
    """cua-driver child env (telemetry policy + provider secrets stripped); ``os.environ`` on import error.

    cua-driver is a third-party binary — it must never inherit provider API keys (#53503/#55709/#58889
    lineage). Each layer degrades gracefully so permission probes never break on a helper import error.
    """
    try:
        from tools.computer_use.cua_backend import sanitized_cua_driver_env
        return sanitized_cua_driver_env()
    except Exception:
        return dict(os.environ)

def _run(binary: str, *args: str, timeout: float) -> subprocess.CompletedProcess:
    return subprocess.run([binary, *args], capture_output=True, text=True, encoding='utf-8', errors='replace',
                          timeout=timeout, env=_child_env(), stdin=subprocess.DEVNULL, creationflags=windows_hide_flags())

def _json_out(binary: str, *args: str, timeout: float) -> Any:
    """Run ``binary args`` and parse stdout as JSON (``None`` on empty output)."""
    raw = (_run(binary, *args, timeout=timeout).stdout or "").strip()
    return json.loads(raw) if raw else None

def _doctor(binary: str) -> Optional[Dict[str, Any]]:
    """``cua-driver doctor --json`` → ``{ok, checks:[{label,status,message}]}`` (None on any failure)."""
    try:
        data = _json_out(binary, "doctor", "--json", timeout=12)
    except Exception:
        data = None
    if not isinstance(data, dict):
        return None
    checks = [{k: str(p.get(k, "")) for k in ("label", "status", "message")} for p in data.get("probes", []) if isinstance(p, dict)]
    return {"ok": bool(data.get("ok")), "checks": checks}

def _probe_is_ok(check: Dict[str, str]) -> bool:
    return str(check.get("status") or "").strip().lower() in _OK_PROBE_STATUSES


def _windows_process_session_id() -> Optional[int]:
    """Return this process Windows session id, or None when unavailable."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes

        session_id = ctypes.c_uint32()
        ok = ctypes.windll.kernel32.ProcessIdToSessionId(
            os.getpid(),
            ctypes.byref(session_id),
        )
        return int(session_id.value) if ok else None
    except Exception:
        return None


def _windows_interactive_context_ready(binary: str) -> bool:
    """True for a direct interactive process or an interactive Cua Driver daemon."""
    session_id = _windows_process_session_id()
    if session_id is not None and session_id > 0:
        return True
    return _windows_interactive_daemon_ready(binary)

def _windows_interactive_daemon_ready(binary: str) -> bool:
    """Whether a running Cua Driver daemon is attached to Session 1+.

    Session 0 has no interactive desktop. A caller in Session 0 may still drive
    Windows safely when it is proxying to a daemon that was launched from an
    interactive console/RDP session.
    """
    try:
        result = _run(binary, "status", timeout=5)
    except Exception:
        return False
    if result.returncode != 0:
        return False
    match = re.search(r"(?im)^\s*session:\s*(\d+)\s*$", result.stdout or "")
    return bool(match and int(match.group(1)) > 0)


def _doctor_desktop_ready(
    platform: str,
    doctor: Dict[str, Any],
    binary: str,
) -> bool:
    """Turn doctor probes into a desktop-usable readiness verdict.

    doctor.ok can remain true when Cua Driver reports environment warnings.
    Agent OS full readiness is stricter: Windows must have an interactive
    desktop (directly or through an interactive-session daemon), and Linux must
    have passing display/accessibility probes.
    """
    if not doctor.get("ok"):
        return False

    checks = list(doctor.get("checks") or [])
    if platform == "win32":
        session_checks = [
            check
            for check in checks
            if "interactive session" in str(check.get("label") or "").lower()
        ]
        if not session_checks:
            return _windows_interactive_context_ready(binary)
        if all(_probe_is_ok(check) for check in session_checks):
            return _windows_interactive_context_ready(binary)
        return _windows_interactive_daemon_ready(binary)

    if platform == "linux":
        desktop_checks = [
            check
            for check in checks
            if any(
                marker in str(check.get("label") or "").lower()
                for marker in ("interactive session", "display", "at-spi", "accessibility")
            )
        ]
        return not desktop_checks or all(_probe_is_ok(check) for check in desktop_checks)

    return True

def _mac_permissions(binary: str, out: Dict[str, Any]) -> None:
    """Fold ``cua-driver permissions status --json`` booleans (+ ``source``) into ``out``."""
    try:
        data = _json_out(binary, "permissions", "status", "--json", timeout=10)
    except subprocess.TimeoutExpired:
        out["error"] = "cua-driver permissions status timed out"
    except Exception as exc:  # spawn failure or malformed JSON
        out["error"] = f"cua-driver permissions status failed: {exc}"
    else:
        if isinstance(data, dict):
            out.update({k: data[k] for k in _BOOLS if isinstance(data.get(k), bool)})
            if isinstance(data.get("source"), dict):
                out["source"] = data["source"]

def computer_use_status(driver_cmd: Optional[str] = None) -> Dict[str, Any]:
    """OS-aware readiness for the desktop card; key order is an API payload contract. ``ready`` is the single signal the
    UI keys off: macOS = both TCC grants, elsewhere = driver health (no TCC model); ``None`` = unknown (binary missing /
    probe failed). ``can_grant`` is macOS-only."""
    from tools.computer_use.cua_backend_driver import resolve_cua_driver_cmd  # same resolver as the tool itself
    plat, binary = sys.platform, resolve_cua_driver_cmd(driver_cmd)
    out: Dict[str, Any] = {"platform": plat, "platform_supported": plat in _RUNTIME_PLATFORMS,
                           "installed": bool(binary), "version": None, "ready": None, "can_grant": plat == "darwin",
                           "checks": [], "source": None, "error": None, **{k: None for k in _BOOLS}}
    if not binary:
        return out
    with suppress(Exception):
        out["version"] = (_run(binary, "--version", timeout=5).stdout or "").strip() or None
    doctor = _doctor(binary)
    if doctor is not None:
        out["checks"] = doctor["checks"]
    if plat == "darwin":
        _mac_permissions(binary, out)
        if out["error"] is None:
            out["ready"] = out["accessibility"] is True and out["screen_recording"] is True
    elif doctor is not None:
        out["ready"] = _doctor_desktop_ready(plat, doctor, binary)
        if doctor.get("ok") and out["ready"] is False and out["error"] is None:
            out["error"] = (
                "cua-driver is installed but no interactive Windows desktop is reachable"
                if plat == "win32"
                else "cua-driver is installed but desktop accessibility/display probes are not ready"
            )
    return out

def request_permissions_grant(driver_cmd: Optional[str] = None) -> int:
    """Run ``cua-driver permissions grant`` (macOS), streaming its output. Returns the driver's exit code (0 ok), 2 if
    the binary is missing, 64 on a non-macOS platform (no TCC model to grant)."""
    if sys.platform != "darwin":
        print("Computer Use permissions are a macOS concept; nothing to grant here.")
        return 64
    from tools.computer_use.cua_backend_driver import resolve_cua_driver_cmd
    binary = resolve_cua_driver_cmd(driver_cmd)
    if not binary:
        print("cua-driver: not installed. Run: hermes computer-use install")
        return 2
    print("Requesting Accessibility + Screen Recording for CuaDriver.\n"
          "macOS will show a dialog attributed to CuaDriver (com.trycua.driver) — approve it, then return here.")
    try:
        return int(subprocess.run([binary, "permissions", "grant"], env=_child_env(), stdin=subprocess.DEVNULL).returncode)
    except KeyboardInterrupt:  # pragma: no cover - interactive
        return 130
    except Exception as exc:  # pragma: no cover - defensive
        print(f"cua-driver permissions grant failed: {exc}", file=sys.stderr)
        return 2


# ---- BEGIN PLUGIN-COMPAT (revert-scheduled; see COMPAT_MANIFEST.md) ----
# Names external plugins imported from this module before the Sep 2026 decomposition.
# Internal code MUST NOT use these (scripts/check_compat_pointers.py fails CI if it does).
# The whole block is removed by reverting the commit that added it.
from typing import List  # noqa: F401,E402
# ---- END PLUGIN-COMPAT ----
