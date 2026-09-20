"""Sanitized outbound-network posture for Hermes operator surfaces.

This module is classification-only:
- it performs no network probes,
- returns no endpoint/host/path/header/secret/command values,
- distinguishes subprocess transport from proven offline execution,
- keeps dynamic/user-directed surfaces UNKNOWN instead of guessing.

Hermes OS consumes this through the profile-scoped config.get network.security
RPC. The source of truth remains Hermes config/runtime resolution.
"""

from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlparse


_NETWORK_CLASSES = frozenset({"disabled", "external", "loopback", "process", "unknown"})


def _is_loopback_host(hostname: str | None) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    if host == "localhost" or host.endswith(".localhost"):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def classify_url(raw: object) -> str:
    """Return a coarse network class without preserving address material."""
    text = str(raw or "").strip()
    if not text:
        return "unknown"
    try:
        parsed = urlparse(text)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            return "unknown"
        return "loopback" if _is_loopback_host(parsed.hostname) else "external"
    except (TypeError, ValueError):
        return "unknown"


def _model_provider_summary(model: object, runtime: object) -> dict[str, Any]:
    data = runtime if isinstance(runtime, dict) else {}
    provider = str(data.get("provider") or "unknown").strip() or "unknown"
    if data.get("command"):
        network_class = "process"
    else:
        network_class = classify_url(data.get("base_url"))
    return {
        "class": network_class,
        "provider": provider,
        "model_configured": bool(str(model or "").strip()),
        "coverage": "effective_startup_route",
        "subprocess_may_egress": network_class == "process",
    }


def _mcp_summary(config: dict[str, Any]) -> dict[str, Any]:
    raw_servers = config.get("mcp_servers")
    servers = raw_servers if isinstance(raw_servers, dict) else {}
    counts = {key: 0 for key in sorted(_NETWORK_CLASSES)}
    enabled = 0

    for raw in servers.values():
        server = raw if isinstance(raw, dict) else {}
        if server.get("enabled") is False:
            counts["disabled"] += 1
            continue

        enabled += 1
        if str(server.get("command") or "").strip():
            counts["process"] += 1
        elif str(server.get("url") or "").strip():
            counts[classify_url(server.get("url"))] += 1
        else:
            counts["unknown"] += 1

    return {
        "configured": len(servers),
        "enabled": enabled,
        "classes": counts,
        "subprocess_may_egress": counts["process"] > 0,
    }


def _telemetry_summary(config: dict[str, Any]) -> dict[str, Any]:
    from hermes_cli.observability.shared_metrics_send_config import telemetry_security_summary

    shared = (telemetry_security_summary(config).get("shared_metrics") or {})
    destination = shared.get("destination")
    if not shared.get("transmission_enabled"):
        network_class = "disabled"
    elif destination == "loopback":
        network_class = "loopback"
    elif destination in {"nous", "custom_https"}:
        network_class = "external"
    else:
        network_class = "unknown"
    return {
        "class": network_class,
        "transmission_enabled": bool(shared.get("transmission_enabled")),
    }


def network_security_summary(
    config: object,
    *,
    model: object = None,
    runtime: object = None,
) -> dict[str, Any]:
    """Return a narrow, sanitized egress inventory for operator UI.

    UNKNOWN is a first-class answer. Browser destinations are user-directed,
    Computer Use can drive apps with their own networking, and messaging can be
    supplied by adapters/plugins. Until those subsystems publish a narrower
    runtime authority, claiming local/external would be speculation.
    """
    cfg = config if isinstance(config, dict) else {}
    return {
        "coverage": "partial",
        "model_provider": _model_provider_summary(model, runtime),
        "mcp": _mcp_summary(cfg),
        "telemetry": _telemetry_summary(cfg),
        "browser": {
            "class": "unknown",
            "reason": "user_directed_destinations",
        },
        "computer_use": {
            "class": "unknown",
            "reason": "controlled_app_egress_not_observable",
        },
        "messaging": {
            "class": "unknown",
            "reason": "no_narrow_runtime_authority",
        },
        "updates": {
            "class": "external",
            "mode": "on_demand",
        },
    }
