"""Adapter from Agent OS verification to Hermes project verification."""

from __future__ import annotations

from pathlib import Path

from agent.verify.recipes import detect_recipe
from agent.verify.runner import run_verify

from agent_os.contracts import ActionRecord
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class HermesProjectVerifier:
    """Run Hermes' canonical project recipe against an action workspace."""

    def __init__(
        self,
        *,
        phases: tuple[str, ...] | None = None,
        phase_timeout: float = 300.0,
        ready_timeout: float = 30.0,
        skip_start: bool = False,
    ):
        self.phases = phases
        self.phase_timeout = phase_timeout
        self.ready_timeout = ready_timeout
        self.skip_start = skip_start

    def verify(self, action: ActionRecord, actual_state: dict) -> VerificationResult:
        workspace = (action.workspace_id or "").strip()
        if not workspace:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "hermes.verify",
                reason="action has no workspace_id",
            )

        root = Path(workspace).expanduser().resolve()
        recipe = detect_recipe(root)
        if recipe is None:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "hermes.verify",
                evidence={"workspace": str(root)},
                reason="Hermes could not detect a verification recipe",
            )

        result = run_verify(
            root,
            recipe,
            phases=self.phases,
            phase_timeout=self.phase_timeout,
            ready_timeout=self.ready_timeout,
            skip_start=self.skip_start,
        )
        evidence = {
            "workspace": str(root),
            "recipe": result.recipe_name,
            "phases": [
                {
                    "phase": phase.phase,
                    "command": phase.command,
                    "exit_code": phase.exit_code,
                    "timed_out": phase.timed_out,
                    "duration": phase.duration,
                    "output_tail": phase.output_tail,
                }
                for phase in result.phases
            ],
            "readiness": (
                None
                if result.readiness is None
                else {
                    "url": result.readiness.url,
                    "ready": result.readiness.ready,
                    "status_code": result.readiness.status_code,
                    "duration": result.readiness.duration,
                    "error": result.readiness.error,
                    "output_tail": result.readiness.output_tail,
                }
            ),
            "actual_state": dict(actual_state),
        }
        return VerificationResult(
            VerificationVerdict.PASSED if result.ok else VerificationVerdict.FAILED,
            "hermes.verify",
            evidence=evidence,
            reason="" if result.ok else "Hermes verification recipe failed",
        )
