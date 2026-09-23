from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from agent.conversation_loop import _run_phase


@dataclass
class _ValidVerdict:
    action: str
    failed: bool


@dataclass
class _InvalidVerdict:
    action: str
    ghost_state: bool


def test_run_phase_copies_declared_loop_state_field():
    state = SimpleNamespace(failed=False)

    def phase(agent):
        return _ValidVerdict(action="fallthrough", failed=True)

    verdict = _run_phase(phase, object(), state)

    assert verdict.failed is True
    assert state.failed is True


def test_run_phase_rejects_unknown_verdict_field():
    state = SimpleNamespace()

    def broken_phase(agent):
        return _InvalidVerdict(action="fallthrough", ghost_state=True)

    with pytest.raises(RuntimeError, match="unknown loop-state field 'ghost_state'"):
        _run_phase(broken_phase, object(), state)
