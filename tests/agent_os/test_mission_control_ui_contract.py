from __future__ import annotations

from pathlib import Path


def _source(name: str) -> str:
    repo = Path(__file__).resolve().parents[2]
    return (repo / "apps" / "desktop" / "src" / "plugins" / "agent-os" / name).read_text(encoding="utf-8")


def test_mission_control_keeps_interactive_process_visualization_contract():
    page = _source("page.tsx")

    for marker in (
        "Process map",
        "Step inspector",
        "Event inspector",
        "Action inspector",
        "Needs attention",
        "All execution events",
        "Open originating session",
        "Agent topology",
        "Actions · risk · verification",
    ):
        assert marker in page

    assert "setSelectedStepId" in page
    assert "setSelectedEventId" in page
    assert "setSelectedActionId" in page
    assert "WAITING_PERMISSION" in page
    assert "verification_result" in page


def test_mission_control_keeps_semantic_memory_and_connection_visualization_contract():
    page = _source("page.tsx")
    context = _source("context.tsx")
    api = _source("api.ts")

    assert "SemanticMemorySection" in page
    assert "ExternalConnectionsSection" in page

    for marker in (
        "Semantic memory graph",
        "Hermes knowledge",
        "Connected to",
        "External connections",
        "MCP servers",
        "Memory providers",
        "Manage capabilities",
    ):
        assert marker in context

    assert "fetchAgentOSContext" in api
    assert "AGENT_OS_CONTEXT_KEY" in api


def test_mission_control_refresh_covers_live_and_slow_context():
    page = _source("page.tsx")

    assert "refetch()" in page
    assert "invalidateQueries({ queryKey: AGENT_OS_CONTEXT_KEY })" in page
    assert "Refresh Agent OS state, memory and connections" in page



def test_mission_control_keeps_new_mission_and_approval_contract():
    page = _source("page.tsx")
    control = _source("control.tsx")
    api = _source("api.ts")

    assert "MissionControlActions" in page
    assert "New mission" in control
    assert "Approval inbox" in control
    assert "Allow once" in control
    assert "Deny" in control
    assert "L0/L1 execute automatically" in control
    assert "Plan & run" in control
    assert "INTERRUPTED" in control
    assert "Resume" in control

    assert "createAgentOSMission" in api
    assert "resumeAgentOSMission" in api
    assert "resolveAgentOSApproval" in api
    assert "AGENT_OS_APPROVALS_KEY" in api
    assert "AGENT_OS_MISSIONS_KEY" in api


def test_mission_control_keeps_execution_replay_and_forensics_contract():
    plugin = _source("plugin.tsx")
    replay = _source("forensics.tsx")

    assert "/agent-os-replay" in plugin
    assert "Execution Replay" in plugin
    assert "AgentOSForensicsPage" in plugin

    for marker in (
        "Replay position",
        "Ledger timeline",
        "Ledger evidence",
        "Redacted payload",
        "Verification",
        "Recovery",
        "Risk & approvals",
        "Checkpoints",
        "Artifacts",
    ):
        assert marker in replay

    assert "type=\"range\"" in replay
    assert "replayState" in replay
    assert "verification.recorded" in replay
    assert "recovery.attempted" in replay
    assert "artifact.recorded" in replay
    assert "approval.requested" in replay


def test_mission_control_keeps_security_posture_contract():
    page = _source("page.tsx")
    security = _source("security-data.ts")

    for marker in (
        "Security & privacy",
        "Execution boundary",
        "Computer Use",
        "Shared metrics",
        "Outbound network inventory",
        "PARTIAL COVERAGE",
        "Classification only",
    ):
        assert marker in page

    assert "computer_use.security" in security
    assert "telemetry.security" in security
    assert "network.security" in security
    assert "raw endpoint" not in security.lower()


def test_mission_control_keeps_authoritative_projects_workspace_contract():
    page = _source("page.tsx")
    projects = _source("projects.tsx")
    project_data = _source("project-data.ts")
    workspace = _source("project-workspace.ts")

    assert "ProjectsView" in page
    for marker in (
        "Authoritative projects",
        "Hermes Projects",
        "Workspace roots",
        "Project workspace",
        "No path/name inference",
        "No operational tasks linked by exact project id",
    ):
        assert marker in projects

    assert "$projectTree" in project_data
    assert "fetchProjectSessions" in project_data
    assert "task.projectId === projectId" in project_data

    for marker in (
        "openHermesWorkspaceSession",
        "$workspaceCwdOwner",
        "revealDesktopPane('files')",
        "revealReview",
        "openBrowserTab",
        "revealDesktopPane('terminal')",
    ):
        assert marker in workspace


def test_mission_control_keeps_global_new_work_emergency_stop_contract():
    control = _source("control.tsx")
    control_data = _source("control-data.ts")

    for marker in (
        "Pause new work",
        "Resume new work",
        "NEW WORK PAUSED",
        "Existing in-flight work",
        "estop.data?.engaged",
    ):
        assert marker in control

    assert "system.estop.get" in control_data
    assert "system.estop.set" in control_data
    assert "audit.changed" in control_data
