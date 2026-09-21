"""Agent OS executor/verifier adapters for Hermes terminal and process runtime."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from tools.process_registry import process_registry
from tools.terminal_tool import terminal_tool

from agent_os.contracts import ActionRecord
from agent_os.kernel import ExecutionResult
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class TerminalExecutionError(RuntimeError):
    pass


class HermesTerminalExecutor:
    """Execute Agent OS actions through Hermes terminal runtime.

    force=True is appropriate here because the Agent OS kernel has already
    passed the action through its central risk and permission gate. Hermes
    unconditional pre-exec safety guards still run; only the duplicate
    dangerous-command prompt is skipped.
    """

    def __init__(
        self,
        *,
        host_local: bool = False,
        force_after_agent_os_approval: bool = True,
    ):
        self.host_local = host_local
        self.force_after_agent_os_approval = force_after_agent_os_approval

    def execute(self, action: ActionRecord) -> ExecutionResult:
        command = self._command(action)
        payload = dict(action.input or {})
        workdir = payload.get("workdir") or action.workspace_id
        timeout = payload.get("timeout")
        if timeout is None and action.timeout_seconds is not None:
            timeout = max(1, int(action.timeout_seconds))

        raw = terminal_tool(
            command=command,
            background=bool(payload.get("background", False)),
            timeout=timeout,
            task_id=action.task_id,
            session_id=payload.get("session_id"),
            force=self.force_after_agent_os_approval,
            workdir=workdir,
            pty=bool(payload.get("pty", False)),
            notify_on_complete=bool(payload.get("notify_on_complete", False)),
            watch_patterns=payload.get("watch_patterns"),
            _host_local=self.host_local,
        )
        try:
            result = json.loads(raw)
        except Exception as exc:
            raise TerminalExecutionError(
                f"Hermes terminal returned invalid JSON: {type(exc).__name__}"
            ) from exc
        if not isinstance(result, dict):
            raise TerminalExecutionError("Hermes terminal result must be an object")

        error = result.get("error")
        exit_code = result.get("exit_code")
        status = str(result.get("status") or "").lower()
        hard_failure = bool(error) or status in {
            "error",
            "degraded",
            "approval_required",
            "pending_approval",
        }
        expected_exit = action.expected_state.get("exit_code", 0)
        if exit_code not in (None, 0) and exit_code != expected_exit:
            hard_failure = True
        if hard_failure:
            detail = error or f"terminal exit_code={exit_code} status={status or 'unknown'}"
            raise TerminalExecutionError(str(detail))

        return ExecutionResult(actual_state=result)

    @staticmethod
    def _command(action: ActionRecord) -> str:
        command = action.input.get("command") if isinstance(action.input, dict) else None
        command = command if isinstance(command, str) and command.strip() else action.operation
        command = str(command or "").strip()
        if not command:
            raise TerminalExecutionError("terminal action has no command")
        return command


@dataclass(frozen=True, slots=True)
class TerminalResultVerifier:
    """Verify a terminal result against typed expected_state assertions."""

    default_exit_code: int | None = 0

    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        expected = dict(action.expected_state or {})
        failures: list[str] = []

        expected_exit = expected.get("exit_code", self.default_exit_code)
        if expected_exit is not None and actual_state.get("exit_code") != expected_exit:
            failures.append(
                f"exit_code expected {expected_exit}, got {actual_state.get('exit_code')}"
            )

        output = str(actual_state.get("output") or "")
        contains = expected.get("output_contains")
        if isinstance(contains, str) and contains not in output:
            failures.append(f"output missing required text: {contains!r}")

        status = expected.get("status")
        if isinstance(status, str) and str(actual_state.get("status") or "") != status:
            failures.append(
                f"status expected {status!r}, got {actual_state.get('status')!r}"
            )

        if expected.get("session_id_present") and not actual_state.get("session_id"):
            failures.append("background result missing session_id")

        verdict = (
            VerificationVerdict.FAILED if failures else VerificationVerdict.PASSED
        )
        return VerificationResult(
            verdict,
            "hermes.terminal.result",
            evidence={
                "exit_code": actual_state.get("exit_code"),
                "status": actual_state.get("status"),
                "session_id": actual_state.get("session_id"),
                "output": output[-4000:],
                "assertions": expected,
            },
            reason="; ".join(failures),
        )


class HermesProcessController:
    """Small lifecycle adapter for Hermes background process sessions."""

    def poll(self, session_id: str) -> dict[str, Any]:
        return dict(process_registry.poll(str(session_id)) or {})

    def wait(self, session_id: str, *, timeout: float | None = None) -> dict[str, Any]:
        return dict(process_registry.wait(str(session_id), timeout=timeout) or {})

    def kill(self, session_id: str) -> dict[str, Any]:
        return dict(process_registry.kill_process(str(session_id)) or {})
