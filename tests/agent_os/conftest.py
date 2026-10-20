"""Keep parallel mission tests off the real user's shared desktop reservation."""

import pytest

from agent_os import mission_control
from agent_os.desktop_lock import InteractiveDesktopLock


@pytest.fixture(autouse=True)
def isolated_mission_desktop(tmp_path, monkeypatch):
    # HERMES_HOME isolation cannot isolate this intentionally profile-independent
    # resource. Keep a real OS lock shared by all services/profiles in this test;
    # only unrelated test processes get a different desktop identity.
    monkeypatch.setattr(
        mission_control, "_INTERACTIVE_MISSION_LOCK",
        InteractiveDesktopLock(tmp_path / "interactive-desktop.lock"),
    )
