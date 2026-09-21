from __future__ import annotations

from pathlib import Path

from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.golden import GoldenTaskOutcome, GoldenTaskRunner, load_golden_tasks
from agent_os.evaluation.integration_handlers import integration_handlers


_INTEGRATION_IDS = {"GT-02", "GT-03", "GT-04", "GT-14"}


def manifest():
    return load_golden_tasks(
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )


def test_local_integration_golden_tasks_pass_with_verification():
    selected = [definition for definition in manifest() if definition.id in _INTEGRATION_IDS]
    runner = GoldenTaskRunner(selected, handlers=integration_handlers())

    results = runner.run_all()

    assert {result.task_id for result in results} == _INTEGRATION_IDS
    assert all(result.outcome is GoldenTaskOutcome.PASS for result in results)
    assert all(result.verified for result in results)


def test_combined_current_golden_baseline_is_nine_of_twenty():
    handlers = {**control_plane_handlers(), **integration_handlers()}
    runner = GoldenTaskRunner(manifest(), handlers=handlers)

    summary = runner.summarize(runner.run_all())

    assert summary.total == 20
    assert summary.passed == 9
    assert summary.verified_passed == 9
    assert summary.not_implemented == 11
    assert summary.production_ready is False
