from __future__ import annotations

from hermes_cli.network_security import classify_url, network_security_summary


def test_classify_url_is_coarse_and_loopback_aware():
    assert classify_url("http://127.0.0.1:11434/v1") == "loopback"
    assert classify_url("https://localhost/private") == "loopback"
    assert classify_url("https://api.example.invalid/v1") == "external"
    assert classify_url("stdio://anything") == "unknown"
    assert classify_url("") == "unknown"


def test_network_summary_never_returns_endpoint_or_command_material(monkeypatch):
    monkeypatch.setattr(
        "hermes_cli.observability.shared_metrics_send_config.telemetry_security_summary",
        lambda _cfg: {
            "shared_metrics": {
                "transmission_enabled": True,
                "destination": "custom_https",
            }
        },
    )
    cfg = {
        "mcp_servers": {
            "remote": {
                "url": "https://mcp.example.invalid/private",
                "headers": {"Authorization": "Bearer TOP-SECRET"},
            },
            "local": {"url": "http://127.0.0.1:7777"},
            "stdio": {"command": "python", "args": ["secret-helper.py"]},
            "off": {"enabled": False, "url": "https://off.example.invalid"},
        }
    }
    result = network_security_summary(
        cfg,
        model="provider/model",
        runtime={
            "provider": "custom",
            "base_url": "https://models.example.invalid/v1",
            "api_key": "MODEL-SECRET",
        },
    )

    assert result["model_provider"]["class"] == "external"
    assert result["mcp"]["classes"]["external"] == 1
    assert result["mcp"]["classes"]["loopback"] == 1
    assert result["mcp"]["classes"]["process"] == 1
    assert result["mcp"]["classes"]["disabled"] == 1
    assert result["mcp"]["subprocess_may_egress"] is True
    assert result["browser"]["class"] == "unknown"

    rendered = repr(result)
    for forbidden in (
        "mcp.example.invalid",
        "127.0.0.1:7777",
        "secret-helper.py",
        "TOP-SECRET",
        "models.example.invalid",
        "MODEL-SECRET",
        "off.example.invalid",
    ):
        assert forbidden not in rendered
