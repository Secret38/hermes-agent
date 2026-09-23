"""Central Agent OS action execution pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from .contracts import ActionRecord
from .events import EventRecord, EventType
from .execution_context import authorized_execution
from .permissions import PermissionGate, SafeDefaultPermissionGate
from .recovery.planner import RecoveryAction, RecoveryPlanner, RetryBudgetRecoveryPlanner
from .risk import ConservativeRiskClassifier, RiskClassifier, RiskLevel
from .states import ActionState
from .store import AgentOSStore
from .verification.gate import VerificationResult, Verifier


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    actual_state: dict[str, Any] = field(default_factory=dict)


class ActionExecutor(Protocol):
    def execute(self, action: ActionRecord) -> ExecutionResult: ...


class CheckpointProvider(Protocol):
    def create_checkpoint(self, action: ActionRecord) -> str | None: ...
    def rollback(self, checkpoint_id: str) -> bool: ...


class VerificationRequiredError(RuntimeError):
    pass


class AgentOSKernel:
    """Execute a durable action through risk, permission, execution and verification."""

    def __init__(
        self,
        store: AgentOSStore,
        *,
        executor: ActionExecutor,
        verifier: Verifier | None,
        risk_classifier: RiskClassifier | None = None,
        permission_gate: PermissionGate | None = None,
        recovery_planner: RecoveryPlanner | None = None,
        checkpoint_provider: CheckpointProvider | None = None,
    ):
        self.store = store
        self.executor = executor
        self.verifier = verifier
        self.risk_classifier = risk_classifier or ConservativeRiskClassifier()
        self.permission_gate = permission_gate or SafeDefaultPermissionGate()
        self.recovery_planner = recovery_planner or RetryBudgetRecoveryPlanner()
        self.checkpoint_provider = checkpoint_provider

    def execute_action(self, action_id: str) -> ActionRecord:
        action = self._require_action(action_id)
        risk = self.risk_classifier.classify(action)
        action = self.store.set_action_controls(
            action.id,
            risk_level=risk.level.value,
            permission_policy=risk.classifier,
            event_payload={"reason": risk.reason},
        )

        decision = self.permission_gate.authorize(action, risk)
        needs_gate = risk.level not in {RiskLevel.L0_OBSERVE, RiskLevel.L1_REVERSIBLE}

        # A non-blocking/web permission gate may persist WAITING_PERMISSION before
        # its human decision returns. Refresh the durable record so the kernel
        # does not emit a duplicate PLANNED -> WAITING transition afterward.
        action = self._require_action(action.id)
        if needs_gate and action.state is ActionState.PLANNED:
            action = self.store.transition_action(action.id, ActionState.WAITING_PERMISSION)

        if needs_gate:
            self.store.append_event(
                EventRecord.create(
                    task_id=action.task_id,
                    action_id=action.id,
                    type=EventType.APPROVAL_RESOLVED,
                    payload={
                        "allowed": decision.allowed,
                        "decided_by": decision.decided_by,
                        "reason": decision.reason,
                        "scope": decision.scope,
                    },
                )
            )

        if not decision.allowed:
            return self.store.transition_action(
                action.id,
                ActionState.BLOCKED,
                error=decision.reason or "permission denied",
            )

        if self.checkpoint_provider is not None and not action.checkpoint_id:
            checkpoint_id = self.checkpoint_provider.create_checkpoint(action)
            if checkpoint_id:
                action = self.store.bind_checkpoint(action.id, checkpoint_id)

        action = self.store.start_action_execution(action.id)
        attempts = action.recovery_attempts

        while True:
            execution_error: Exception | None = None
            verification: VerificationResult | None = None
            try:
                with authorized_execution(action, risk, decision):
                    result = self.executor.execute(action)
                action = self.store.transition_action(
                    action.id,
                    ActionState.OBSERVING,
                    actual_state=result.actual_state,
                )

                if not action.verification_required:
                    return self.store.transition_action(action.id, ActionState.SUCCEEDED)

                if self.verifier is None:
                    raise VerificationRequiredError(
                        "verification_required=True but no verifier is configured"
                    )

                action = self.store.transition_action(action.id, ActionState.VERIFYING)
                verification = self.verifier.verify(action, result.actual_state)
                self.store.append_event(
                    EventRecord.create(
                        task_id=action.task_id,
                        action_id=action.id,
                        type=EventType.VERIFICATION_RECORDED,
                        payload={
                            "verdict": verification.verdict.value,
                            "method": verification.method,
                            "reason": verification.reason,
                            "evidence": verification.evidence,
                        },
                    )
                )
                if verification.passed:
                    return self.store.transition_action(
                        action.id,
                        ActionState.SUCCEEDED,
                        verification_result={
                            "verdict": verification.verdict.value,
                            "method": verification.method,
                            "reason": verification.reason,
                            "evidence": verification.evidence,
                        },
                    )
            except Exception as exc:
                execution_error = exc

            recovery = self.recovery_planner.decide(
                action,
                error=execution_error,
                verification=verification,
                attempts=attempts,
            )
            attempts += 1
            action = self.store.record_recovery_attempt(
                action.id,
                decision=recovery.action.value,
                reason=recovery.reason,
                error=str(execution_error) if execution_error else None,
            )

            if recovery.action is RecoveryAction.RETRY:
                action = self.store.transition_action(action.id, ActionState.RECOVERING)
                action = self.store.start_action_execution(action.id)
                continue

            if recovery.action is RecoveryAction.ROLLBACK and self.checkpoint_provider and action.checkpoint_id:
                self.checkpoint_provider.rollback(action.checkpoint_id)

            final_state = (
                ActionState.BLOCKED
                if recovery.action in {RecoveryAction.REPLAN, RecoveryAction.ROLLBACK, RecoveryAction.ASK_USER}
                else ActionState.FAILED
            )
            return self.store.transition_action(
                action.id,
                final_state,
                error=recovery.reason if execution_error is None else str(execution_error),
                verification_result=(
                    {}
                    if verification is None
                    else {
                        "verdict": verification.verdict.value,
                        "method": verification.method,
                        "reason": verification.reason,
                        "evidence": verification.evidence,
                    }
                ),
            )

    def _require_action(self, action_id: str) -> ActionRecord:
        action = self.store.get_action(action_id)
        if action is None:
            raise KeyError(f"unknown action: {action_id}")
        return action
