from __future__ import annotations

from pathlib import Path

import pytest

from agent_os.adapters.hermes_computer import computer_use_available
from agent_os.evaluation.golden import GoldenTaskOutcome, GoldenTaskRunner, load_golden_tasks
from agent_os.evaluation.windows_handlers import windows_handlers


pytestmark = [pytest.mark.windows_only, pytest.mark.integration]


def test_real_windows_computer_use_golden_tasks():
    assert computer_use_available(), (
        "Windows Agent OS E2E lane must provision a healthy cua-driver"
    )

    definitions = load_golden_tasks(
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )
    selected = [
        definition
        for definition in definitions
        if definition.id in {"GT-12", "GT-13"}
    ]

    results = GoldenTaskRunner(
        selected,
        handlers=windows_handlers(),
    ).run_all()

    assert {result.task_id for result in results} == {"GT-12", "GT-13"}
    assert all(
        result.outcome is GoldenTaskOutcome.PASS
        for result in results
    ), results
    assert all(result.verified for result in results)
