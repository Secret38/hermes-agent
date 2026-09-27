from __future__ import annotations

from types import SimpleNamespace

from hermes_cli import kanban_db


def test_task_lifecycle_audit_is_identifier_only(monkeypatch):
    calls = []

    monkeypatch.setattr(
        "hermes_cli.operations_audit.append_event",
        lambda event, **kwargs: calls.append((event, kwargs)) or 1,
    )
    task = SimpleNamespace(
        assignee="coder",
        project_id="project-1",
        session_id="origin-session",
    )

    kanban_db._audit_task_lifecycle("kanban_task_claimed", task, "task-1", 7)
    kanban_db._audit_task_lifecycle("kanban_task_completed", task, "task-1", 7)

    assert calls == [
        (
            "run.started",
            {
                "category": "execution",
                "session_id": "origin-session",
                "subject": "kanban",
                "outcome": "running",
                "task_id": "task-1",
                "run_id": 7,
                "project_id": "project-1",
            },
        ),
        (
            "run.completed",
            {
                "category": "execution",
                "session_id": "origin-session",
                "subject": "kanban",
                "outcome": "completed",
                "task_id": "task-1",
                "run_id": 7,
                "project_id": "project-1",
            },
        ),
    ]


def test_unmapped_task_lifecycle_is_not_audited(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "hermes_cli.operations_audit.append_event",
        lambda event, **kwargs: calls.append((event, kwargs)) or 1,
    )

    kanban_db._audit_task_lifecycle(
        "kanban_task_blocked",
        SimpleNamespace(assignee=None, project_id=None, session_id=None),
        "task-1",
        None,
    )

    assert calls == []


def test_worker_started_audit_does_not_depend_on_plugin_observers(monkeypatch):
    calls = []
    monkeypatch.setattr(
        "hermes_cli.operations_audit.append_event",
        lambda event, **kwargs: calls.append((event, kwargs)) or 1,
    )
    monkeypatch.setattr(kanban_db, "_current_run_id", lambda _conn, _task_id: 11)
    monkeypatch.setattr(kanban_db, "_kanban_observer_consumed", lambda _event: False)

    task = SimpleNamespace(
        id="task-1",
        assignee="coder",
        project_id="project-1",
        session_id="origin-session",
    )
    kanban_db._fire_worker_spawned_hook(object(), task, "/sensitive/workspace", 123)

    assert calls == [
        (
            "worker.started",
            {
                "category": "execution",
                "session_id": "origin-session",
                "subject": "kanban_worker",
                "outcome": "running",
                "task_id": "task-1",
                "run_id": 11,
                "project_id": "project-1",
            },
        )
    ]
    assert "/sensitive/workspace" not in repr(calls)
