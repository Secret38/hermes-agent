from __future__ import annotations

import json

import pytest

from agent_os.adapters.hermes_file import (
    FileExecutionError,
    HermesFileExecutor,
    HermesFileVerifier,
)
from agent_os.contracts import ActionRecord, TaskRecord


def make_action(operation, payload):
    task = TaskRecord.create("file adapter")
    return ActionRecord.create(
        task.id,
        tool="file",
        operation=operation,
        input=payload,
    )


def test_write_maps_success(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file.write_file_tool",
        lambda *args, **kwargs: json.dumps({"success": True, "resolved_path": "/tmp/x"}),
    )

    result = HermesFileExecutor().execute(
        make_action("write_file", {"path": "/tmp/x", "content": "ok"})
    )

    assert result.actual_state["success"] is True


def test_read_failure_raises(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file.read_file_tool",
        lambda *args, **kwargs: json.dumps({"success": False, "error": "blocked"}),
    )

    with pytest.raises(FileExecutionError, match="blocked"):
        HermesFileExecutor().execute(make_action("read_file", {"path": "/tmp/x"}))


class RawResult:
    def __init__(self, content="", error=None):
        self.content = content
        self.error = error


class RawOps:
    def __init__(self, result):
        self.result = result

    def read_file_raw(self, path):
        return self.result


def test_file_verifier_re_reads_same_backend_for_exact_write(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file._resolve_path_for_task",
        lambda path, task_id: "/sandbox/artifact.txt",
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file._get_file_ops",
        lambda task_id: RawOps(RawResult("hello\n")),
    )
    task = TaskRecord.create("verify file")
    action = ActionRecord.create(
        task.id,
        tool="file",
        operation="write_file",
        input={"path": "artifact.txt", "content": "hello\n"},
        expected_state={},
    )

    result = HermesFileVerifier().verify(action, {"verified": True})

    assert result.passed
    assert result.evidence["resolved_path"] == "/sandbox/artifact.txt"
    assert "content" not in result.evidence


def test_file_verifier_fails_backend_content_mismatch(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file._resolve_path_for_task",
        lambda path, task_id: "/sandbox/artifact.txt",
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_file._get_file_ops",
        lambda task_id: RawOps(RawResult("wrong")),
    )
    task = TaskRecord.create("verify file")
    action = ActionRecord.create(
        task.id,
        tool="file",
        operation="write_file",
        input={"path": "artifact.txt", "content": "expected"},
    )

    result = HermesFileVerifier().verify(action, {})

    assert not result.passed
    assert "exactly match" in result.reason
