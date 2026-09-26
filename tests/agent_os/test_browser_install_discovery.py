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


def test_builtin_runtime_probe_is_independent_of_browser_use_exposure(monkeypatch):
    monkeypatch.setattr(browser_tool, "_is_browser_use_cli_mode", lambda: True)
    monkeypatch.setattr(browser_tool, "_is_camofox_mode", lambda: False)
    monkeypatch.setattr(install._cdp, "_get_cdp_override_raw", lambda: "")
    monkeypatch.setattr(install, "_find_agent_browser", lambda validate=False: browser_tool.NPX_AGENT_BROWSER_SENTINEL)
    monkeypatch.setattr(install, "_requires_real_termux_browser_install", lambda command: False)
    monkeypatch.setattr(install._cloud, "_get_cloud_provider", lambda: None)
    monkeypatch.setattr(install._lp, "_using_lightpanda_engine", lambda: False)
    monkeypatch.setattr(install, "_chromium_installed", lambda: True)

    assert install.check_builtin_browser_requirements() is True
    assert install.check_browser_requirements() is False


def test_reset_browser_install_cache_clears_negative_discovery(monkeypatch):
    monkeypatch.setattr(browser_tool, "_cached_chromium_installed", False)
    monkeypatch.setattr(browser_tool, "_cached_agent_browser", "stale")
    monkeypatch.setattr(browser_tool, "_agent_browser_resolved", True)

    install.reset_browser_install_cache()

    assert browser_tool._cached_chromium_installed is None
    assert browser_tool._cached_agent_browser is None
    assert browser_tool._agent_browser_resolved is False
