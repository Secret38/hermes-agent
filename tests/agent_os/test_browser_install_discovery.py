from __future__ import annotations

from tools import browser_tool
from tools import browser_tool_install as install


def test_agent_browser_managed_chrome_cache_is_discovered(tmp_path, monkeypatch):
    managed_root = tmp_path / ".agent-browser" / "browsers"
    (managed_root / "chrome-153.0.8010.52").mkdir(parents=True)

    original_expanduser = install.os.path.expanduser
    monkeypatch.setattr(
        install.os.path,
        "expanduser",
        lambda value: str(tmp_path) if value == "~" else original_expanduser(value),
    )
    monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
    monkeypatch.delenv("AGENT_BROWSER_EXECUTABLE_PATH", raising=False)
    monkeypatch.setattr(install.shutil, "which", lambda name, path=None: None)
    monkeypatch.setattr(browser_tool, "_cached_chromium_installed", None)

    assert str(managed_root) in install._chromium_search_roots()
    assert install._has_chromium_build(str(managed_root))
    assert install._chromium_installed() is True
