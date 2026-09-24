from __future__ import annotations

from tools.computer_use import tool
from tools.computer_use.backend import CaptureResult


def test_capture_response_can_disable_screenshot_file_persistence(monkeypatch):
    writes = []

    monkeypatch.setattr(
        tool,
        "_persist_capture_image",
        lambda capture: writes.append(capture) or "capture.png",
    )
    def unexpected_aux_vision():
        raise AssertionError("ephemeral capture must not materialize an aux-vision temp file")

    monkeypatch.setattr(tool, "_should_route_through_aux_vision", unexpected_aux_vision)

    capture = CaptureResult(
        mode="vision",
        width=100,
        height=80,
        png_b64="AAAA",
        image_mime_type="image/png",
    )

    observed = []
    ephemeral = tool._capture_response(
        capture,
        capture_callback=observed.append,
        persist_capture=False,
    )
    assert writes == []
    assert observed == [
        {
            "data_url": "data:image/png;base64,AAAA",
            "height": 80,
            "width": 100,
        }
    ]
    assert ephemeral["_multimodal"] is True
    assert "screenshot_path" not in ephemeral["meta"]

    monkeypatch.setattr(tool, "_should_route_through_aux_vision", lambda: False)
    persisted = tool._capture_response(capture)
    assert len(writes) == 1
    assert persisted["meta"]["screenshot_path"] == "capture.png"
