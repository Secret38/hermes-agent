---
sidebar_position: 3
title: Agent OS
---

# Agent OS on Windows

Agent OS is Hermes' durable execution and desktop-automation layer. The V1 runtime combines durable task state, verification-gated execution, recovery, multi-agent orchestration, browser automation, and native computer use.

## Production installation

Use the signed `Hermes-Setup.exe` attached to an `agent-os-v*` GitHub Release. Do not treat unsigned pull-request artifacts or a branch checkout as a production installer.

After installation, open PowerShell and verify the complete automation substrate:

```powershell
hermes agent-os status --require-full --require-production-security
```

A production-ready Windows installation reports the Agent OS core, full automation and production security as ready. Full readiness requires the durable store, browser runtime, and native computer-use runtime to be healthy. Production security additionally checks the approval policy and a working scanner.

The Agent OS fork's Windows desktop installer provisions these runtimes and applies the production security profile before marking installation complete. That profile requires manual approvals for host mutations, denies unattended approvals, and refuses execution when the scanner is unavailable. A plain CLI installation does not apply this profile automatically.

The bootstrap installer needs network access to obtain missing dependencies. An explicit `-SkipBrowser` opt-out is preserved; if no browser is already available, the desktop readiness check fails instead of reporting a complete Agent OS installation.

For machine-readable diagnostics:

```powershell
hermes agent-os status --require-full --require-production-security --json
```

## Repair and provisioning

The read-only status command never installs external runtimes. To explicitly install or repair the browser and computer-use substrate:

```powershell
hermes agent-os provision --production-security
```

Then re-run:

```powershell
hermes agent-os status --require-full --require-production-security
```

For local state diagnosis and safe store repair:

```powershell
hermes agent-os doctor
hermes agent-os doctor --fix
```

`doctor --fix` may create or migrate the local Agent OS durable store. It does not silently install the browser or computer-use runtime.

## Windows desktop requirement

Native computer use requires an interactive Windows desktop. A process isolated in Session 0 cannot directly drive the desktop. The production release qualification therefore runs on a self-hosted Windows runner attached to a logged-in interactive session.

If computer use is installed but full readiness is degraded, run:

```powershell
hermes agent-os status --require-full --json
```

and inspect the computer-use readiness details before reprovisioning.

## V1 qualification contract

Every production `agent-os-v*` release is designed to be blocked unless the tagged source proves all of the following on Windows:

- clean production-path installation;
- full Agent OS readiness;
- native Windows application launch and UI operation;
- all 20 canonical Agent OS Golden Tasks;
- repair/reinstall idempotency;
- durable Agent OS state preservation across repair;
- full uninstall with no isolated install state left behind;
- valid Authenticode signature and trusted timestamp.

The release publishes the installer together with SHA-256 and qualification evidence. Verify `SHA256SUMS.txt` before distributing the binary.

## Development checkout

The production release workflow currently targets `agent-os-v1`. The ongoing integration candidate is `agent-os-v1-release-candidate`; fixes in open review branches must still be reviewed and integrated before a release. A branch checkout is useful for development and validation, but is not a substitute for a signed `agent-os-v*` release.

Developers can inspect the runtime with:

```powershell
hermes agent-os status --json
python scripts/agent_os_golden.py --json
```

The canonical Golden Task manifest lives at `evals/agent_os/golden_tasks.json`.
