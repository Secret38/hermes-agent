"""Tests for Matrix adapter fail-closed approval reaction auth.

When MATRIX_ALLOWED_USERS is not configured, _on_reaction must deny
approval reactions by default unless GATEWAY_ALLOW_ALL_USERS=true.
Mirrors the Telegram _is_callback_user_authorized fix (commit 89d32052e,
PR #28494).
"""

import asyncio
import sys
import types
from collections import deque
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest


# ---------------------------------------------------------------------------
# Stub mautrix so plugins.platforms.matrix.adapter can be imported without the SDK.
# ---------------------------------------------------------------------------

def _stub_mautrix():
    stub = types.ModuleType("mautrix")
    for sub in ("mautrix.types", "mautrix.client", "mautrix.client.api",
                "mautrix.errors", "mautrix.crypto", "mautrix.util",
                "mautrix.util.config"):
        sys.modules.setdefault(sub, types.ModuleType(sub))
    sys.modules.setdefault("mautrix", stub)
    m = sys.modules["mautrix.types"]

    class EventType:
        ROOM_MESSAGE = "m.room.message"
        REACTION = "m.reaction"
        ROOM_ENCRYPTED = "m.room.encrypted"
        ROOM_NAME = "m.room.name"

    class PaginationDirection:
        BACKWARD = "b"
        FORWARD = "f"

    class PresenceState:
        ONLINE = "online"
        OFFLINE = "offline"
        UNAVAILABLE = "unavailable"

    class RoomCreatePreset:
        PRIVATE = "private_chat"
        PUBLIC = "public_chat"
        TRUSTED_PRIVATE = "trusted_private_chat"

    class TrustState:
        UNVERIFIED = 0
        VERIFIED = 1

    for attr in ("ContentURI", "EventID", "RoomID", "SyncToken", "UserID"):
        setattr(m, attr, str)
    m.EventType = EventType
    m.PaginationDirection = PaginationDirection
    m.PresenceState = PresenceState
    m.RoomCreatePreset = RoomCreatePreset
    m.TrustState = TrustState


_stub_mautrix()

from plugins.platforms.matrix.adapter import MatrixAdapter, _MatrixApprovalPrompt  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_adapter(allowed_user_ids=None):
    """Construct a MatrixAdapter with only the state needed by _on_reaction."""
    adapter = object.__new__(MatrixAdapter)
    adapter._user_id = "@bot:matrix.org"
    adapter._allowed_user_ids = set(allowed_user_ids) if allowed_user_ids else set()
    adapter._approval_reaction_map = {"✅": "once", "❎": "deny"}
    adapter._approval_prompts_by_event = {}
    adapter._approval_prompt_by_session = {}
    adapter._processed_events = deque(maxlen=512)
    adapter._processed_events_set = set()
    return adapter


def _make_event(sender, reacts_to, key="✅"):
    """Minimal Matrix reaction event."""
    return SimpleNamespace(
        sender=sender,
        event_id=f"$reaction-{sender.split(':')[0]}",
        room_id="!testroom:matrix.org",
        content={"m.relates_to": {"event_id": reacts_to, "key": key}},
    )


def _make_prompt(chat_id="!testroom:matrix.org"):
    return _MatrixApprovalPrompt(
        session_key="session-abc",
        chat_id=chat_id,
        message_id="$prompt-event-1",
    )


def _run(adapter, event, *, central_authorized=True):
    """Run _on_reaction and return (resolved, resolver_calls)."""
    prompt_event_id = "$prompt-event-1"
    prompt = _make_prompt()
    adapter._approval_prompts_by_event[prompt_event_id] = prompt
    adapter._redact_bot_approval_reactions = AsyncMock()
    adapter._send_invalid_reaction_feedback = AsyncMock()

    resolver_calls = []
    fake_approval = types.ModuleType("tools.approval")
    fake_approval.gateway_approval_actor_authorized = (
        lambda session_key, actor_user_id: central_authorized
    )
    fake_approval.resolve_gateway_approval = (
        lambda session_key, choice, **kwargs:
        resolver_calls.append((session_key, choice, kwargs.get("actor_user_id"))) or 1
    )
    with patch.dict(sys.modules, {"tools.approval": fake_approval}):
        asyncio.run(adapter._on_reaction(event))

    return prompt.resolved, resolver_calls


# ---------------------------------------------------------------------------
# Test class
# ---------------------------------------------------------------------------

class TestApprovalReactionFailClosed:
    """_on_reaction approval auth must be fail-closed (parity with Telegram)."""

    def test_no_allowlist_no_allow_all_denies(self, monkeypatch):
        """No MATRIX_ALLOWED_USERS + no GATEWAY_ALLOW_ALL_USERS → deny."""
        monkeypatch.delenv("MATRIX_ALLOWED_USERS", raising=False)
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)
        adapter = _make_adapter(allowed_user_ids=None)
        event = _make_event("@stranger:matrix.org", "$prompt-event-1")
        resolved, calls = _run(adapter, event)
        assert resolved is False
        assert calls == []


    def test_allowlisted_room_participant_still_cannot_approve_another_users_turn(self, monkeypatch):
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)
        adapter = _make_adapter(allowed_user_ids={"@participant:matrix.org"})
        event = _make_event("@participant:matrix.org", "$prompt-event-1")

        resolved, calls = _run(adapter, event, central_authorized=False)

        assert resolved is False
        assert calls == []
        adapter._send_invalid_reaction_feedback.assert_awaited_once()

    def test_bound_owner_identity_is_forwarded_to_resolver(self, monkeypatch):
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)
        adapter = _make_adapter(allowed_user_ids={"@owner:matrix.org"})
        event = _make_event("@owner:matrix.org", "$prompt-event-1")

        resolved, calls = _run(adapter, event, central_authorized=True)

        assert resolved is True
        assert calls == [("session-abc", "once", "@owner:matrix.org")]


