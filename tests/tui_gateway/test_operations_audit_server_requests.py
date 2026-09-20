from __future__ import annotations

from tui_gateway import server_requests


def test_server_request_audit_never_receives_prompt_payload(monkeypatch):
    calls = []
    emitted = []

    def record(event, **kwargs):
        calls.append((event, kwargs))
        return 42

    monkeypatch.setattr("hermes_cli.operations_audit.append_event", record)
    monkeypatch.setattr(server_requests, "_emit", lambda event, sid, payload: emitted.append((event, sid, payload)))
    monkeypatch.setattr(server_requests, "_write", lambda _frame: None)

    request = server_requests.ServerRequest(
        "session-secret",
        "secret",
        {
            "prompt": "DO-NOT-PERSIST",
            "secret": "TOP-SECRET",
            "verification_code": "123456",
        },
    )

    server_requests._register(request)

    assert calls == [
        (
            "human_gate.requested",
            {
                "category": "human_gate",
                "session_id": "session-secret",
                "request_id": request.id,
                "subject": "secret",
                "outcome": "waiting",
            },
        )
    ]
    assert "DO-NOT-PERSIST" not in repr(calls)
    assert "TOP-SECRET" not in repr(calls)
    assert "123456" not in repr(calls)
    assert emitted == [
        (
            "audit.changed",
            "session-secret",
            {"id": 42, "event": "human_gate.requested", "subject": "secret"},
        )
    ]

    # Keep module-global request state isolated from other tests.
    with server_requests._lock:
        server_requests._open.pop(request.id, None)


def test_approval_audit_records_only_choice_not_request_or_result_payload(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "hermes_cli.operations_audit.append_event",
        lambda event, **kwargs: calls.append((event, kwargs)) or 7,
    )
    monkeypatch.setattr(server_requests, "_emit", lambda *_args: None)
    monkeypatch.setattr(server_requests, "_write", lambda _frame: None)

    request = server_requests.ServerRequest(
        "session-approval",
        "approval",
        {"command": "rm -rf /very-sensitive", "description": "DO-NOT-PERSIST"},
    )
    server_requests._register(request)

    assert server_requests.resolve(
        request.id,
        result={"choice": "once", "echo": "DO-NOT-PERSIST"},
    ) is True

    assert calls[-1] == (
        "human_gate.resolved",
        {
            "category": "human_gate",
            "session_id": "session-approval",
            "request_id": request.id,
            "subject": "approval",
            "outcome": "once",
        },
    )
    assert "rm -rf /very-sensitive" not in repr(calls)
    assert "DO-NOT-PERSIST" not in repr(calls)
