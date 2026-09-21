from __future__ import annotations

import json

import pytest

from agent_os.adapters.hermes_browser import (
    BrowserExecutionError,
    HermesBrowserExecutor,
    HermesBrowserVerifier,
    browser_available,
)
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.verification.gate import VerificationVerdict


def action(operation, payload=None, expected=None):
    task = TaskRecord.create("browser")
    return ActionRecord.create(
        task.id,
        tool="browser",
        operation=operation,
        input=payload or {},
        expected_state=expected or {},
    )


def test_browser_executor_maps_navigation(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool.browser_navigate",
        lambda url, task_id=None: json.dumps(
            {"success": True, "url": url, "title": "Fixture"}
        ),
    )

    result = HermesBrowserExecutor().execute(
        action("navigate", {"url": "https://example.invalid/"})
    )

    assert result.actual_state["title"] == "Fixture"


def test_browser_executor_raises_tool_error(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool.browser_click",
        lambda ref, task_id=None: json.dumps(
            {"success": False, "error": "stale ref"}
        ),
    )

    with pytest.raises(BrowserExecutionError, match="stale ref"):
        HermesBrowserExecutor().execute(action("click", {"ref": "@e1"}))


def test_browser_verifier_requires_fresh_snapshot_state(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool.browser_snapshot",
        lambda full=False, task_id=None: json.dumps(
            {
                "success": True,
                "snapshot": "button DONE",
                "element_count": 1,
            }
        ),
    )

    result = HermesBrowserVerifier().verify(
        action("click", expected={"snapshot_contains": "DONE"}),
        {"success": True, "clicked": "@e1"},
    )

    assert result.verdict is VerificationVerdict.PASSED


def test_browser_verifier_blocks_empty_completion_claim(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool.browser_snapshot",
        lambda full=False, task_id=None: json.dumps(
            {"success": True, "snapshot": "page", "element_count": 0}
        ),
    )

    result = HermesBrowserVerifier().verify(action("snapshot"), {"success": True})

    assert result.verdict is VerificationVerdict.BLOCKED


def test_agent_os_browser_availability_uses_builtin_runtime_probe(monkeypatch):
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool_install.check_builtin_browser_requirements",
        lambda: True,
    )
    monkeypatch.setattr(
        "agent_os.adapters.hermes_browser.browser_tool.check_browser_routed_requirements",
        lambda action: False,
    )

    assert browser_available() is True
