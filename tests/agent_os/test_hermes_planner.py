from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from agent_os.adapters.hermes_planner import (
    HermesPlanner,
    PlannerCapabilities,
    plan_response_schema,
)
from agent_os.contracts import TaskRecord
from agent_os.orchestration.plan import PlanStepKind


def response(content):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))]
    )


def valid_payload(tool="terminal"):
    return {
        "objective": "build then verify",
        "steps": [
            {
                "key": "work",
                "title": "Do work",
                "kind": "ACTION",
                "spec": {"tool": tool, "operation": "read status"},
                "depends_on": [],
                "priority": 10,
            },
            {
                "key": "verify",
                "title": "Verify",
                "kind": "VERIFICATION",
                "spec": {"tool": tool, "operation": "verify status"},
                "depends_on": ["work"],
                "priority": 0,
            },
        ],
        "metadata": {},
    }


def test_hermes_planner_uses_structured_auxiliary_call(monkeypatch):
    captured = {}

    def fake_call_llm(**kwargs):
        captured.update(kwargs)
        return response(json.dumps(valid_payload()))

    monkeypatch.setattr(
        "agent_os.adapters.hermes_planner.call_llm",
        fake_call_llm,
    )

    planner = HermesPlanner(
        PlannerCapabilities(("terminal",), ("hermes-subagent",)),
        max_tokens=1024,
    )
    proposal = planner.plan(TaskRecord.create("build it"))

    assert proposal.steps[0].kind is PlanStepKind.ACTION
    assert proposal.steps[1].kind is PlanStepKind.VERIFICATION
    fmt = captured["extra_body"]["response_format"]
    assert fmt["type"] == "json_schema"
    assert fmt["json_schema"]["strict"] is False
    assert captured["task"] == "agent_os_planner"
    assert "Allowed ACTION/VERIFICATION tools: terminal" in captured["messages"][0]["content"]


def test_hermes_planner_accepts_single_json_fence_for_degraded_routes(monkeypatch):
    fence = chr(96) * 3
    monkeypatch.setattr(
        "agent_os.adapters.hermes_planner.call_llm",
        lambda **kwargs: response(
            fence + "json\n" + json.dumps(valid_payload()) + "\n" + fence
        ),
    )

    proposal = HermesPlanner(
        PlannerCapabilities(("terminal",))
    ).plan(TaskRecord.create("build"))

    assert proposal.objective == "build then verify"


def test_hermes_planner_rejects_prose_wrapped_json(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_planner.call_llm",
        lambda **kwargs: response(
            "Here is the plan: " + json.dumps(valid_payload())
        ),
    )

    with pytest.raises(ValueError, match="invalid JSON"):
        HermesPlanner(
            PlannerCapabilities(("terminal",))
        ).plan(TaskRecord.create("build"))


def test_plan_schema_is_closed_at_plan_and_step_level():
    schema = plan_response_schema()

    assert schema["additionalProperties"] is False
    assert schema["properties"]["steps"]["items"]["additionalProperties"] is False
