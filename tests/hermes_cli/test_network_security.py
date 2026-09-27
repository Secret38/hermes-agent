from __future__ import annotations

from hermes_cli.network_security import classify_url, network_security_summary
from hermes_cli.observability.shared_metrics_send_config import telemetry_security_summary


def test_network_security_classifies_without_returning_addresses():
    config = {
        "mcp_servers": {
            "remote": {"url": "https://user:secret@example.test/path", "enabled": True},
            "local": {"url": "http://127.0.0.1:9000/private", "enabled": True},
            "proc": {"command": "private-helper", "enabled": True},
            "off": {"url": "https://disabled.example", "enabled": False},
        },
        "telemetry": {
            "shared_metrics": {
                "enabled": True,
                "send": True,
                "endpoint": "https://metrics.example.test/private",
            }
        },
    }

    result = network_security_summary(
        config,
        model="provider/model",
        runtime={"provider": "provider", "base_url": "https://api.example.test/v1"},
    )

    assert classify_url("http://localhost:8080/x") == "loopback"
    assert classify_url("https://example.test/x") == "external"
    assert result["coverage"] == "partial"
    assert result["model_provider"]["class"] == "external"
    assert result["mcp"]["configured"] == 4
    assert result["mcp"]["enabled"] == 3
    assert result["mcp"]["classes"]["external"] == 1
    assert result["mcp"]["classes"]["loopback"] == 1
    assert result["mcp"]["classes"]["process"] == 1
    assert result["mcp"]["classes"]["disabled"] == 1
    assert result["telemetry"]["class"] == "external"

    serialized = repr(result)
    for forbidden in ("example.test", "127.0.0.1", "private-helper", "user:secret", "/private"):
        assert forbidden not in serialized


def test_network_security_keeps_unobservable_surfaces_unknown():
    result = network_security_summary({}, model="", runtime={})

    assert result["browser"]["class"] == "unknown"
    assert result["computer_use"]["class"] == "unknown"
    assert result["messaging"]["class"] == "unknown"
    assert result["updates"] == {"class": "external", "mode": "on_demand"}


def test_telemetry_security_summary_is_sanitized_and_fail_closed():
    result = telemetry_security_summary(
        {
            "telemetry": {
                "shared_metrics": {
                    "enabled": True,
                    "send": True,
                    "endpoint": "http://public.example.test/not-allowed",
                }
            }
        }
    )

    shared = result["shared_metrics"]
    assert shared["collection_enabled"] is True
    assert shared["transmission_requested"] is True
    assert shared["transmission_enabled"] is False
    assert shared["destination"] == "blocked"
    assert "endpoint" not in shared
    assert "public.example.test" not in repr(result)
