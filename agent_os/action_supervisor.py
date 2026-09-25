"""Fail-closed recovery for actions interrupted by process loss."""

from __future__ import annotations

from dataclasses import dataclass

import psutil

from .states import ActionState
from .store import AgentOSStore


@dataclass(frozen=True, slots=True)
class ActionReconcileItem:
    action_id: str
    before: ActionState
    after: ActionState
    owner_alive: bool
    diagnostic: str


@dataclass(frozen=True, slots=True)
class ActionReconcileReport:
    items: tuple[ActionReconcileItem, ...]

    @property
    def blocked(self) -> int:
        return sum(1 for item in self.items if item.after is ActionState.BLOCKED)


class ActionSupervisor:
    """Detect in-flight actions whose execution owner disappeared.

    Ambiguous side effects are never replayed here. They are moved through
    RECOVERING to BLOCKED so a verifier, compensating action, or user decision
    can resolve the real-world state before any retry occurs.
    """

    _IN_FLIGHT = {
        ActionState.EXECUTING,
        ActionState.OBSERVING,
        ActionState.VERIFYING,
    }

    def __init__(self, store: AgentOSStore):
        self.store = store

    def reconcile_inflight(self) -> ActionReconcileReport:
        items: list[ActionReconcileItem] = []
        for action in self.store.list_actions(states=self._IN_FLIGHT):
            alive = self._process_matches(
                action.execution_owner_pid,
                action.execution_owner_create_time,
            )
            if alive:
                items.append(
                    ActionReconcileItem(
                        action.id,
                        action.state,
                        action.state,
                        True,
                        "EXECUTION_OWNER_ALIVE",
                    )
                )
                continue

            before = action.state
            diagnostic = "AMBIGUOUS_SIDE_EFFECT_AFTER_OWNER_LOSS"
            if action.state is ActionState.VERIFYING:
                action = self.store.transition_action(
                    action.id,
                    ActionState.BLOCKED,
                    error=diagnostic,
                    payload={"reason": diagnostic},
                )
            else:
                action = self.store.transition_action(
                    action.id,
                    ActionState.RECOVERING,
                    error=diagnostic,
                    payload={"reason": diagnostic},
                )
                action = self.store.transition_action(
                    action.id,
                    ActionState.BLOCKED,
                    error=diagnostic,
                    payload={"reason": diagnostic},
                )
            items.append(
                ActionReconcileItem(
                    action.id,
                    before,
                    action.state,
                    False,
                    diagnostic,
                )
            )
        return ActionReconcileReport(tuple(items))

    @staticmethod
    def _process_matches(pid: int | None, create_time: float | None) -> bool:
        if not isinstance(pid, int) or not isinstance(create_time, (int, float)):
            return False
        try:
            observed = float(psutil.Process(pid).create_time())
        except (psutil.Error, OSError):
            return False
        return abs(observed - float(create_time)) < 0.01
