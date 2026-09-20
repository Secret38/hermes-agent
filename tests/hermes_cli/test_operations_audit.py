from __future__ import annotations

from hermes_cli import operations_audit as audit


def test_metadata_only_append_and_read(tmp_path):
    audit.reset_for_tests(home=tmp_path)

    first = audit.append_event(
        "human_gate.requested",
        category="human_gate",
        session_id="session-1",
        request_id="req-1",
        subject="approval",
        outcome="waiting",
        created_at=100.0,
        home=tmp_path,
    )
    second = audit.append_event(
        "human_gate.resolved",
        category="human_gate",
        session_id="session-1",
        request_id="req-1",
        subject="approval",
        outcome="once",
        created_at=101.0,
        home=tmp_path,
    )

    assert isinstance(first, int)
    assert isinstance(second, int)
    rows = audit.list_events(home=tmp_path)
    assert [row["event"] for row in rows] == ["human_gate.resolved", "human_gate.requested"]
    assert rows[0]["outcome"] == "once"
    assert set(rows[0]) == {
        "id", "event", "category", "session_id", "request_id", "subject", "outcome", "created_at"
    }


def test_session_filter_and_cursor(tmp_path):
    audit.reset_for_tests(home=tmp_path)
    a = audit.append_event("a", category="x", session_id="s1", home=tmp_path)
    b = audit.append_event("b", category="x", session_id="s2", home=tmp_path)
    c = audit.append_event("c", category="x", session_id="s1", home=tmp_path)

    assert [row["event"] for row in audit.list_events(session_id="s1", home=tmp_path)] == ["c", "a"]
    assert [row["event"] for row in audit.list_events(before_id=c, home=tmp_path)] == ["b", "a"]
    assert a < b < c


def test_separate_homes_do_not_share_audit_state(tmp_path):
    left = tmp_path / "left"
    right = tmp_path / "right"
    audit.append_event("left", category="test", home=left)
    audit.append_event("right", category="test", home=right)

    assert [row["event"] for row in audit.list_events(home=left)] == ["left"]
    assert [row["event"] for row in audit.list_events(home=right)] == ["right"]
