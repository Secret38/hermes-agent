"""Agent OS production status and doctor CLI."""

from __future__ import annotations

import json

from hermes_cli.subcommands._shared import add_json_flag


def _collect(*, fix: bool):
    from agent_os.health import collect_agent_os_health

    return collect_agent_os_health(fix=fix)


def _render_human(report) -> None:
    print(f"Agent OS core: {'READY' if report.core_ready else 'NOT READY'}")
    print(f"Full automation: {'READY' if report.full_ready else 'DEGRADED'}")
    print(
        "Production security: "
        f"{'READY' if report.production_security_ready else 'NOT READY'}"
    )
    print(f"Store: {report.store_path}")
    print("")
    for check in report.checks:
        glyph = {
            "PASS": "OK",
            "WARN": "WARN",
            "FAIL": "FAIL",
        }.get(check.status.value, check.status.value)
        print(f"[{glyph}] {check.name}: {check.detail}")
        if check.remediation and check.status.value != "PASS":
            print(f"       Fix: {check.remediation}")


def _run_health(args, *, fix: bool) -> int:
    report = _collect(fix=fix)
    if bool(getattr(args, "json", False)):
        print(json.dumps(report.to_dict(), indent=2, sort_keys=True))
    else:
        _render_human(report)

    require_full = bool(getattr(args, "require_full", False))
    require_production_security = bool(
        getattr(args, "require_production_security", False)
    )
    ready = report.full_ready if require_full else report.core_ready
    if require_production_security:
        ready = ready and report.production_security_ready
    return 0 if ready else 1


def _status(args) -> int:
    return _run_health(args, fix=False)


def _doctor(args) -> int:
    return _run_health(args, fix=bool(getattr(args, "fix", False)))


def _provision(args) -> int:
    from agent_os.provisioning import provision_agent_os_runtime

    report = provision_agent_os_runtime(
        include_browser=not bool(getattr(args, "skip_browser", False)),
        include_computer_use=not bool(getattr(args, "skip_computer_use", False)),
        include_production_security=bool(
            getattr(args, "production_security", False)
        ),
    )
    for component in report.components:
        state = "OK" if component.ready else "FAIL"
        suffix = f": {component.detail}" if component.detail else ""
        print(f"[{state}] {component.name}{suffix}")
    print("")
    _render_human(report.health)
    return 0 if report.success else 1


def _add_common_flags(parser) -> None:
    add_json_flag(parser, "Emit the machine-readable Agent OS health report.")
    parser.add_argument(
        "--require-full",
        action="store_true",
        help=(
            "Fail unless the complete desktop automation substrate is ready "
            "(core + browser + computer use)."
        ),
    )
    parser.add_argument(
        "--require-production-security",
        action="store_true",
        help=(
            "Fail unless approval and scanner policy is fail-closed for "
            "remote/content-driven production use."
        ),
    )


def build_agent_os_parser(subparsers) -> None:
    """Attach the agent-os production-runtime management group."""

    parser = subparsers.add_parser(
        "agent-os",
        help="Inspect and repair the Agent OS production runtime",
        description=(
            "Check Agent OS durable-state, browser and computer-use readiness. "
            "Status is read-only. Doctor --fix may create or migrate only the "
            "local Agent OS store; external runtimes are never silently installed."
        ),
    )
    actions = parser.add_subparsers(dest="agent_os_action")

    status = actions.add_parser(
        "status",
        help="Read-only Agent OS readiness check",
    )
    _add_common_flags(status)
    status.set_defaults(func=_status)

    doctor = actions.add_parser(
        "doctor",
        help="Diagnose Agent OS readiness and optionally repair local state",
    )
    _add_common_flags(doctor)
    doctor.add_argument(
        "--fix",
        action="store_true",
        help="Create/migrate the local Agent OS durable store and verify integrity.",
    )
    doctor.set_defaults(func=_doctor)

    provision = actions.add_parser(
        "provision",
        help="Explicitly install/repair the Agent OS automation substrate",
        description=(
            "Provision browser and computer-use runtimes through Hermes' existing "
            "installers, then verify actual readiness. This command may download "
            "runtime dependencies and is intentionally never run by status/doctor."
        ),
    )
    provision.add_argument(
        "--skip-browser",
        action="store_true",
        help="Do not provision or require the browser runtime.",
    )
    provision.add_argument(
        "--skip-computer-use",
        action="store_true",
        help="Do not provision or require the computer-use runtime.",
    )
    provision.add_argument(
        "--production-security",
        action="store_true",
        help=(
            "Apply the Agent OS fail-closed production profile and provision "
            "the Tirith scanner. Ordinary Hermes installs are unchanged."
        ),
    )
    provision.set_defaults(func=_provision)

    def _show_help(_args):
        parser.print_help()
        return 2

    parser.set_defaults(func=_show_help)
