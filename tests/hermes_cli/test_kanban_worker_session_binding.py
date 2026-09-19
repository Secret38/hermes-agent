from hermes_cli import kanban_db as kb
from hermes_cli import kanban_db_connect as kbc


def test_worker_session_binding_is_scoped_to_current_active_run(tmp_path):
    db = tmp_path / "kanban.db"
    conn = kbc.connect(db)
    try:
        task_id = kb.create_task(
            conn,
            title="worker session binding",
            assignee="default",
            initial_status="ready",
        )
        claimed = kb.claim_task(conn, task_id)
        assert claimed is not None
        assert claimed.current_run_id is not None
        run_id = claimed.current_run_id

        assert kb.bind_run_worker_session(conn, task_id, run_id, "session-a") is True
        run = kb.get_run(conn, run_id)
        assert run is not None
        assert run.worker_session_id == "session-a"

        # Compression/session rotation for the SAME active run may update the tip.
        assert kb.bind_run_worker_session(conn, task_id, run_id, "session-b") is True
        assert kb.get_run(conn, run_id).worker_session_id == "session-b"

        # Once this attempt is no longer current, a stale worker cannot rewrite it.
        with kb.write_txn(conn):
            conn.execute("UPDATE tasks SET current_run_id = NULL WHERE id = ?", (task_id,))
        assert kb.bind_run_worker_session(conn, task_id, run_id, "stale-session") is False
        assert kb.get_run(conn, run_id).worker_session_id == "session-b"
    finally:
        conn.close()
