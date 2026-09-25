"""Agent OS adapter for Hermes browser automation."""

from __future__ import annotations

import json
from typing import Any

from tools import browser_tool
from tools import browser_tool_install
from tools.browser_tool_lifecycle import cleanup_browser

from agent_os.contracts import ActionRecord
from agent_os.kernel import ExecutionResult
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class BrowserExecutionError(RuntimeError):
    pass


def browser_available() -> bool:
    """Return readiness for the concrete browser runtime Agent OS executes.

    Agent OS calls Hermes' built-in typed browser functions directly. Normal Hermes tool
    exposure may select Browser Use instead; that UI/backend choice must not make the
    separately provisioned Agent OS runtime appear unavailable.
    """
    try:
        return bool(browser_tool_install.check_builtin_browser_requirements())
    except Exception:
        return False


class HermesBrowserExecutor:
    """Execute typed Agent OS browser actions through Hermes browser sessions."""

    def execute(self, action: ActionRecord) -> ExecutionResult:
        payload = dict(action.input or {})
        operation = action.operation.strip().lower().replace("browser_", "")

        if operation in {"navigate", "open"}:
            raw = browser_tool.browser_navigate(
                str(payload.get("url") or ""),
                task_id=action.task_id,
            )
        elif operation == "snapshot":
            raw = browser_tool.browser_snapshot(
                full=bool(payload.get("full", False)),
                task_id=action.task_id,
            )
        elif operation == "click":
            raw = browser_tool.browser_click(
                str(payload.get("ref") or ""),
                task_id=action.task_id,
            )
        elif operation in {"type", "fill"}:
            raw = browser_tool.browser_type(
                str(payload.get("ref") or ""),
                str(payload.get("text") or ""),
                task_id=action.task_id,
            )
        elif operation == "scroll":
            raw = browser_tool.browser_scroll(
                str(payload.get("direction") or "down"),
                task_id=action.task_id,
            )
        elif operation == "back":
            raw = browser_tool.browser_back(task_id=action.task_id)
        elif operation in {"press", "key"}:
            raw = browser_tool.browser_press(
                str(payload.get("key") or ""),
                task_id=action.task_id,
            )
        else:
            raise BrowserExecutionError(
                f"unsupported Hermes browser operation: {action.operation}"
            )

        result = self._normalize(raw)
        if result.get("error") or result.get("success") is False:
            raise BrowserExecutionError(
                str(result.get("error") or "Hermes browser operation failed")
            )
        return ExecutionResult(actual_state=result)

    @staticmethod
    def _normalize(raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict):
            if raw.get("_multimodal"):
                return {
                    "success": True,
                    "text_summary": str(raw.get("text_summary") or ""),
                    "meta": dict(raw.get("meta") or {}),
                }
            return dict(raw)
        if not isinstance(raw, str):
            raise BrowserExecutionError("Hermes browser returned unsupported result type")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise BrowserExecutionError("Hermes browser returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise BrowserExecutionError("Hermes browser result must be an object")
        return parsed

    @staticmethod
    def cleanup(task_id: str) -> None:
        cleanup_browser(task_id)


class HermesBrowserVerifier:
    """Verify browser actions against a fresh accessibility snapshot."""

    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        expected = dict(action.expected_state or {})
        failures: list[str] = []
        assertions = 0

        if "success" in expected:
            assertions += 1
            if bool(actual_state.get("success")) is not bool(expected["success"]):
                failures.append("browser success flag did not match expected state")

        url_contains = expected.get("url_contains")
        if isinstance(url_contains, str):
            assertions += 1
            if url_contains not in str(actual_state.get("url") or ""):
                failures.append(f"browser URL missing required text: {url_contains!r}")

        title_contains = expected.get("title_contains")
        if isinstance(title_contains, str):
            assertions += 1
            if title_contains not in str(actual_state.get("title") or ""):
                failures.append(f"browser title missing required text: {title_contains!r}")

        try:
            snapshot = HermesBrowserExecutor._normalize(
                browser_tool.browser_snapshot(
                    full=bool(expected.get("full_snapshot", False)),
                    task_id=action.task_id,
                )
            )
        except Exception as exc:
            return VerificationResult(
                VerificationVerdict.FAILED,
                "hermes.browser.fresh-snapshot",
                evidence={"actual_state": dict(actual_state)},
                reason=f"fresh browser snapshot failed: {type(exc).__name__}: {exc}",
            )

        if snapshot.get("error") or snapshot.get("success") is False:
            return VerificationResult(
                VerificationVerdict.FAILED,
                "hermes.browser.fresh-snapshot",
                evidence={"actual_state": dict(actual_state)},
                reason=str(snapshot.get("error") or "fresh browser snapshot failed"),
            )

        snapshot_text = str(snapshot.get("snapshot") or snapshot.get("text_summary") or "")
        contains = expected.get("snapshot_contains")
        if isinstance(contains, str):
            contains = [contains]
        if isinstance(contains, (list, tuple)):
            assertions += len(contains)
            for item in contains:
                if str(item) not in snapshot_text:
                    failures.append(f"fresh snapshot missing required text: {str(item)!r}")

        absent = expected.get("snapshot_not_contains")
        if isinstance(absent, str):
            absent = [absent]
        if isinstance(absent, (list, tuple)):
            assertions += len(absent)
            for item in absent:
                if str(item) in snapshot_text:
                    failures.append(f"fresh snapshot still contains forbidden text: {str(item)!r}")

        minimum = expected.get("element_count_at_least")
        if isinstance(minimum, int):
            assertions += 1
            if int(snapshot.get("element_count") or 0) < minimum:
                failures.append(
                    f"fresh snapshot element count below expected minimum {minimum}"
                )

        if assertions == 0:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "hermes.browser.fresh-snapshot",
                evidence={
                    "snapshot_element_count": snapshot.get("element_count"),
                    "snapshot_tail": snapshot_text[-4000:],
                },
                reason="browser verification requires at least one explicit expected-state assertion",
            )

        return VerificationResult(
            VerificationVerdict.FAILED if failures else VerificationVerdict.PASSED,
            "hermes.browser.fresh-snapshot",
            evidence={
                "url": actual_state.get("url"),
                "title": actual_state.get("title"),
                "snapshot_element_count": snapshot.get("element_count"),
                "snapshot_tail": snapshot_text[-4000:],
            },
            reason="; ".join(failures),
        )
