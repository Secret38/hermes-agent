from __future__ import annotations

import base64

from tools.computer_use import tool as computer_use_tool
from tools.computer_use.backend import CaptureResult


def test_capture_observer_receives_fenced_image_without_owning_capture_lifecycle():
    seen = []
    encoded = base64.b64encode(b"frame").decode("ascii")
    cap = CaptureResult(
        mode="vision",
        width=640,
        height=480,
        png_b64=encoded,
        elements=[],
        app="Notepad",
        window_title="Untitled - Notepad",
    )

    token = computer_use_tool._capture_observer.set(lambda **payload: seen.append(payload))
    try:
        result = computer_use_tool._capture_response(cap, session_id=None)
    finally:
        computer_use_tool._capture_observer.reset(token)

    assert seen == [
        {
            "mime_type": computer_use_tool._capture_image_format(cap)[0],
            "image_b64": encoded,
            "width": 640,
            "height": 480,
        }
    ]
    assert isinstance(result, dict)
    assert result["_multimodal"] is True


def test_request_approval_uses_explicit_per_call_callback(monkeypatch):
    callback = object()
    seen = {}

    def fake_gate(**kwargs):
        seen.update(kwargs)
        return {"approved": True}

    monkeypatch.setattr("tools.approval._run_approval_gate", fake_gate)

    result = computer_use_tool._request_approval(
        "click",
        {},
        approval_callback=callback,
    )

    assert result is None
    assert seen["approval_callback"] is callback
