from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
INSTALL = ROOT / "scripts" / "install.ps1"


def source() -> str:
    return INSTALL.read_text(encoding="utf-8-sig")


def test_agent_os_runtime_stage_is_desktop_installer_only():
    text = source()

    desktop_guard = text.index("if ($IncludeDesktop) {", text.index('$InstallStages += @('))
    agent_stage = text.index('Name = "agent-os-runtime"')
    marker_stage = text.index('Name = "bootstrap-marker"')

    assert desktop_guard < agent_stage < marker_stage
    assert 'Worker = "Stage-AgentOSRuntime"' in text


def test_agent_os_runtime_stage_verifies_full_health_before_bootstrap_marker():
    text = source()
    worker = text.index("function Stage-AgentOSRuntime")
    marker_worker = text.index("function Stage-BootstrapMarker", worker)
    body = text[worker:marker_worker]

    assert "agent-os provision" in body
    assert "agent-os status --require-full --json" in body
    assert "full_ready" in body
    assert body.index("agent-os provision") < body.index("agent-os status --require-full --json")


def test_agent_os_stage_captures_child_output_to_preserve_json_stage_protocol():
    body = source().split("function Stage-AgentOSRuntime", 1)[1].split(
        "function Stage-BootstrapMarker", 1
    )[0]

    assert "$provisionOutput = @(" in body
    assert "$healthOutput = @(" in body
    assert "ConvertFrom-Json" in body
