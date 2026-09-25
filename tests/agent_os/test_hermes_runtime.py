from __future__ import annotations

from agent_os.capabilities import CapabilityCatalog
from agent_os.hermes_runtime import build_hermes_agent_os_runtime
from agent_os.orchestration.plan import PlanStepKind
from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.store import AgentOSStore


class NoopCheckpoint:
    def create_checkpoint(self, action):
        return None

    def rollback(self, checkpoint_id):
        return False


class StaticPlanner:
    def __init__(self, capabilities):
        self.capabilities = capabilities

    def plan(self, task):
        return PlanProposal(
            objective="inspect and verify",
            steps=(
                ProposedStep(
                    "inspect",
                    "Inspect",
                    PlanStepKind.ACTION,
                    spec={
                        "tool": "terminal",
                        "operation": "read status",
                        "input": {"command": "printf ok"},
                        "expected_state": {"exit_code": 0, "output_contains": "ok"},
                    },
                ),
                ProposedStep(
                    "verify",
                    "Verify",
                    PlanStepKind.VERIFICATION,
                    spec={
                        "tool": "terminal",
                        "operation": "read status",
                        "input": {"command": "printf ok"},
                        "expected_state": {"exit_code": 0, "output_contains": "ok"},
                    },
                    depends_on=("inspect",),
                ),
            ),
        )


def test_concrete_runtime_exposes_only_assembled_capabilities(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    capabilities = CapabilityCatalog.create(action_tools=("terminal", "file"))
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=StaticPlanner(capabilities),
        host_local_terminal=True,
        checkpoint_provider=NoopCheckpoint(),
        enable_browser=False,
        enable_computer_use=False,
    )

    assert runtime.status().action_tools == ("file", "terminal")
    assert runtime.status().agent_runtimes == ()


def test_concrete_runtime_adds_subagent_capability_when_service_present(tmp_path):
    class Service:
        pass

    capabilities = CapabilityCatalog.create(
        action_tools=("terminal", "file"),
        agent_runtimes=("hermes-subagent",),
    )
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=StaticPlanner(capabilities),
        subagent_service=Service(),
        checkpoint_provider=NoopCheckpoint(),
        enable_browser=False,
        enable_computer_use=False,
    )

    assert runtime.status().agent_runtimes == ("hermes-subagent",)


def test_concrete_runtime_rejects_planner_capability_drift(tmp_path):
    capabilities = CapabilityCatalog.create(action_tools=("terminal",))
    store = AgentOSStore(tmp_path / "agent_os.db")

    try:
        build_hermes_agent_os_runtime(
            store,
            planner=StaticPlanner(capabilities),
            checkpoint_provider=NoopCheckpoint(),
            enable_browser=False,
            enable_computer_use=False,
        )
    except ValueError as exc:
        assert "does not match runtime" in str(exc)
    else:
        raise AssertionError("capability drift must fail closed")


def test_concrete_runtime_can_expose_browser_capability_explicitly(tmp_path):
    capabilities = CapabilityCatalog.create(
        action_tools=("terminal", "file", "browser"),
    )
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=StaticPlanner(capabilities),
        checkpoint_provider=NoopCheckpoint(),
        enable_browser=True,
        enable_computer_use=False,
    )

    assert runtime.status().action_tools == ("browser", "file", "terminal")


def test_concrete_runtime_can_expose_computer_use_capability_explicitly(tmp_path):
    capabilities = CapabilityCatalog.create(
        action_tools=("terminal", "file", "computer_use"),
    )
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = build_hermes_agent_os_runtime(
        store,
        planner=StaticPlanner(capabilities),
        checkpoint_provider=NoopCheckpoint(),
        enable_browser=False,
        enable_computer_use=True,
    )

    assert runtime.status().action_tools == ("computer_use", "file", "terminal")
