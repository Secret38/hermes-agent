from types import SimpleNamespace

import agent.conversation_compression as compression


def test_missing_compression_lock_api_fails_closed(monkeypatch):
    """Version skew must never rotate a durable transcript without its lineage lock."""
    warnings = []
    agent = SimpleNamespace(
        _session_db=object(),
        session_id="durable-session",
        _compression_lock_ttl_seconds=300.0,
        _compression_lock_refresh_interval=None,
        _compression_skipped_due_to_lock=None,
        _last_compression_lock_error_sid=None,
        _emit_warning=warnings.append,
    )
    lifecycle = object()
    aborts = []

    monkeypatch.setattr(compression, "_resolve_lock_api", lambda _db: (None, None))
    monkeypatch.setattr(compression, "_compression_lock_holder", lambda _agent: "candidate-holder")

    def fake_abort(_agent, _lifecycle, _system_message, _started_at, failure_class, prompt=None):
        aborts.append(failure_class)
        return None, "existing prompt"

    monkeypatch.setattr(compression, "_abort_lease", fake_abort)

    lease, prompt = compression._acquire_compression_lease(
        agent,
        commit_fence=None,
        lifecycle=lifecycle,
        system_message="system",
        approx_tokens=1000,
        attempt_started_at=1.0,
    )

    assert lease is None
    assert prompt == "existing prompt"
    assert aborts == ["lock_api_unavailable"]
    assert agent._compression_skipped_due_to_lock is True
    assert agent._last_compression_lock_error_sid == "durable-session"
    assert warnings and "lock API is unavailable" in warnings[0]


def test_no_session_db_still_allows_in_memory_compression(monkeypatch):
    """No durable DB means there is no lineage lock to acquire."""
    agent = SimpleNamespace(
        _session_db=None,
        session_id="",
        _compression_lock_ttl_seconds=300.0,
        _compression_lock_refresh_interval=None,
        _compression_skipped_due_to_lock=None,
    )

    lease, prompt = compression._acquire_compression_lease(
        agent,
        commit_fence=None,
        lifecycle=object(),
        system_message="system",
        approx_tokens=1000,
        attempt_started_at=1.0,
    )

    assert lease is not None
    assert lease.holder is None
    assert prompt is None
