"""Secret redaction shared by the dashboard summary and complete plan review."""

from __future__ import annotations

import re
from typing import Any

from agent.redact import redact_sensitive_text

_SECRET_KEY_RE = re.compile(
    r"(secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|private[_-]?key)",
    re.IGNORECASE,
)


def redact_display_value(value: Any, *, bounded: bool = True, depth: int = 0) -> Any:
    """Summaries are bounded; a review must not silently omit executable content."""
    if bounded and depth >= 5:
        return "[truncated]"
    if isinstance(value, dict):
        items = list(value.items())[:80] if bounded else value.items()
        return {
            str(key): "[redacted]" if _SECRET_KEY_RE.search(str(key)) else
            redact_display_value(item, bounded=bounded, depth=depth + 1)
            for key, item in items
        }
    if isinstance(value, (list, tuple)):
        items = value[:80] if bounded else value
        return [redact_display_value(item, bounded=bounded, depth=depth + 1) for item in items]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    text = redact_sensitive_text(str(value), force=True)
    return text[:800] + "…" if bounded and len(text) > 800 else text
