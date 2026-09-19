# Hermes OS desktop plugin

This bundled plugin is the upgrade-safe shell for the Hermes OS control plane.

## V1 boundaries

- Hermes remains the agent runtime.
- Hermes Kanban remains task source of truth.
- Hermes sessions remain conversation/run source data.
- Hermes Projects remain workspace source of truth.
- The plugin adds operational projections and UI; it does not introduce a second agent/task/session store.

## Routes

- `/hermes-os` — Mission Control
- `/hermes-os/attention` — What Needs Me
- `/hermes-os/projects` — Projects
- `/hermes-os/fleet` — Fleet
- `/hermes-os/timeline` — Timeline
- `/hermes-os/security` — Security

The bundled plugin loader discovers `plugin.tsx` automatically through the existing `src/plugins/*/plugin.{js,ts,tsx}` glob.

## Next slice

Connect existing Hermes authorities through read-only adapters/selectors:

1. Fleet: profiles + fleet roster + subagents.
2. Work: Kanban board/tasks/runs.
3. Projects: projects + goals + workspace ownership.
4. Attention: approvals, blockers, failures, questions, and security requests.
5. Timeline: durable operational events and run spans.
