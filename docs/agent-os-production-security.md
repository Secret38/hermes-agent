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

security:
  tirith_enabled: true
  tirith_fail_open: false
```

The five release-critical policy decisions are:

1. `approvals.mode: manual` — dangerous-but-recoverable commands require a
   human decision. Do not use `off` for production remote/content-driven
   agents.
2. `approvals.cron_mode: deny` — scheduled work has no interactive approver
   and must fail closed on flagged actions.
3. `approvals.single_query_mode: deny` — one-shot `-q` work must not
   auto-approve a flagged action merely because no human approval UI exists.
4. `approvals.unattended_mode: deny` — webhook, MS Graph webhook and API
   server sessions fail closed when an action needs approval.
5. `security.tirith_fail_open: false` — when Tirith scanning is enabled but
   unavailable or errors, the scanner failure must not become permission to
   execute.

Keep `security.tirith_enabled: true` unless the deployment has an equivalent
independent scanner. The setting is listed separately because the critical
policy decision above is fail-closed behavior when the scanner path fails.

## Why parser hardening is still required

Approval settings only govern actions the classifier recognizes. Arbitrary
shell is an interpreter boundary: variable-expanded command names, nested
shell evaluation, privilege escalation and data-flow pipelines cannot be made
safe by a flat list of destructive command spellings.

The Agent OS release branch therefore also enforces structural floors for:

- dynamic executable expansion in command position,
- system password-hash reads,
- environment/secret streams sent to stdin-consuming network clients,
- explicit sudo privilege boundaries.

Hardline confidentiality/ambiguity floors are non-bypassable. Sudo itself
uses the normal human approval gate so an operator can authorize a legitimate
administrative action.

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
approval mode is `off`, or Tirith is configured fail-open.
