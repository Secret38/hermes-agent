from __future__ import annotations

from dataclasses import dataclass

from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.kernel import AgentOSKernel, ExecutionResult
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel
from agent_os.states import ActionState
from agent_os.store import AgentOSStore
from agent_os.verification.gate import VerificationResult, VerificationVerdict


@dataclass
class FixedRisk:
    level: RiskLevel

    def classify(self, action):
        return RiskAssessment(self.level, "test", "FixedRisk")


@dataclass
class FixedPermission:
    allow: bool

    def authorize(self, action, risk):
        return PermissionDecision(
            PermissionOutcome.ALLOW if self.allow else PermissionOutcome.DENY,
            "test",
            "fixture decision",
        )


class SequenceExecutor:
    def __init__(self, states):
        self.states = list(states)
        self.calls = 0

    def execute(self, action):
        state = self.states[min(self.calls, len(self.states) - 1)]
        self.calls += 1
        if isinstance(state, Exception):
            raise state
        return ExecutionResult(dict(state))


class SequenceVerifier:
    def __init__(self, verdicts):
        self.verdicts = list(verdicts)
        self.calls = 0

    def verify(self, action, actual_state):
        verdict = self.verdicts[min(self.calls, len(self.verdicts) - 1)]
        self.calls += 1
        return VerificationResult(verdict, "fixture", {"actual": actual_state})


def make_action(store, *, retry_budget=0):
    task = store.create_task(TaskRecord.create("kernel test"))
    return store.create_action(
        ActionRecord.create(
            task.id,
            tool="terminal",
            operation="run tests",
            retry_budget=retry_budget,
            verification_required=True,
        )
    )


def test_verified_action_reaches_succeeded(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_action(store)
    executor = SequenceExecutor([{"exit_code": 0}])
    verifier = SequenceVerifier([VerificationVerdict.PASSED])
    kernel = AgentOSKernel(
        store,
        executor=executor,
        verifier=verifier,
        risk_classifier=FixedRisk(RiskLevel.L0_OBSERVE),
        permission_gate=FixedPermission(True),
    )

    result = kernel.execute_action(action.id)

    assert result.state is ActionState.SUCCEEDED
    assert result.verification_result["verdict"] == "PASSED"
    assert executor.calls == 1
    assert verifier.calls == 1


def test_denied_permission_never_executes(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_action(store)
    executor = SequenceExecutor([{"should_not": "run"}])
    kernel = AgentOSKernel(
        store,
        executor=executor,
        verifier=SequenceVerifier([VerificationVerdict.PASSED]),
        risk_classifier=FixedRisk(RiskLevel.L3_EXTERNAL_SIDE_EFFECT),
        permission_gate=FixedPermission(False),
    )

    result = kernel.execute_action(action.id)

    assert result.state is ActionState.BLOCKED
    assert executor.calls == 0


def test_failed_verification_retries_within_budget(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_action(store, retry_budget=1)
    executor = SequenceExecutor([{"exit_code": 0}, {"exit_code": 0}])
    verifier = SequenceVerifier([VerificationVerdict.FAILED, VerificationVerdict.PASSED])
    kernel = AgentOSKernel(
        store,
        executor=executor,
        verifier=verifier,
        risk_classifier=FixedRisk(RiskLevel.L0_OBSERVE),
        permission_gate=FixedPermission(True),
    )

    result = kernel.execute_action(action.id)

    assert result.state is ActionState.SUCCEEDED
    assert result.recovery_attempts == 1
    assert executor.calls == 2
    assert verifier.calls == 2


def test_no_verification_pass_means_no_success(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_action(store)
    kernel = AgentOSKernel(
        store,
        executor=SequenceExecutor([{"exit_code": 0}]),
        verifier=SequenceVerifier([VerificationVerdict.FAILED]),
        risk_classifier=FixedRisk(RiskLevel.L0_OBSERVE),
        permission_gate=FixedPermission(True),
    )

    result = kernel.execute_action(action.id)

    assert result.state is ActionState.FAILED
    assert result.verification_result["verdict"] == "FAILED"


def test_risk_classifier_uses_token_boundaries_not_substrings():
    from agent_os.risk import ConservativeRiskClassifier, RiskLevel

    task = TaskRecord.create("risk")
    target_arg = ActionRecord.create(
        task.id,
        tool="terminal",
        operation="install package",
        input={"command": "python -m pip install --target ./vendor ."},
    )
    read_action = ActionRecord.create(
        task.id,
        tool="terminal",
        operation="read status",
        input={"command": "git status"},
    )

    classifier = ConservativeRiskClassifier()

    assert classifier.classify(target_arg).level is RiskLevel.L2_PERSISTENT_LOCAL
    assert classifier.classify(read_action).level is RiskLevel.L0_OBSERVE


def test_retry_creates_distinct_execution_attempts(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    action = make_action(store, retry_budget=1)
    executor = SequenceExecutor([RuntimeError("first"), {"exit_code": 0}])
    verifier = SequenceVerifier([VerificationVerdict.PASSED])
    kernel = AgentOSKernel(
        store,
        executor=executor,
        verifier=verifier,
        risk_classifier=FixedRisk(RiskLevel.L0_OBSERVE),
        permission_gate=FixedPermission(True),
    )

    result = kernel.execute_action(action.id)

    assert result.state is ActionState.SUCCEEDED
    assert result.execution_attempts == 2


def test_interactive_risk_levels_distinguish_observation_navigation_and_input():
    from agent_os.risk import ConservativeRiskClassifier, RiskLevel

    task = TaskRecord.create("interactive risk")
    classifier = ConservativeRiskClassifier()

    snapshot = ActionRecord.create(task.id, tool="browser", operation="snapshot")
    navigate = ActionRecord.create(task.id, tool="browser", operation="navigate")
    click = ActionRecord.create(task.id, tool="browser", operation="click", input={"ref": "@e1"})
    capture = ActionRecord.create(task.id, tool="computer_use", operation="capture")
    desktop_click = ActionRecord.create(
        task.id,
        tool="computer_use",
        operation="click",
        input={"action": "click", "element": 1},
    )

    assert classifier.classify(snapshot).level is RiskLevel.L0_OBSERVE
    assert classifier.classify(navigate).level is RiskLevel.L1_REVERSIBLE
    assert classifier.classify(click).level is RiskLevel.L2_PERSISTENT_LOCAL
    assert classifier.classify(capture).level is RiskLevel.L0_OBSERVE
    assert classifier.classify(desktop_click).level is RiskLevel.L2_PERSISTENT_LOCAL
