from __future__ import annotations

from pathlib import Path

from agent_os.evaluation.browser_handlers import browser_handlers
from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.integration_handlers import integration_handlers
from agent_os.evaluation.software_handlers import software_handlers
from agent_os.evaluation.windows_handlers import windows_handlers
from agent_os.evaluation.golden import (
    GoldenTaskDefinition,
    GoldenTaskOutcome,
    GoldenTaskResult,
    GoldenTaskRunner,
    load_golden_tasks,
)


def definition(task_id="GT-X"):
    return GoldenTaskDefinition(
        id=task_id,
        name="fixture",
        category="test",
        goal="prove it",
        handler="fixture",
    )


def test_missing_handler_is_not_implemented_not_skipped():
    runner = GoldenTaskRunner([definition()], handlers={})

    result = runner.run_all()[0]

    assert result.outcome is GoldenTaskOutcome.NOT_IMPLEMENTED
    assert result.verified is False


def test_unverified_pass_is_reclassified_as_false_completion():
    runner = GoldenTaskRunner(
        [definition()],
        handlers={
            "fixture": lambda task: GoldenTaskResult(
                task_id=task.id,
                outcome=GoldenTaskOutcome.PASS,
                verified=False,
            )
        },
    )

    result = runner.run_all()[0]

    assert result.outcome is GoldenTaskOutcome.FAIL
    assert result.false_completion is True


def test_summary_is_production_ready_only_when_every_task_is_verified():
    definitions = [definition("GT-A"), definition("GT-B")]
    runner = GoldenTaskRunner(
        definitions,
        handlers={
            "fixture": lambda task: GoldenTaskResult(
                task_id=task.id,
                outcome=GoldenTaskOutcome.PASS,
                verified=True,
            )
        },
    )

    summary = runner.summarize(runner.run_all())

    assert summary.success_rate == 1.0
    assert summary.verified_success_rate == 1.0
    assert summary.production_ready is True


def test_manifest_contains_all_twenty_canonical_tasks():
    manifest = (
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )
    definitions = load_golden_tasks(manifest)

    assert len(definitions) == 20
    assert [task.id for task in definitions] == [
        f"GT-{number:02d}" for number in range(1, 21)
    ]
    assert all(task.verification_required for task in definitions)


def test_all_twenty_canonical_tasks_have_registered_v1_handlers():
    manifest = (
        Path(__file__).resolve().parents[2]
        / "evals"
        / "agent_os"
        / "golden_tasks.json"
    )
    definitions = load_golden_tasks(manifest)
    handlers = {
        **control_plane_handlers(),
        **integration_handlers(),
        **software_handlers(),
        **browser_handlers(),
        **windows_handlers(),
    }

    missing = {
        definition.id: definition.handler
        for definition in definitions
        if definition.handler not in handlers
    }
    assert missing == {}
