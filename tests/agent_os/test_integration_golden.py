from __future__ import annotations

from pathlib import Path

from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.golden import GoldenTaskOutcome, GoldenTaskRunner, load_golden_tasks
from agent_os.evaluation.integration_handlers import integration_handlers
from agent_os.evaluation.software_handlers import software_handlers


_INTEGRATION_IDS = {
    "GT-01", "GT-02", "GT-03", "GT-04", "GT-05", "GT-06", "GT-07",
    "GT-08", "GT-09", "GT-14", "GT-20",
}


def manifest():
    return load_golden_tasks(
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )


def test_local_integration_golden_tasks_pass_with_verification():
    selected = [definition for definition in manifest() if definition.id in _INTEGRATION_IDS]
    runner = GoldenTaskRunner(
        selected,
        handlers={**integration_handlers(), **software_handlers()},
    )

    results = runner.run_all()

    assert {result.task_id for result in results} == _INTEGRATION_IDS
    assert all(result.outcome is GoldenTaskOutcome.PASS for result in results)
    assert all(result.verified for result in results)


def test_non_live_core_handlers_cover_sixteen_of_twenty():
    handlers = {
        **control_plane_handlers(),
        **integration_handlers(),
        **software_handlers(),
    }
    runner = GoldenTaskRunner(manifest(), handlers=handlers)

    summary = runner.summarize(runner.run_all())

    assert summary.total == 20
    assert summary.passed == 16
    assert summary.verified_passed == 16
    assert summary.not_implemented == 4
    assert summary.production_ready is False
