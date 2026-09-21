"""Agent OS executor adapter for Hermes file tools."""

from __future__ import annotations

import json
from typing import Any

from tools.file_tools import read_file_tool, write_file_tool

from agent_os.contracts import ActionRecord
from agent_os.kernel import ExecutionResult


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
