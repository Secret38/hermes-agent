from __future__ import annotations

from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[2]
_WORKFLOW = _REPO / ".github" / "workflows" / "agent-os-release.yml"
_PREFLIGHT = _REPO / ".github" / "workflows" / "agent-os-release-preflight.yml"
_VISUAL_QA = _REPO / ".github" / "workflows" / "agent-os-windows-visual-qa.yml"


def _yaml(path: Path) -> dict:
    yaml = pytest.importorskip("yaml")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _workflow() -> dict:
    return _yaml(_WORKFLOW)


def _step(job: dict, name: str) -> dict:
    matches = [step for step in job.get("steps", []) if step.get("name") == name]
    assert len(matches) == 1, f"expected exactly one release step named {name!r}"
    return matches[0]


def test_release_qualification_consumes_the_exact_immutable_build():
    jobs = _workflow()["jobs"]
    policy = jobs["repository-policy"]
    build = jobs["build-windows"]
    qualify = jobs["qualify-windows-gui"]

    policy_run = _step(policy, "Require protected agent-os-v1 branch")["run"]
    assert ".protected" in policy_run
    assert '!= "true"' in policy_run
    assert build["needs"] == "repository-policy"
    assert qualify["needs"] == "build-windows"
    assert qualify["runs-on"] == ["self-hosted", "windows", "x64", "agent-os-gui"]

    download = _step(qualify, "Download the exact immutable installer candidate")
    assert download["with"]["name"] == "agent-os-release-build-${{ github.sha }}"
    assert download["with"]["path"] == "qualification/candidate"

    identity = _step(qualify, "Verify candidate identity before execution")["run"]
    assert "source-build-metadata.json" in identity
    assert "GITHUB_REPOSITORY" in identity
    assert "GITHUB_SHA" in identity
    assert "GITHUB_REF_NAME" in identity
    assert "Get-FileHash -Algorithm SHA256" in identity


def test_release_qualification_drives_the_real_installer_gui_and_desktop_handoff():
    qualify = _workflow()["jobs"]["qualify-windows-gui"]

    gui = _step(qualify, "Clean-install through the exact Hermes-Setup.exe user path")[
        "run"
    ]
    assert "qualification/candidate/Hermes-Setup.exe" in gui
    assert "install-and-launch.ahk" in gui
    assert "Get-Process -Name 'Hermes'" in gui
    assert ".hermes-bootstrap-complete" in gui
    assert "rev-parse HEAD" in gui
    assert "GITHUB_SHA" in gui

    driver = _step(qualify, "Install AutoHotkey GUI driver")["run"]
    assert "AutoHotkey_2.0.19.zip" in driver
    assert "4e0d0e65655066a646a210951320feaef0729a3597177131adaec4066bef5869" in driver
    assert "Get-FileHash -Algorithm SHA256" in driver


def test_release_publication_is_blocked_on_every_v1_qualification_invariant():
    jobs = _workflow()["jobs"]
    publish = jobs["sign-publish"]

    assert set(publish["needs"]) == {"build-windows", "qualify-windows-gui"}

    evidence = _step(publish, "Verify build and qualification identity")["run"]
    for invariant in (
        "clean_install",
        "exact_installer_gui",
        "desktop_launch_handoff",
        "repair_reinstall",
        "durable_state_preserved",
        "full_uninstall",
        "full_ready",
        "production_security_ready",
        'windows_golden -ne "GT-12,GT-13"',
        'golden_tasks -ne "20/20"',
    ):
        assert invariant in evidence

    signing = _step(publish, "Authenticode-sign Hermes-Setup.exe")["run"]
    assert "signtool" in signing
    assert "verify /pa /all /v" in signing
    assert "Get-AuthenticodeSignature" in signing
    assert "TimeStamperCertificate" in signing

    release = _step(publish, "Publish GitHub Release")["run"]
    assert "gh release create" in release
    assert "--verify-tag" in release


def test_release_qualification_still_requires_runtime_repair_state_and_uninstall_proofs():
    qualify = _workflow()["jobs"]["qualify-windows-gui"]
    names = {step.get("name") for step in qualify.get("steps", [])}

    assert "Require full readiness from the installed runtime" in names
    readiness = _step(qualify, "Require full readiness from the installed runtime")["run"]
    assert "--require-full" in readiness
    assert "--require-production-security" in readiness
    assert "Prove native Windows GT-12 and GT-13 from the installed checkout" in names
    assert "Prove canonical Agent OS V1 20/20 from the installed checkout" in names
    assert "Seed durable Agent OS state before repair" in names
    assert "Re-run production installer as repair/idempotency gate" in names
    assert "Prove full uninstall removes the isolated installation" in names



def test_release_preflight_requires_protected_source_gui_runner_and_signing_identity():
    jobs = _yaml(_PREFLIGHT)["jobs"]

    policy = jobs["repository-policy"]
    policy_run = _step(policy, "Require protected agent-os-v1 branch")["run"]
    assert ".protected" in policy_run
    assert '!= "true"' in policy_run

    gui = jobs["gui-runner"]
    assert gui["needs"] == "repository-policy"
    assert gui["runs-on"] == ["self-hosted", "windows", "x64", "agent-os-gui"]
    session = _step(gui, "Verify interactive desktop session")["run"]
    assert "Session 0" in session

    signing = jobs["signing"]
    assert signing["needs"] == "repository-policy"
    identity = _step(signing, "Validate PFX secret and code-signing EKU")["run"]
    assert "WINDOWS_CODE_SIGN_PFX_B64" in identity
    assert "WINDOWS_CODE_SIGN_PASSWORD" in identity
    assert "1.3.6.1.5.5.7.3.3" in identity
    assert "HasPrivateKey" in identity


    smoke = _step(signing, "Smoke-test Authenticode signing and trusted timestamp")["run"]
    assert "signtool" in smoke
    assert r"signtool\.exe$' }" in smoke
    assert 'sign /fd SHA256 /tr "http://timestamp.digicert.com" /td SHA256' in smoke
    assert "verify /pa /all /v" in smoke
    assert "Get-AuthenticodeSignature" in smoke
    assert "TimeStamperCertificate" in smoke
    assert smoke.count("signtool.FullName sign") == 1
    assert smoke.count("signtool.FullName verify") == 1
    assert smoke.count("Get-AuthenticodeSignature") == 1
    assert smoke.count("TimeStamperCertificate") == 1
    assert smoke.count("try {") == 1
    assert smoke.count("finally {") == 1
    assert "} } |" not in smoke
    assert smoke.rstrip().endswith("}")

def test_windows_visual_qa_covers_all_release_dpi_scales():
    workflow = _yaml(_VISUAL_QA)
    visual = workflow["jobs"]["visual"]

    matrix = visual["strategy"]["matrix"]["include"]
    assert {(str(item["scale"]), item["scale_label"]) for item in matrix} == {
        ("1", "100%"),
        ("1.25", "125%"),
        ("1.5", "150%"),
        ("2", "200%"),
    }
    assert visual["runs-on"] == "windows-latest"

    names = {step.get("name") for step in visual.get("steps", [])}
    assert "Build desktop" in names
    assert "Run Agent OS Windows visual QA" in names
    assert "Upload Windows visual evidence" in names
