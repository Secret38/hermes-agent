"""Agent OS adapter for Hermes computer-use runtime."""

from __future__ import annotations

import json
from typing import Any

from tools.computer_use.permissions import computer_use_status
from tools.computer_use.tool import (
    handle_computer_use,
    release_computer_use_session,
)

from agent_os.contracts import ActionRecord
from agent_os.execution_context import current_authorized_execution
from agent_os.kernel import ExecutionResult
from agent_os.live_frames import live_runtime_frames
from agent_os.store import AgentOSStore
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class ComputerUseExecutionError(RuntimeError):
    pass


def _origin_session_id(task_id: str) -> str:
    """Resolve durable task ownership without changing CUA backend isolation."""
    try:
        task = AgentOSStore().get_task(task_id)
    except Exception:
        task = None
    return str(task.session_id or task_id) if task is not None else task_id


def computer_use_available() -> bool:
    """Return true only when the installed CUA runtime is actually healthy."""
    try:
        return bool(computer_use_status().get("ready") is True)
    except Exception:
        return False


class HermesComputerUseExecutor:
    """Execute Agent OS desktop actions through Hermes computer_use."""

    def execute(self, action: ActionRecord) -> ExecutionResult:
        payload = dict(action.input or {})
        operation = str(payload.get("action") or action.operation).strip().lower()
        if not operation:
            raise ComputerUseExecutionError("computer_use action is missing")
        payload["action"] = operation

        def bridge_approval(command, description, **kwargs):
            authorization = current_authorized_execution()
            if (
                authorization is not None
                and authorization.action_id == action.id
                and authorization.task_id == action.task_id
                and authorization.tool == action.tool
                and authorization.permission_allowed
            ):
                return "once"
            return "deny"

        computer_session_id = action.task_id
        origin_session_id = _origin_session_id(action.task_id)

        def bridge_capture(*, mime_type, image_b64, width=None, height=None):
            live_runtime_frames.publish_image(
                task_id=action.task_id,
                session_id=origin_session_id,
                action_id=action.id,
                mime_type=mime_type,
                image_b64=image_b64,
                width=width,
                height=height,
            )

        raw = handle_computer_use(
            payload,
            task_id=action.task_id,
            session_id=computer_session_id,
            approval_callback=bridge_approval,
            capture_callback=bridge_capture,
        )
        # Compatibility fallback for older/mocked computer_use implementations
        # that return a multimodal envelope but do not invoke capture_callback.
        live_runtime_frames.publish_multimodal(
            task_id=action.task_id,
            session_id=origin_session_id,
            action_id=action.id,
            raw=raw,
        )
        result = self._normalize(raw)
        if result.get("error") or result.get("ok") is False:
            raise ComputerUseExecutionError(
                str(result.get("error") or result.get("message") or "computer_use failed")
            )
        return ExecutionResult(actual_state=result)

    @staticmethod
    def _normalize(raw: Any) -> dict[str, Any]:
        if isinstance(raw, dict):
            if raw.get("_multimodal"):
                result = {
                    "multimodal": True,
                    "text_summary": str(raw.get("text_summary") or ""),
                    "meta": dict(raw.get("meta") or {}),
                }
                if isinstance(raw.get("action_result"), dict):
                    result.update(raw["action_result"])
                return result
            return dict(raw)
        if not isinstance(raw, str):
            raise ComputerUseExecutionError("computer_use returned unsupported result type")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ComputerUseExecutionError("computer_use returned invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise ComputerUseExecutionError("computer_use result must be an object")
        return parsed

    @staticmethod
    def cleanup(task_id: str) -> bool:
        live_runtime_frames.clear_task(task_id)
        return bool(release_computer_use_session(task_id))


class HermesComputerUseVerifier:
    """Verify desktop state with fresh computer-use observations."""

    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        expected = dict(action.expected_state or {})
        failures: list[str] = []
        assertions = 0
        fresh: dict[str, Any] = {}

        if expected.get("effect_confirmed"):
            assertions += 1
            verdict = actual_state.get("verdict")
            confirmed = (
                actual_state.get("verified") is True
                or actual_state.get("effect") == "confirmed"
                or (
                    isinstance(verdict, dict)
                    and verdict.get("decision") == "done"
                )
            )
            if not confirmed:
                failures.append("desktop action effect was not confirmed")

        app_present = expected.get("app_present")
        if isinstance(app_present, str):
            assertions += 1
            fresh["apps"] = self._observe(action, {"action": "list_apps"})
            apps = fresh["apps"].get("apps") or []
            needle = app_present.lower()
            if not any(
                needle in json.dumps(item, ensure_ascii=False).lower()
                for item in apps
            ):
                failures.append(f"running app not observed: {app_present!r}")

        window_present = expected.get("window_present")
        if isinstance(window_present, str):
            assertions += 1
            fresh["windows"] = self._observe(action, {"action": "list_windows"})
            windows = fresh["windows"].get("windows") or []
            needle = window_present.lower()
            if not any(
                needle in json.dumps(item, ensure_ascii=False).lower()
                for item in windows
            ):
                failures.append(f"window not observed: {window_present!r}")

        capture_contains = expected.get("capture_contains")
        if isinstance(capture_contains, str):
            capture_contains = [capture_contains]
        if isinstance(capture_contains, (list, tuple)):
            assertions += len(capture_contains)
            args = {
                "action": "capture",
                "mode": str(expected.get("capture_mode") or "ax"),
            }
            capture_app = expected.get("capture_app")
            if isinstance(capture_app, str) and capture_app:
                args["app"] = capture_app
            fresh["capture"] = self._observe(action, args)
            capture_text = json.dumps(
                fresh["capture"],
                ensure_ascii=False,
                sort_keys=True,
            )
            for item in capture_contains:
                if str(item) not in capture_text:
                    failures.append(
                        f"fresh desktop capture missing required text: {str(item)!r}"
                    )

        if assertions == 0:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "hermes.computer-use.fresh-state",
                evidence={"actual_state": dict(actual_state)},
                reason="computer-use verification requires explicit expected-state assertions",
            )

        return VerificationResult(
            VerificationVerdict.FAILED if failures else VerificationVerdict.PASSED,
            "hermes.computer-use.fresh-state",
            evidence={
                "actual_state": dict(actual_state),
                "fresh_state": fresh,
            },
            reason="; ".join(failures),
        )

    @staticmethod
    def _observe(action: ActionRecord, args: dict[str, Any]) -> dict[str, Any]:
        raw = handle_computer_use(
            args,
            task_id=action.task_id,
            session_id=action.task_id,
        )
        result = HermesComputerUseExecutor._normalize(raw)
        if result.get("error") or result.get("ok") is False:
            raise ComputerUseExecutionError(
                str(result.get("error") or result.get("message") or "fresh observation failed")
            )
        return result
