from __future__ import annotations

import argparse
import json

from agent_os.health import AgentOSHealthReport, HealthCheck, HealthStatus
from hermes_cli.subcommands import agent_os as cli


def _args(argv):
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command")
    cli.build_agent_os_parser(subparsers)
    return parser.parse_args(argv)


def _report(*, core=True, full=True):
    checks = (
        HealthCheck(
            "runtime_core",
            HealthStatus.PASS if core else HealthStatus.FAIL,
            "runtime",
            required_for_core=True,
            required_for_full=True,
        ),
        HealthCheck(
            "browser",
            HealthStatus.PASS if full else HealthStatus.FAIL,
            "browser",
            required_for_full=True,
            remediation=None if full else "install browser",
        ),
    )
    return AgentOSHealthReport(
        platform="test",
        store_path="/tmp/agent_os.db",
        core_ready=core,
        full_ready=full and core,
        checks=checks,
    )


def test_status_json_is_machine_readable_and_core_gated(monkeypatch, capsys):
    monkeypatch.setattr(cli, "_collect", lambda fix: _report(core=True, full=False))

    args = _args(["agent-os", "status", "--json"])
    rc = args.func(args)

    payload = json.loads(capsys.readouterr().out)
    assert rc == 0
    assert payload["core_ready"] is True
    assert payload["full_ready"] is False


def test_status_require_full_fails_when_optional_runtime_missing(monkeypatch):
    monkeypatch.setattr(cli, "_collect", lambda fix: _report(core=True, full=False))

    args = _args(["agent-os", "status", "--require-full"])

    assert args.func(args) == 1


def test_doctor_fix_passes_mutation_flag_to_health_contract(monkeypatch, capsys):
    seen = {}

    def collect(*, fix):
        seen["fix"] = fix
        return _report(core=True, full=True)

    monkeypatch.setattr(cli, "_collect", collect)

    args = _args(["agent-os", "doctor", "--fix", "--require-full", "--json"])
    rc = args.func(args)

    assert rc == 0
    assert seen["fix"] is True
    assert json.loads(capsys.readouterr().out)["full_ready"] is True


def test_status_never_requests_store_repair(monkeypatch):
    seen = {}

    def collect(*, fix):
        seen["fix"] = fix
        return _report()

    monkeypatch.setattr(cli, "_collect", collect)

    args = _args(["agent-os", "status"])
    assert args.func(args) == 0
    assert seen["fix"] is False


def test_agent_os_without_action_prints_help_and_fails(capsys):
    args = _args(["agent-os"])

    assert args.func(args) == 2
    assert "agent-os" in capsys.readouterr().out


def test_provision_exit_code_comes_from_verified_provision_report(monkeypatch, capsys):
    from types import SimpleNamespace
    import agent_os.provisioning as provision

    report = SimpleNamespace(
        components=(SimpleNamespace(name="browser", ready=True, detail="ready"),),
        health=_report(core=True, full=True),
        success=True,
    )
    monkeypatch.setattr(provision, "provision_agent_os_runtime", lambda **kwargs: report)

    args = _args(["agent-os", "provision"])
    assert args.func(args) == 0
    assert "[OK] browser" in capsys.readouterr().out
