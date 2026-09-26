from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from agent_os.adapters.hermes_approval import HermesApprovalGate
from agent_os.adapters.hermes_checkpoint import HermesCheckpointProvider
from agent_os.adapters.hermes_verifier import HermesProjectVerifier
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.permissions import PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.verification.gate import VerificationVerdict


def make_action(*, workspace_id=None, command=None):
    task = TaskRecord.create("adapter test")
    return ActionRecord.create(
        task.id,
        tool="terminal",
        operation="run",
        input={} if command is None else {"command": command},
        workspace_id=workspace_id,
    )


def test_approval_adapter_auto_allows_low_risk(monkeypatch):
    called = {"value": False}

    def fail_prompt(*args, **kwargs):
        called["value"] = True
        raise AssertionError("prompt should not be called")

    monkeypatch.setattr(
        "agent_os.adapters.hermes_approval.prompt_dangerous_approval",
        fail_prompt,
    )

    gate = HermesApprovalGate()
    result = gate.authorize(
        make_action(),
        RiskAssessment(RiskLevel.L0_OBSERVE, "read-only"),
    )

    assert result.outcome is PermissionOutcome.ALLOW
    assert called["value"] is False


def test_approval_adapter_maps_hermes_scope(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_approval.prompt_dangerous_approval",
        lambda *args, **kwargs: "session",
    )

    result = HermesApprovalGate().authorize(
        make_action(command="npm install"),
        RiskAssessment(RiskLevel.L2_PERSISTENT_LOCAL, "persistent local change"),
    )

    assert result.outcome is PermissionOutcome.ALLOW
    assert result.scope == "session"


class FakeCheckpointManager:
    def __init__(self):
        self.restored = None
        self.turns = 0

    def new_turn(self):
        self.turns += 1

    def ensure_checkpoint(self, working_dir, reason="auto"):
        return True

    def list_checkpoints(self, working_dir):
        return [{"hash": "abc123"}]

    def restore(self, working_dir, commit_hash, safe=False):
        self.restored = (working_dir, commit_hash, safe)
        return {"success": True}


def test_checkpoint_id_survives_provider_reconstruction(tmp_path):
    manager = FakeCheckpointManager()
    provider = HermesCheckpointProvider(manager)
    action = make_action(workspace_id=str(tmp_path))

    checkpoint_id = provider.create_checkpoint(action)

    second = HermesCheckpointProvider(manager)
    assert checkpoint_id is not None
    assert second.rollback(checkpoint_id) is True
    assert manager.restored == (str(tmp_path.resolve()), "abc123", True)


@dataclass
class FakePhase:
    phase: str = "test"
    command: str = "pytest"
    exit_code: int = 0
    timed_out: bool = False
    duration: float = 0.1
    output_tail: str = ""

    @property
    def ok(self):
        return self.exit_code == 0 and not self.timed_out


@dataclass
class FakeReadiness:
    url: str = "http://127.0.0.1:8000/"
    ready: bool = True
    status_code: int = 200
    duration: float = 0.1
    error: str | None = None
    output_tail: str = ""


@dataclass
class FakeVerifyResult:
    recipe_name: str = "fixture"
    phases: list = None
    readiness: FakeReadiness | None = None

    def __post_init__(self):
        if self.phases is None:
            self.phases = [FakePhase()]

    @property
    def ok(self):
        return all(p.ok for p in self.phases) and (
            self.readiness is None or self.readiness.ready
        )


def test_verifier_maps_hermes_result(monkeypatch, tmp_path):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_verifier.detect_recipe",
        lambda root: object(),
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_verifier.run_verify",
        lambda *args, **kwargs: FakeVerifyResult(readiness=FakeReadiness()),
    )

    result = HermesProjectVerifier().verify(
        make_action(workspace_id=str(tmp_path)),
        {"exit_code": 0},
    )

    assert result.verdict is VerificationVerdict.PASSED
    assert result.evidence["readiness"]["status_code"] == 200
