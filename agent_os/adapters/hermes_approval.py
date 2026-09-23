"""Adapter from Agent OS risk decisions to Hermes approval prompts."""

from __future__ import annotations

from collections.abc import Callable

from tools.approval_prompt import prompt_dangerous_approval

from agent_os.contracts import ActionRecord
from agent_os.permissions import PermissionDecision, PermissionOutcome
from agent_os.risk import RiskAssessment, RiskLevel


class HermesApprovalGate:
    """Use Hermes' existing approval transport/prompt semantics for Agent OS."""

    def __init__(
        self,
        *,
        approval_callback: Callable | None = None,
        timeout_seconds: int | None = None,
        allow_permanent: bool = True,
        allow_session: bool = True,
    ):
        self.approval_callback = approval_callback
        self.timeout_seconds = timeout_seconds
        self.allow_permanent = allow_permanent
        self.allow_session = allow_session

    def authorize(self, action: ActionRecord, risk: RiskAssessment) -> PermissionDecision:
        if risk.level in {RiskLevel.L0_OBSERVE, RiskLevel.L1_REVERSIBLE}:
            return PermissionDecision(
                PermissionOutcome.ALLOW,
                decided_by=type(self).__name__,
                reason=f"{risk.level.value} auto-approved",
            )

        command = self._display_target(action)
        choice = prompt_dangerous_approval(
            command,
            risk.reason,
            timeout_seconds=self.timeout_seconds,
            allow_permanent=self.allow_permanent,
            approval_callback=self.approval_callback,
            allow_session=self.allow_session,
            title=f"Agent OS approval required ({risk.level.value})",
        )
        allowed = choice in {"once", "session", "always"}
        scope = choice if allowed else "once"
        return PermissionDecision(
            PermissionOutcome.ALLOW if allowed else PermissionOutcome.DENY,
            decided_by=type(self).__name__,
            reason=f"Hermes approval result: {choice}",
            scope=scope,
        )

    @staticmethod
    def _display_target(action: ActionRecord) -> str:
        raw_command = action.input.get("command") if isinstance(action.input, dict) else None
        if isinstance(raw_command, str) and raw_command.strip():
            return raw_command.strip()
        return f"{action.tool}:{action.operation}"
