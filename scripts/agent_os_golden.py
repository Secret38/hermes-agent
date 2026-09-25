#!/usr/bin/env python3
"""Run the canonical Agent OS Golden Task manifest.

All twenty V1 handlers are registered. Live browser/computer tasks fail closed
as BLOCKED when their real runtime or native platform is unavailable, so a
successful exit is a genuine 20/20 verified production-readiness proof.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from agent_os.evaluation.browser_handlers import browser_handlers
from agent_os.evaluation.control_plane_handlers import control_plane_handlers
from agent_os.evaluation.integration_handlers import integration_handlers
from agent_os.evaluation.software_handlers import software_handlers
from agent_os.evaluation.windows_handlers import windows_handlers
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
        **browser_handlers(),
        **windows_handlers(),
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
