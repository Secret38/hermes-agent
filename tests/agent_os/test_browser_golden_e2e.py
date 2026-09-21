from __future__ import annotations

from pathlib import Path

import pytest

from agent_os.adapters.hermes_browser import browser_available
from agent_os.evaluation.browser_handlers import browser_handlers
from agent_os.evaluation.golden import GoldenTaskOutcome, GoldenTaskRunner, load_golden_tasks


pytestmark = [pytest.mark.integration, pytest.mark.live_system_guard_bypass]


def test_real_browser_golden_tasks():
    assert browser_available(), "browser E2E runner must provision the Hermes browser runtime"

    definitions = load_golden_tasks(
        Path(__file__).resolve().parents[2] / "evals" / "agent_os" / "golden_tasks.json"
    )
    selected = [definition for definition in definitions if definition.id in {"GT-10", "GT-11"}]
    results = GoldenTaskRunner(selected, handlers=browser_handlers()).run_all()

    assert {result.task_id for result in results} == {"GT-10", "GT-11"}
    assert all(result.outcome is GoldenTaskOutcome.PASS for result in results), results
    assert all(result.verified for result in results)
