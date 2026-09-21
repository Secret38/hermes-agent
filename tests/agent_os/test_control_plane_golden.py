from __future__ import annotations

from pathlib import Path

from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.golden import (
    GoldenTaskOutcome,
    GoldenTaskRunner,
    load_golden_tasks,
)


_CONTROL_IDS = {"GT-15", "GT-16", "GT-17", "GT-18", "GT-19"}


def manifest():
    return load_golden_tasks(
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )


def test_control_plane_golden_tasks_all_pass_with_verification():
    selected = [definition for definition in manifest() if definition.id in _CONTROL_IDS]
    runner = GoldenTaskRunner(selected, handlers=control_plane_handlers())

    results = runner.run_all()

    assert {result.task_id for result in results} == _CONTROL_IDS
    assert all(result.outcome is GoldenTaskOutcome.PASS for result in results)
    assert all(result.verified for result in results)
    assert not any(result.false_completion for result in results)


def test_full_manifest_remains_fail_closed_until_integration_handlers_exist():
    runner = GoldenTaskRunner(manifest(), handlers=control_plane_handlers())

    results = runner.run_all()
    summary = runner.summarize(results)

    assert summary.total == 20
    assert summary.passed == 5
    assert summary.verified_passed == 5
    assert summary.not_implemented == 15
    assert summary.production_ready is False
