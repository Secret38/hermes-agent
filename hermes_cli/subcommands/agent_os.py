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
    ready = report.full_ready if require_full else report.core_ready
    return 0 if ready else 1


def _status(args) -> int:
    return _run_health(args, fix=False)


def _doctor(args) -> int:
    return _run_health(args, fix=bool(getattr(args, "fix", False)))


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

    def _show_help(_args):
        parser.print_help()
        return 2

    parser.set_defaults(func=_show_help)
