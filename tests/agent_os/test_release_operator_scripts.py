from __future__ import annotations

from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
_SETUP = _REPO / "scripts" / "agent_os_release_setup.ps1"
_PUBLISH = _REPO / "scripts" / "agent_os_release_publish.ps1"


def _text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_release_setup_enforces_protected_source_and_immutable_tags():
    text = _text(_SETUP)

    assert "branches/$Branch/protection" in text
    assert '"All required checks pass"' in text
    assert '"build pinned Hermes-Setup.exe"' in text
    assert "allow_force_pushes = $false" in text
    assert "allow_deletions = $false" in text

    assert 'target = "tag"' in text
    assert 'include = @("refs/tags/agent-os-v*")' in text
    assert 'type = "update"' in text
    assert 'type = "deletion"' in text


def test_release_setup_provisions_signing_and_interactive_gui_runner():
    text = _text(_SETUP)

    assert "WINDOWS_CODE_SIGN_PFX_B64" in text
    assert "WINDOWS_CODE_SIGN_PASSWORD" in text
    assert "1.3.6.1.5.5.7.3.3" in text
    assert "HasPrivateKey" in text

    assert "actions/runners/registration-token" in text
    assert '"agent-os-gui"' in text
    assert "Session 0" in text
    assert "Runner.Listener.exe" in text
    assert "run.cmd" in text

    # A service runner would execute in Session 0 and invalidate native GUI proof.
    assert "svc install" not in text.lower()
    assert "--runasservice" not in text.lower()


def test_release_publish_fails_closed_before_tag_creation():
    text = _text(_PUBLISH)

    protected = text.index("if (-not $branchInfo.protected)")
    checks = text.index('$requiredChecks = @("All required checks pass", "build pinned Hermes-Setup.exe")')
    secrets = text.index('WINDOWS_CODE_SIGN_PFX_B64')
    runner = text.index('No online Windows x64 runner with label agent-os-gui')
    preflight = text.index('workflow", "run", "agent-os-release-preflight.yml')
    preflight_success = text.index("Release preflight failed. No release tag was created.")
    tag_create = text.index('git -C $repoRoot tag -a $tag')

    assert protected < checks < secrets < runner < preflight < preflight_success < tag_create


def test_release_publish_never_reuses_tag_and_verifies_release_assets():
    text = _text(_PUBLISH)

    assert "Never reuse or move an Agent OS release tag" in text
    assert 'ls-remote --tags origin "refs/tags/$tag"' in text
    assert 'git -C $repoRoot push origin "refs/tags/$tag"' in text

    for asset in (
        "Hermes-Setup.exe",
        "SHA256SUMS.txt",
        "build-metadata.json",
        "source-build-metadata.json",
        "agent-os-health.json",
        "agent-os-repair-health.json",
        "agent-os-golden-results.json",
        "qualification-metadata.json",
    ):
        assert asset in text
