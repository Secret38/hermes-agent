"""Agent OS executor adapter for Hermes file tools."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from tools.file_tools import _get_file_ops, read_file_tool, write_file_tool
from tools.file_tools_paths import _resolve_path_for_task

from agent_os.contracts import ActionRecord
from agent_os.kernel import ExecutionResult
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class FileExecutionError(RuntimeError):
    pass


class HermesFileExecutor:
    """Execute read/write file actions through Hermes file safety layers."""

    def execute(self, action: ActionRecord) -> ExecutionResult:
        payload = dict(action.input or {})
        operation = action.operation.strip().lower()

        if operation in {"write", "write_file"}:
            path = str(payload.get("path") or "").strip()
            if not path:
                raise FileExecutionError("write_file action requires input.path")
            if "content" not in payload:
                raise FileExecutionError("write_file action requires input.content")
            raw = write_file_tool(
                path,
                str(payload.get("content") or ""),
                task_id=action.task_id,
                session_id=payload.get("session_id"),
            )
        elif operation in {"read", "read_file"}:
            path = str(payload.get("path") or "").strip()
            if not path:
                raise FileExecutionError("read_file action requires input.path")
            raw = read_file_tool(
                path,
                offset=int(payload.get("offset", 1)),
                limit=int(payload.get("limit", 200)),
                task_id=action.task_id,
            )
        else:
            raise FileExecutionError(f"unsupported Hermes file operation: {action.operation}")

        try:
            result = json.loads(raw)
        except Exception as exc:
            raise FileExecutionError(
                f"Hermes file tool returned invalid JSON: {type(exc).__name__}"
            ) from exc
        if not isinstance(result, dict):
            raise FileExecutionError("Hermes file result must be an object")
        if result.get("error") or result.get("success") is False:
            raise FileExecutionError(str(result.get("error") or "Hermes file operation failed"))
        return ExecutionResult(actual_state=result)



class HermesFileVerifier:
    """Verify file state through the same Hermes backend used for execution."""

    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        payload = dict(action.input or {})
        path = str(payload.get("path") or "").strip()
        if not path:
            return VerificationResult(
                VerificationVerdict.BLOCKED,
                "hermes.file.raw-read",
                reason="file action has no input.path",
            )

        try:
            resolved = str(_resolve_path_for_task(path, action.task_id))
            result = _get_file_ops(action.task_id).read_file_raw(resolved)
        except Exception as exc:
            return VerificationResult(
                VerificationVerdict.FAILED,
                "hermes.file.raw-read",
                evidence={"path": path},
                reason=f"raw verification read failed: {type(exc).__name__}: {exc}",
            )

        if getattr(result, "error", None):
            return VerificationResult(
                VerificationVerdict.FAILED,
                "hermes.file.raw-read",
                evidence={"path": path, "resolved_path": resolved},
                reason=str(result.error),
            )

        content = str(getattr(result, "content", "") or "")
        expected = dict(action.expected_state or {})
        failures: list[str] = []

        operation = action.operation.strip().lower()
        if operation in {"write", "write_file"} and "content_equals" not in expected:
            expected["content_equals"] = str(payload.get("content") or "")

        equals = expected.get("content_equals")
        if isinstance(equals, str) and content != equals:
            failures.append("file content did not exactly match expected content")

        contains = expected.get("content_contains")
        if isinstance(contains, str):
            contains = [contains]
        if isinstance(contains, (list, tuple)):
            missing = [
                str(item)
                for item in contains
                if str(item) not in content
            ]
            if missing:
                failures.append(
                    "file content missing required text: " + ", ".join(repr(x) for x in missing)
                )

        expected_sha = expected.get("sha256")
        digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
        if isinstance(expected_sha, str) and expected_sha and digest != expected_sha:
            failures.append("file sha256 did not match expected digest")

        expected_bytes = expected.get("bytes")
        observed_bytes = len(content.encode("utf-8"))
        if isinstance(expected_bytes, int) and observed_bytes != expected_bytes:
            failures.append(
                f"file byte length expected {expected_bytes}, got {observed_bytes}"
            )

        return VerificationResult(
            VerificationVerdict.FAILED if failures else VerificationVerdict.PASSED,
            "hermes.file.raw-read",
            evidence={
                "path": path,
                "resolved_path": resolved,
                "bytes": observed_bytes,
                "sha256": digest,
                "write_backend_verified": actual_state.get("verified"),
            },
            reason="; ".join(failures),
        )
