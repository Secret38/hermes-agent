#!/usr/bin/env python3
"""Inspect or run the Agent OS Golden Task manifest.

Handlers are intentionally not auto-invented. Until an end-to-end handler is
registered for a task, it reports NOT_IMPLEMENTED and the production gate stays
red.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.integration_handlers import integration_handlers
from agent_os.evaluation.software_handlers import software_handlers
from agent_os.evaluation.golden import GoldenTaskRunner, load_golden_tasks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--manifest",
        default=str(
            Path(__file__).resolve().parents[1]
            / "evals"
            / "agent_os"
            / "golden_tasks.json"
        ),
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    definitions = load_golden_tasks(args.manifest)
    handlers = {
        **control_plane_handlers(),
        **integration_handlers(),
        **software_handlers(),
    }
    runner = GoldenTaskRunner(definitions, handlers=handlers)
    results = runner.run_all()
    summary = runner.summarize(results)

    if args.json:
        print(json.dumps({
            "summary": summary.to_dict(),
            "results": [
                {
                    "task_id": result.task_id,
                    "outcome": result.outcome.value,
                    "verified": result.verified,
                    "error": result.error,
                }
                for result in results
            ],
        }, indent=2))
    else:
        for result in results:
            print(f"{result.task_id}: {result.outcome.value}")
        print(
            f"verified={summary.verified_passed}/{summary.total} "
            f"production_ready={summary.production_ready}"
        )

    return 0 if summary.production_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
