from __future__ import annotations

import json
from pathlib import Path

from agent_os.agents.records import AgentInstanceRecord, AgentInstanceState
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.dashboard import build_dashboard_snapshot, dashboard_event_sequence
from agent_os.events import EventRecord, EventType
from agent_os.orchestration.plan import PlanRecord, PlanState, PlanStepKind, PlanStepRecord, PlanStepState
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore


def _health() -> dict:
    return {
        "platform": "test",
        "store_path": "test",
        "core_ready": True,
        "full_ready": True,
        "checks": [
            {
                "name": "runtime_core",
                "status": "PASS",
                "detail": "test runtime",
                "required_for_core": True,
                "required_for_full": True,
                "remediation": None,
            },
            {
                "name": "durable_store",
                "status": "PASS",
                "detail": "schema ok",
                "required_for_core": True,
                "required_for_full": True,
                "remediation": None,
            },
            {
                "name": "browser",
                "status": "PASS",
                "detail": "browser ready",
                "required_for_core": False,
                "required_for_full": True,
                "remediation": None,
            },
            {
                "name": "computer_use",
                "status": "PASS",
                "detail": "computer ready",
                "required_for_core": False,
                "required_for_full": True,
                "remediation": None,
            },
        ],
    }


def test_mission_control_snapshot_projects_durable_execution_without_secrets(tmp_path: Path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    store.initialize()

    task = store.create_task(
        TaskRecord.create(
            "Build and verify the application",
            session_id="session-1",
            workspace_id="workspace-1",
            metadata={"owner": "desktop"},
        )
    )
    store.transition_task(task.id, TaskState.PLANNING)
    store.transition_task(task.id, TaskState.READY)
    store.transition_task(task.id, TaskState.RUNNING)

    plan = PlanRecord.create(task_id=task.id, objective="Produce a verified running application")
    first = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="Build",
        kind=PlanStepKind.ACTION,
        priority=20,
    )
    verify = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="Verify",
        kind=PlanStepKind.VERIFICATION,
        priority=10,
    )
    store.create_plan(plan, [first, verify], {verify.id: [first.id]})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    store.transition_plan_step(first.id, PlanStepState.READY)
    store.transition_plan_step(first.id, PlanStepState.RUNNING)
    store.transition_plan_step(first.id, PlanStepState.SUCCEEDED)
    store.refresh_plan_readiness(plan.id)

    action = store.create_action(
        ActionRecord.create(
            task.id,
            tool="terminal",
            operation="build",
            verification_method="hermes.project",
            retry_budget=1,
        )
    )
    store.set_action_controls(action.id, risk_level="L2_CONTROLLED", permission_policy="explicit")
    store.bind_checkpoint(action.id, "checkpoint-1")
    store.start_action_execution(action.id)
    store.transition_action(action.id, ActionState.VERIFYING)
    store.transition_action(
        action.id,
        ActionState.SUCCEEDED,
        verification_result={
            "verdict": "PASS",
            "token": "must-not-leak",
            "nested": {"password": "must-not-leak-either", "evidence": "tests passed"},
        },
    )

    agent = store.create_agent(
        AgentInstanceRecord.create(
            task_id=task.id,
            runtime="hermes-subagent",
            goal="Inspect build output",
            role="verifier",
        )
    )
    store.transition_agent(agent.id, AgentInstanceState.STARTING)
    store.transition_agent(agent.id, AgentInstanceState.RUNNING)

    store.append_event(
        EventRecord.create(
            task_id=task.id,
            action_id=action.id,
            type=EventType.APPROVAL_REQUESTED,
            payload={"reason": "controlled change", "authorization": "must-not-leak"},
        )
    )
    store.record_recovery_attempt(action.id, decision="RETRY", reason="transient failure")

    snapshot = build_dashboard_snapshot(db_path=path, health_report=_health())

    assert dashboard_event_sequence(db_path=path) > 0
    assert snapshot["store_error"] is None
    assert snapshot["summary"]["tasks"] == 1
    assert snapshot["summary"]["active_tasks"] == 1
    assert snapshot["summary"]["agents"] == 1
    assert snapshot["summary"]["recoveries"] == 1
    assert snapshot["summary"]["approvals"] == 1
    assert snapshot["summary"]["checkpoints"] == 1

    projected = snapshot["tasks"][0]
    assert projected["goal"] == "Build and verify the application"
    assert projected["workspace_id"] == "workspace-1"
    assert projected["plan"]["objective"] == "Produce a verified running application"
    assert projected["plan"]["dependencies"] == [
        {"step_id": verify.id, "dependency_step_id": first.id}
    ]

    projected_action = projected["actions"][0]
    assert projected_action["verification_result"]["verdict"] == "PASS"
    assert projected_action["verification_result"]["token"] == "[redacted]"
    assert projected_action["verification_result"]["nested"]["password"] == "[redacted]"

    approval = next(event for event in projected["events"] if event["type"] == "approval.requested")
    assert approval["payload"]["authorization"] == "[redacted]"

    assert snapshot["memory"]["workspaces"][0]["id"] == "workspace-1"
    assert snapshot["memory"]["sessions"][0]["id"] == "session-1"
    assert snapshot["memory"]["checkpoints"][0]["id"] == "checkpoint-1"
    assert any(node["id"] == "browser" for node in snapshot["topology"]["nodes"])
    assert any(node["id"] == "tool:terminal" for node in snapshot["topology"]["nodes"])
    assert any(node["id"] == "runtime:hermes-subagent" for node in snapshot["topology"]["nodes"])


def test_mission_control_read_does_not_create_missing_store(tmp_path: Path):
    path = tmp_path / "does-not-exist.db"

    snapshot = build_dashboard_snapshot(db_path=path, health_report=_health())

    assert not path.exists()
    assert dashboard_event_sequence(db_path=path) == 0
    assert snapshot["tasks"] == []
    assert snapshot["summary"]["tasks"] == 0


def test_agent_os_desktop_surface_is_shipped_and_enabled_by_default():
    repo = Path(__file__).resolve().parents[2]

    plugin_source = (repo / "apps/desktop/src/plugins/agent-os/plugin.tsx").read_text(encoding="utf-8")
    manifest = json.loads((repo / "plugins/agent-os/dashboard/manifest.json").read_text(encoding="utf-8"))

    assert "defaultEnabled: true" in plugin_source
    assert "path: '/agent-os'" in plugin_source
    assert "SIDEBAR_NAV_AREA" in plugin_source
    assert "STATUSBAR_AREAS.right" in plugin_source
    assert "AgentOSMissionControl" in plugin_source

    assert manifest["name"] == "agent-os"
    assert manifest["api"] == "plugin_api.py"
    assert manifest["tab"]["path"] == "/agent-os"
