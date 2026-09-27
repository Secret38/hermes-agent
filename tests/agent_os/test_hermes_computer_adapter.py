from __future__ import annotations

import base64
import json
from types import SimpleNamespace

import pytest

from agent_os.adapters.hermes_computer import (
    ComputerUseExecutionError,
    HermesComputerUseExecutor,
    HermesComputerUseVerifier,
)
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.execution_context import authorized_execution
from agent_os.live_frames import live_runtime_frames
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.verification.gate import VerificationVerdict


def action(operation, payload=None, expected=None):
    task = TaskRecord.create("computer")
    return ActionRecord.create(
        task.id,
        tool="computer_use",
        operation=operation,
        input=payload or {},
        expected_state=expected or {},
    )


def test_executor_bridges_only_current_agent_os_approval(monkeypatch):
    seen = {}

    def fake_handle(args, **kwargs):
        seen["approval"] = kwargs["approval_callback"]("cmd", "desc")
        return json.dumps(
            {
                "ok": True,
                "action": "click",
                "verified": True,
                "verdict": {"decision": "done"},
            }
        )

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )
    current = action("click", {"action": "click", "element": 1})
    risk = RiskAssessment(RiskLevel.L2_PERSISTENT_LOCAL, "test")
    decision = PermissionDecision(PermissionOutcome.ALLOW, decided_by="test")

    with authorized_execution(current, risk, decision):
        result = HermesComputerUseExecutor().execute(current)

    assert seen["approval"] == "once"
    assert result.actual_state["verified"] is True


def test_executor_denies_bridge_outside_authorized_scope(monkeypatch):
    def fake_handle(args, **kwargs):
        choice = kwargs["approval_callback"]("cmd", "desc")
        return json.dumps({"error": f"approval={choice}"})

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )

    with pytest.raises(ComputerUseExecutionError, match="approval=deny"):
        HermesComputerUseExecutor().execute(action("click"))


def test_verifier_checks_fresh_app_listing(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        lambda args, **kwargs: json.dumps(
            {
                "apps": [{"name": "Notepad", "pid": 42}],
                "count": 1,
            }
        ),
    )

    result = HermesComputerUseVerifier().verify(
        action("list_apps", expected={"app_present": "Notepad"}),
        {"apps": []},
    )

    assert result.verdict is VerificationVerdict.PASSED


def test_computer_use_availability_requires_healthy_driver(monkeypatch):
    from agent_os.adapters.hermes_computer import computer_use_available

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.computer_use_status",
        lambda: {"installed": True, "ready": False},
    )
    assert computer_use_available() is False

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.computer_use_status",
        lambda: {"installed": True, "ready": True},
    )
    assert computer_use_available() is True


def test_executor_publishes_ephemeral_frame_without_persisting_pixels(monkeypatch):
    current = action("click", {"action": "click", "element": 1})
    encoded = base64.b64encode(b"frame").decode("ascii")

    def fake_handle(args, **kwargs):
        return {
            "_multimodal": True,
            "content": [
                {"type": "text", "text": "capture"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{encoded}"},
                },
            ],
            "text_summary": "capture",
            "meta": {"width": 640, "height": 480},
            "action_result": {
                "ok": True,
                "action": "click",
                "verified": True,
                "verdict": {"decision": "done"},
            },
        }

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )
    live_runtime_frames.clear()
    risk = RiskAssessment(RiskLevel.L2_PERSISTENT_LOCAL, "test")
    decision = PermissionDecision(PermissionOutcome.ALLOW, decided_by="test")

    with authorized_execution(current, risk, decision):
        result = HermesComputerUseExecutor().execute(current)

    frame = live_runtime_frames.latest(current.task_id)
    assert frame is not None
    assert frame.action_id == current.id
    assert frame.image_b64 == encoded
    assert result.actual_state["multimodal"] is True
    assert "content" not in result.actual_state
    assert "image_b64" not in result.actual_state
    assert encoded not in json.dumps(result.actual_state)


def test_cleanup_removes_ephemeral_frame(monkeypatch):
    current = action("capture")
    encoded = base64.b64encode(b"frame").decode("ascii")
    live_runtime_frames.clear()
    live_runtime_frames.publish_multimodal(
        task_id=current.task_id,
        session_id=current.task_id,
        action_id=current.id,
        raw={
            "_multimodal": True,
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{encoded}"},
                }
            ],
        },
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.release_computer_use_session",
        lambda task_id: True,
    )

    assert HermesComputerUseExecutor.cleanup(current.task_id) is True
    assert live_runtime_frames.latest(current.task_id) is None


def test_executor_binds_live_frame_to_origin_session(monkeypatch):
    current = action("capture")
    encoded = base64.b64encode(b"frame").decode("ascii")
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.AgentOSStore",
        lambda: SimpleNamespace(
            get_task=lambda task_id: SimpleNamespace(session_id="origin-session")
        ),
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        lambda args, **kwargs: {
            "_multimodal": True,
            "content": [
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{encoded}"},
                }
            ],
            "text_summary": "capture",
            "meta": {"width": 640, "height": 480},
            "action_result": {"ok": True, "action": "capture"},
        },
    )
    live_runtime_frames.clear()

    result = HermesComputerUseExecutor().execute(current)

    frame = live_runtime_frames.latest(
        current.task_id,
        session_id="origin-session",
    )
    assert frame is not None
    assert frame.session_id == "origin-session"
    assert "image_b64" not in result.actual_state



def test_executor_capture_callback_survives_text_only_result(monkeypatch):
    current = action("capture")
    encoded = base64.b64encode(b"frame").decode("ascii")
    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.AgentOSStore",
        lambda: SimpleNamespace(
            get_task=lambda task_id: SimpleNamespace(session_id="origin-session")
        ),
    )

    def fake_handle(args, **kwargs):
        kwargs["capture_callback"](
            mime_type="image/png",
            image_b64=encoded,
            width=800,
            height=600,
        )
        return json.dumps(
            {
                "ok": True,
                "action": "capture",
                "vision_analysis": "text-only routed result",
            }
        )

    monkeypatch.setattr(
        "agent_os.adapters.hermes_computer.handle_computer_use",
        fake_handle,
    )
    live_runtime_frames.clear()

    result = HermesComputerUseExecutor().execute(current)

    frame = live_runtime_frames.latest(
        current.task_id,
        session_id="origin-session",
    )
    assert frame is not None
    assert frame.image_b64 == encoded
    assert frame.width == 800
    assert result.actual_state["vision_analysis"] == "text-only routed result"
    assert "image_b64" not in result.actual_state
