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
        task_id="task-1",
        run_id=7,
        project_id="project-1",
        created_at=101.0,
        home=tmp_path,
    )

    assert isinstance(first, int)
    assert isinstance(second, int)
    rows = audit.list_events(home=tmp_path)
    assert [row["event"] for row in rows] == ["human_gate.resolved", "human_gate.requested"]
    assert rows[0]["outcome"] == "once"
    assert rows[0]["task_id"] == "task-1"
    assert rows[0]["run_id"] == 7
    assert rows[0]["project_id"] == "project-1"
    assert set(rows[0]) == {
        "id", "event", "category", "session_id", "request_id", "subject", "outcome",
        "task_id", "run_id", "project_id", "created_at"
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


def test_task_run_project_filters(tmp_path):
    audit.reset_for_tests(home=tmp_path)
    audit.append_event(
        "run.started",
        category="execution",
        task_id="t1",
        run_id=1,
        project_id="p1",
        home=tmp_path,
    )
    audit.append_event(
        "run.completed",
        category="execution",
        task_id="t1",
        run_id=2,
        project_id="p1",
        home=tmp_path,
    )
    audit.append_event(
        "run.completed",
        category="execution",
        task_id="t2",
        run_id=3,
        project_id="p2",
        home=tmp_path,
    )

    assert [row["run_id"] for row in audit.list_events(task_id="t1", home=tmp_path)] == [2, 1]
    assert [row["event"] for row in audit.list_events(run_id=1, home=tmp_path)] == ["run.started"]
    assert [row["task_id"] for row in audit.list_events(project_id="p1", home=tmp_path)] == ["t1", "t1"]


def test_existing_database_migrates_additively(tmp_path):
    import sqlite3

    path = tmp_path / "operations-audit.db"
    with sqlite3.connect(path) as conn:
        conn.execute(
            """
            CREATE TABLE audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event TEXT NOT NULL,
                category TEXT NOT NULL,
                session_id TEXT,
                request_id TEXT,
                subject TEXT,
                outcome TEXT,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO audit_events
                (event, category, session_id, request_id, subject, outcome, created_at)
            VALUES ('legacy', 'test', NULL, NULL, NULL, NULL, 1.0)
            """
        )
        conn.commit()

    event_id = audit.append_event(
        "run.started",
        category="execution",
        task_id="t1",
        run_id=9,
        project_id="p1",
        home=tmp_path,
    )
    assert isinstance(event_id, int)
    rows = audit.list_events(home=tmp_path)
    assert rows[0]["task_id"] == "t1"
    assert rows[0]["run_id"] == 9
    assert rows[0]["project_id"] == "p1"
    assert rows[1]["event"] == "legacy"
    assert rows[1]["task_id"] is None
