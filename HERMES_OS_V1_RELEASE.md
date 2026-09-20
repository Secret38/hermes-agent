# Hermes OS v1.0.0

Hermes OS V1 is the native control-plane/workstation layer built directly into
Hermes. Hermes remains the execution kernel and source of truth for sessions,
tasks, runs, projects, approvals, tools, runtimes, scheduling, and memory.
Hermes OS composes those authorities into one operator surface instead of
creating a second orchestrator.

## V1 operator surfaces

- Mission Control with restart-safe canonical workflow state.
- Mission capture into producer-owned Kanban triage.
- AI-assisted plan shaping with a backend-enforced human execution gate.
- Dependency-safe plan approval: only currently eligible start nodes are
  promoted; downstream work continues through Kanban's existing dependency
  engine.
- What Needs Me aggregation from real Hermes human-gate and task authorities.
- Project workspace projection over Hermes Projects and sessions.
- Fleet and execution inspection using real session/run/subagent identities.
- Durable metadata-only Timeline with project/task/run/session correlation.
- Security and telemetry provenance without duplicating secrets or sensitive
  prompt/tool payloads.
- Hermes native emergency-stop controls for new work.

## Windows installation

For the published V1 release, open PowerShell and run:

    iex (irm https://raw.githubusercontent.com/Secret38/hermes-agent/main/scripts/install-hermes-os.ps1)

The bootstrap pins the distribution repository to
`https://github.com/Secret38/hermes-agent.git`, installs the Hermes runtime,
builds the Desktop application, and creates Windows shortcuts.

Default Windows state:

    %LOCALAPPDATA%\hermes

Managed source checkout:

    %LOCALAPPDATA%\hermes\hermes-agent

## Release qualification

The V1 release is published only by
`.github/workflows/hermes-os-v1-release.yml` after all of these gates pass on
the exact release commit:

- complete Python test and E2E workflows;
- complete JavaScript/TypeScript workspace checks;
- macOS- and Windows-native marked tests;
- Windows PowerShell 5.1 and PowerShell 7 installer contracts;
- real Electron Desktop E2E;
- Windows x64 and ARM64 distribution builds;
- x64 packaged `Hermes.exe` startup smoke;
- SHA-256 generation for every published Windows artifact.

Published artifacts include NSIS installers, MSI installers, portable ZIPs,
`SHA256SUMS.txt`, and `BUILD-METADATA.json`.

## Security and data ownership

The durable Hermes OS audit ledger stores identifiers and normalized lifecycle
facts only. It does not copy prompt bodies, command text, secrets, verification
codes, tool output, task bodies, run summaries/errors, URLs, or artifact
contents.

Kanban remains authoritative for task/run state and dependency execution.
Hermes Sessions remain authoritative for conversations and agent execution.
Hermes Projects remain authoritative for project/workspace identity. Existing
approval and secret surfaces remain authoritative for sensitive human input.

## Update and recovery

Managed installs retain the existing Hermes update and rollback behavior.
Installer updates preserve local changes via git stash rather than silently
discarding them. The Desktop packaging path preserves the previous working
Windows unpacked build as rollback material while a replacement is produced.

## Version

Product: Hermes OS
Release: 1.0.0

The release tag is `v1.0.0` and is created only after the production release
gate succeeds.
