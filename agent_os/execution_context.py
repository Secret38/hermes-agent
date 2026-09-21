"""Scoped authorization context for one Agent OS execution."""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from dataclasses import dataclass

from .contracts import ActionRecord
from .permissions import PermissionDecision
from .risk import RiskAssessment


@dataclass(frozen=True, slots=True)
class AuthorizedExecution:
    action_id: str
    task_id: str
    tool: str
    operation: str
    risk_level: str
    permission_allowed: bool
    decided_by: str


_CURRENT_AUTHORIZATION: contextvars.ContextVar[AuthorizedExecution | None] = (
    contextvars.ContextVar("agent_os_authorized_execution", default=None)
)


@contextmanager
def authorized_execution(
    action: ActionRecord,
    risk: RiskAssessment,
    decision: PermissionDecision,
):
    authorization = AuthorizedExecution(
        action_id=action.id,
        task_id=action.task_id,
        tool=action.tool,
        operation=action.operation,
        risk_level=risk.level.value,
        permission_allowed=decision.allowed,
        decided_by=decision.decided_by,
    )
    token = _CURRENT_AUTHORIZATION.set(authorization)
    try:
        yield authorization
    finally:
        _CURRENT_AUTHORIZATION.reset(token)


def current_authorized_execution() -> AuthorizedExecution | None:
    return _CURRENT_AUTHORIZATION.get()
