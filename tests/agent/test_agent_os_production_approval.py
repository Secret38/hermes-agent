from __future__ import annotations

import json
from types import SimpleNamespace

from agent import tool_executor


def _ref(name: str = "write_file"):
    return tool_executor._ToolCallRef(
        name,
        {"path": "example.txt", "content": "hello"},
        "task-1",
        "call-1",
        [],
    )


def test_production_mutation_approval_denial_blocks_before_dispatch(monkeypatch):
    executed: list[dict] = []
    posts: list[dict] = []

    monkeypatch.setattr(
        tool_executor,
        "_pre_tool_block",
        lambda agent, ref: (None, ref.args),
    )
    monkeypatch.setattr(
        tool_executor,
        "_context_pruned_argument_paths",
        lambda name, args: [],
    )
    monkeypatch.setattr(
        tool_executor,
        "_production_mutation_approval_block",
        lambda ref: "approval denied",
    )
    monkeypatch.setattr(
        tool_executor,
        "_emit_terminal_post_tool_call",
        lambda *args, **kwargs: posts.append(kwargs),
    )

    state = tool_executor._ManagedToolResult(
        result=None,
        args={},
        middleware_trace=[],
        blocked=False,
        dispatched=False,
    )
    agent = SimpleNamespace(
        _tool_guardrails=SimpleNamespace(
            before_call=lambda name, args: (_ for _ in ()).throw(
                AssertionError("guardrails must not run after production approval denial")
            )
        )
    )

    result = tool_executor._dispatch_authorized_once(
        agent,
        state,
        _ref(),
        execute=lambda args: executed.append(args),
        scope_block=None,
        display_index=None,
        begin_execution=None,
        authorization_gate=None,
    )

    assert executed == []
    assert state.blocked is True
    assert json.loads(result) == {"error": "approval denied"}
    assert posts and posts[-1]["status"] == "blocked"
    assert posts[-1]["error_type"] == "production_host_mutation_approval"


def test_production_mutation_approval_is_exact_and_non_bypassable(monkeypatch):
    import tools.approval
    from tools import approval_context

    seen: dict = {}
    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: True)

    def request(tool_name, reason, **kwargs):
        seen.update(tool_name=tool_name, reason=reason, **kwargs)
        return {"approved": False, "message": "declined"}

    monkeypatch.setattr(tools.approval, "request_tool_approval", request)

    message = tool_executor._production_mutation_approval_block(_ref())

    assert message == "declined"
    assert seen["tool_name"] == "write_file"
    assert seen["exact_once"] is True
    assert seen["non_bypassable"] is True
    assert seen["rule_key"].startswith("production_host_mutation:write_file:")
    assert "hello" in seen["display_target"]


def test_production_mutation_approval_is_inactive_outside_production_mode(monkeypatch):
    from tools import approval_context

    monkeypatch.setattr(approval_context, "_confirm_host_mutations", lambda: False)

    assert tool_executor._production_mutation_approval_block(_ref()) is None
