# Agent OS production security baseline

This baseline is the minimum policy for a production Agent OS deployment that
can receive untrusted remote or web-derived content. It complements command
parsing and hardline safety floors; it does not replace them.

## Required approval posture

```yaml
approvals:
  mode: manual
  cron_mode: deny
  single_query_mode: deny
  unattended_mode: deny
  confirm_host_mutations: true

security:
  tirith_enabled: true
  tirith_fail_open: false
```

The release-critical policy decisions are:

1. `approvals.mode: manual` — dangerous-but-recoverable commands require a
   human decision. Do not use `off` for production remote/content-driven
   agents.
2. `approvals.cron_mode: deny` — scheduled work has no interactive approver
   and must fail closed on flagged actions.
3. `approvals.single_query_mode: deny` — one-shot `-q` work must not
   auto-approve a flagged action merely because no human approval UI exists.
4. `approvals.unattended_mode: deny` — webhook, MS Graph webhook and API
   server sessions fail closed when an action needs approval.
5. `approvals.confirm_host_mutations: true` — host shell commands and
   high-impact host/persistent mutation tools cross an exact, one-shot human
   consent boundary. Session allowlists, `/yolo` and `approvals.mode: off`
   do not bypass this production floor.
6. `security.tirith_fail_open: false` — when Tirith scanning is enabled but
   unavailable or errors, the scanner failure must not become permission to
   execute.
7. **No `SUDO_PASSWORD` in the Agent process environment** — production must
   not preload a reusable sudo password for model-driven shell execution.
   Legitimate elevation should cross an explicit human approval/authentication
   boundary instead of turning sudo into a stored capability.

Keep `security.tirith_enabled: true`. Production readiness requires the
configured Tirith process to pass a bounded `tirith --version` health probe;
a configuration value or supported release target alone is not sufficient.
Agent OS provisioning installs the verified upstream Tirith release
synchronously when needed. Native Windows x64 releases use
`tirith-x86_64-pc-windows-msvc.zip` and install as
`$HERMES_HOME/bin/tirith.exe`; an explicit locally built scanner path remains
valid on platforms without an official auto-install target.

## Why parser hardening is still required

Pattern classifiers are defense-in-depth, not the production authority
boundary. Arbitrary shell is an interpreter boundary: variable-expanded
command names, nested shell evaluation, privilege escalation and data-flow
pipelines cannot be made safe by a flat list of destructive command spellings.
With `confirm_host_mutations: true`, even commands that produce no classifier
finding still require exact one-shot consent before host execution.

The Agent OS release branch therefore also enforces structural floors for:

- dynamic executable expansion in command position,
- system password-hash reads,
- environment/secret streams sent to stdin-consuming network clients,
- explicit sudo privilege boundaries.

Hardline confidentiality/ambiguity floors remain non-bypassable. Recoverable
host commands use the exact production consent gate. `execute_code` is also
one-shot because Python can mutate files, spawn processes, or use the network
without passing through terminal command parsing. High-impact non-shell tools
such as file writes, process/cron mutation, outbound messaging, memory/skill
mutation, and Computer Use are routed through the same exact production
authority boundary.

## Remote-channel rule

Treat messaging, webhook and scraped web content as untrusted instructions.
A channel being paired or authenticated establishes who may send a message;
it does not make message contents safe shell input. Keep remote agents on the
smallest practical tool/capability set and require an interactive approval
path for host-terminal privilege.

## Release gate

Production qualification must verify these resolved values from the exact
installed profile before enabling remote channels. A release is not considered
production-ready when any unattended mode is set to `approve`, the global
approval mode is `off`, Tirith is configured fail-open, or `SUDO_PASSWORD`
is present in the Agent environment.