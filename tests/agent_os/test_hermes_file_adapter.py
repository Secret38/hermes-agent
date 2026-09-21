from __future__ import annotations

import json

import pytest

from agent_os.adapters.hermes_file import FileExecutionError, HermesFileExecutor
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
