# Hermes OS desktop plugin

This bundled plugin is the upgrade-safe control-plane layer for Hermes Desktop.

## Authority rules

Hermes OS is a projection and coordination UI. It does not create parallel runtime state.

| Domain | Authority |
| --- | --- |
| Conversations / durable session identity | Hermes sessions |
| Live primary session state | Hermes Desktop session stores |
| Resident gateway sessions | Core `session.active_list` background-sync snapshot |
| Ephemeral delegated agents | `$subagentsBySession` |
| Tasks / workflow state / attempts | Hermes Kanban |
| Projects / workspace membership | Hermes Projects |
| Goals | Hermes per-session Goals |
| Files / terminal / browser / review | Existing Desktop workspace panes |
| Approval prompts | Existing Desktop prompt stores + gateway approval queue |
| Computer Use security | `config.get computer_use.security` |
| Hermes shared metrics posture | `config.get telemetry.security` |

Do not infer one authority from another when an exact binding is absent.

Examples:
- A historical session row is not proof that a runtime is resident.
- A project path/name match is not project membership.
- A task origin session is not its current worker session.
- A stdio MCP process is not proof of offline execution.
- Disabled Hermes telemetry is not proof that model providers, MCP servers, browsers, updates, or tools make no network connections.

## Project Workspace

A project selects one authoritative Hermes session as its workspace context.

The Project inspector composes the existing Desktop surfaces:

- Chat
- Plan
- Files
- Changes
- Browser
- Terminal
- Usage

Workspace-derived panes never guess a cwd. Files, Changes, and Terminal wait until the target session is the primary selected session, owns `$workspaceCwdOwner`, and has a non-empty `$currentCwd`. Resume failure aborts the launch.

Plan is read-only:
- live goals come from `$goalsBySession`
- runtime goal owners are resolved to durable session identity
- compression lineages are respected
- task state remains owned by the operations/Kanban source
- dormant sessions are not background-hydrated merely to populate Plan

## Fleet

Fleet keeps three identities separate:

1. resident gateway sessions
2. ephemeral `delegate_task` subagents
3. dispatcher-spawned Kanban worker sessions

Desktop Core already performs the authoritative `session.active_list` safety-net refresh. That response is published to a shared renderer store keyed by exact `connectionId + profile`; Hermes OS never polls `session.active_list` itself.

Subagent details come from Hermes' event-driven `$subagentsBySession` store. Fleet links to the canonical Agents surface for the detailed stream/file inspector instead of duplicating it.

## Security / privacy

Security surfaces only narrow, sanitized authorities.

`computer_use.security` exposes:
- permission mode
- cua-driver telemetry state
- manifest configured/readable/version/mode-independence/required facts

It does not expose manifest paths or contents.

`telemetry.security` exposes:
- shared-metrics collection enabled
- transmission requested
- effective transmission enabled
- destination class: `nous | loopback | custom_https | blocked`

It never returns the raw endpoint and performs no network probe.

The OSV supply-chain audit remains explicit/on-demand because running it performs external OSV requests.

Approval history is not synthesized from transient UI state. A durable audit timeline must wait for a durable backend authority.

## Routes

- `/hermes-os` — Mission Control
- `/hermes-os/attention` — What Needs Me
- `/hermes-os/projects` — Projects
- `/hermes-os/fleet` — Fleet
- `/hermes-os/timeline` — Timeline
- `/hermes-os/security` — Security

The bundled plugin loader discovers `plugin.tsx` through the existing `src/plugins/*/plugin.{js,ts,tsx}` glob.

## Next safe slices

1. Resolve current-head CI findings.
2. Add durable approval/audit history only after a backend source exists.
3. Add outbound-network inventory only from exact sanitized runtime/config authorities; keep unknowns explicit.
4. Add project-scoped autonomy/capability policy only after Hermes exposes a real scoped policy authority.
