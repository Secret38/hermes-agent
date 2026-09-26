"""Adapter for Hermes' filesystem checkpoint manager."""

from __future__ import annotations

import base64
from pathlib import Path

from tools.checkpoint_manager import CheckpointManager

from agent_os.contracts import ActionRecord


_PREFIX = "hermes-checkpoint-v1"


def _encode_path(path: str) -> str:
    return base64.urlsafe_b64encode(path.encode("utf-8")).decode("ascii").rstrip("=")


def _decode_path(value: str) -> str:
    padded = value + ("=" * (-len(value) % 4))
    return base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")


class HermesCheckpointProvider:
    """Create restart-stable checkpoint references for Agent OS actions."""

    def __init__(self, manager: CheckpointManager | None = None):
        self.manager = manager or CheckpointManager(enabled=True)

    def create_checkpoint(self, action: ActionRecord) -> str | None:
        workspace = (action.workspace_id or "").strip()
        if not workspace:
            return None

        root = str(Path(workspace).expanduser().resolve())
        self.manager.new_turn()
        if not self.manager.ensure_checkpoint(root, reason=f"agent-os:{action.id}"):
            return None

        checkpoints = self.manager.list_checkpoints(root)
        if not checkpoints:
            return None
        commit_hash = str(checkpoints[0].get("hash") or "").strip()
        if not commit_hash:
            return None
        return f"{_PREFIX}:{_encode_path(root)}:{commit_hash}"

    def rollback(self, checkpoint_id: str) -> bool:
        parsed = self._parse(checkpoint_id)
        if parsed is None:
            return False
        root, commit_hash = parsed
        result = self.manager.restore(root, commit_hash, safe=True)
        return bool(result.get("success"))

    @staticmethod
    def _parse(checkpoint_id: str) -> tuple[str, str] | None:
        parts = checkpoint_id.split(":", 2)
        if len(parts) != 3 or parts[0] != _PREFIX:
            return None
        try:
            root = _decode_path(parts[1])
        except Exception:
            return None
        commit_hash = parts[2].strip()
        if not root or not commit_hash:
            return None
        return root, commit_hash
