---
title: Agent OS V1 release runbook
---

# Agent OS V1 release runbook

This runbook is the operator contract for publishing a production `agent-os-v*` Windows release.

## Release invariants

A release is publishable only when the tag points to the current `agent-os-v1` head and the release workflow completes its immutable build, interactive Windows qualification, code signing, and evidence publication.

Never reuse or move a published release tag. If a candidate is invalid, fix the branch and publish a new version.

## Automated operator path

The repository includes two fail-closed Windows PowerShell entry points for the production path:

```powershell
.\scripts\agent_os_release_setup.ps1 -PfxPath C:\secure\agent-os-code-signing.pfx
.\scripts\agent_os_release_publish.ps1 -Version 1.0.0
```

Run the setup script from a logged-in Windows desktop using the repository owner's GitHub account. It configures the release-branch protection, immutable `agent-os-v*` tag rules, encrypted signing secrets, and an interactive `agent-os-gui` self-hosted runner. It deliberately does not install the runner as a Windows service because service runners execute in Session 0.

The publish script refuses to create a tag unless the protected-source policy, required CI, signing secrets, interactive runner, and **Agent OS Release Preflight** have all passed. After tagging, it watches the production workflow and verifies the required release assets before reporting success.

The detailed sections below describe the same gates individually for audit and recovery.

## 1. Require a green candidate

Before tagging, require the current `agent-os-v1` head to pass the repository CI and the **Agent OS Windows Installer Candidate** workflow. In particular, do not tag while required checks are pending, cancelled, or failing.

The candidate workflow must successfully build the pinned `Hermes-Setup.exe` from the exact head SHA.

## 2. Prepare the interactive Windows qualification runner

Register a self-hosted GitHub Actions runner with all of these labels:

- `self-hosted`
- `windows`
- `x64`
- `agent-os-gui`

Start the runner from a logged-in interactive Windows desktop. Session 0 is not valid for release qualification.

Keep the qualification machine free of stale Agent OS test state. The release workflow creates an isolated `HERMES_HOME`, but the host must still provide a usable interactive desktop and normal access to Git, PowerShell, Node/npm, Python tooling installed by the bootstrap path, and the network resources required by provisioning.

## 3. Configure signing secrets

Set these repository Actions secrets:

- `WINDOWS_CODE_SIGN_PFX_B64`: base64-encoded PFX containing the production code-signing certificate and private key.
- `WINDOWS_CODE_SIGN_PASSWORD`: PFX password.

The certificate must be inside its validity period, contain the Code Signing EKU (`1.3.6.1.5.5.7.3.3`), and support Authenticode signing.

## 4. Run Agent OS Release Preflight

Manually run **Agent OS Release Preflight**.

Do not create a release tag until both preflight jobs pass:

1. the GUI runner proves it is in an interactive Windows session and has the required tools;
2. the signing job proves the PFX is readable, contains a private key, is time-valid, and has the Code Signing EKU.

## 5. Protect the release source

Before a public V1 release, repository settings should prevent accidental publication from unreviewed source:

- protect `agent-os-v1` against force-pushes and direct destructive updates;
- require the repository CI and Windows installer candidate checks before changes are accepted;
- restrict creation or update of `agent-os-v*` tags to release operators.

These controls are repository settings, not code. The Agent OS preflight and production release workflow both read the GitHub branch metadata and fail closed unless `agent-os-v1` reports `protected=true`; the release operator must configure that protection before continuing.

## 6. Create the version tag at the exact branch head

Fetch the latest branch and record its SHA:

```bash
git fetch origin agent-os-v1
git rev-parse origin/agent-os-v1
```

Create the release tag at that exact SHA, for example:

```bash
git tag agent-os-v1.0.0 <HEAD_SHA>
git push origin agent-os-v1.0.0
```

Pushing the tag starts **Agent OS Release**. The workflow independently verifies that the tagged commit is still the current `agent-os-v1` head.

## 7. Qualification performed by the release workflow

The release workflow must complete all of these gates:

1. Build an immutable unsigned `Hermes-Setup.exe` from the tagged SHA.
2. Download that exact build artifact onto the interactive Windows runner and verify its repository, commit, tag and SHA-256 identity.
3. Launch that exact `Hermes-Setup.exe` as a headed GUI, drive the real **Install → Launch** flow, and require a real `Hermes.exe` desktop process.
4. Require `hermes agent-os status --require-full --json`.
5. Run native Windows Golden E2E for GT-12 and GT-13.
6. Run the canonical Agent OS Golden runner and prove 20/20.
7. Seed durable Agent OS state.
8. Re-run the production installer as a repair/idempotency gate.
9. Prove the durable state survived repair.
10. Run full uninstall and prove the isolated install root and `HERMES_HOME` are removed.
11. Verify build and qualification evidence refer to the same commit and tag.
12. Authenticode-sign the exact qualified installer.
13. Verify the signature with Windows trust policy and require a trusted timestamp countersignature.
14. Publish the GitHub Release and its qualification evidence.

If any gate fails, there must be no production release.

## 8. Verify the published release

The GitHub Release should contain:

- `Hermes-Setup.exe`
- `SHA256SUMS.txt`
- `build-metadata.json`
- `source-build-metadata.json`
- `agent-os-health.json`
- `agent-os-repair-health.json`
- `agent-os-golden-results.json`
- `qualification-metadata.json`

On a clean Windows machine, verify the checksum and Authenticode signature before installation:

```powershell
Get-FileHash -Algorithm SHA256 .\Hermes-Setup.exe
Get-AuthenticodeSignature .\Hermes-Setup.exe | Format-List
```

After installation:

```powershell
hermes agent-os status --require-full
```

## 9. Failure handling

Do not repair a failed release by replacing assets under an existing release tag. Fix the branch, re-run candidate CI and preflight, and publish a new version tag.

A release is considered production-qualified only when the release workflow itself succeeds and the published evidence matches its tag and commit.
