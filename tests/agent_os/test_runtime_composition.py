from __future__ import annotations

import pytest

from agent_os.adapters.hermes_planner import PlannerCapabilities
from agent_os.kernel import AgentOSKernel, ExecutionResult
from agent_os.orchestration.plan import InvalidPlan, PlanStepKind
from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.runtime import AgentOSRuntime
from agent_os.states import TaskState
from agent_os.store import AgentOSStore
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class StaticPlanner:
    def __init__(self, proposal, capabilities=None):
        self.proposal = proposal
        if capabilities is not None:
            self.capabilities = capabilities

    def plan(self, task):
        return self.proposal


class PassExecutor:
    def execute(self, action):
        return ExecutionResult({"ok": True, "operation": action.operation})


class PassVerifier:
    def verify(self, action, actual_state):
        return VerificationResult(
            VerificationVerdict.PASSED,
            "runtime-fixture",
            {"actual_state": actual_state},
        )


def kernel(store):
    return AgentOSKernel(
        store,
        executor=PassExecutor(),
        verifier=PassVerifier(),
    )


def proposal(tool="fixture"):
    return PlanProposal(
        objective="work then verify",
        steps=(
            ProposedStep(
                "work",
                "Work",
                PlanStepKind.ACTION,
                spec={"tool": tool, "operation": "do work"},
            ),
            ProposedStep(
                "verify",
                "Verify",
                PlanStepKind.VERIFICATION,
                spec={"tool": tool, "operation": "verify work"},
                depends_on=("work",),
            ),
        ),
    )


def test_runtime_uses_one_capability_registry_for_compile_and_execute(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = AgentOSRuntime(
        store,
        planner=StaticPlanner(
            proposal(),
            PlannerCapabilities.create(action_tools=("fixture",)),
        ),
        action_kernels={"fixture": kernel(store)},
        scheduler_owner_id="test-runtime",
    )

    submission = runtime.submit_goal("complete verified work")
    results = runtime.run_until_idle(submission.plan.id)

    assert runtime.status().action_tools == ("fixture",)
    assert results
    assert store.get_task(submission.task.id).state is TaskState.COMPLETED


def test_runtime_rejects_planner_capability_drift_at_startup(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")

    with pytest.raises(ValueError, match="does not match runtime"):
        AgentOSRuntime(
            store,
            planner=StaticPlanner(
                proposal(),
                PlannerCapabilities.create(action_tools=("imaginary",)),
            ),
            action_kernels={"fixture": kernel(store)},
        )


def test_runtime_compiler_rejects_unregistered_tool_even_without_planner_manifest(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = AgentOSRuntime(
        store,
        planner=StaticPlanner(proposal(tool="imaginary")),
        action_kernels={"fixture": kernel(store)},
    )

    with pytest.raises(InvalidPlan, match="unavailable action tool"):
        runtime.submit_goal("try unavailable tool")



def test_runtime_submit_goal_preserves_desktop_context(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    runtime = AgentOSRuntime(
        store,
        planner=StaticPlanner(
            proposal(),
            PlannerCapabilities.create(action_tools=("fixture",)),
        ),
        action_kernels={"fixture": kernel(store)},
        scheduler_owner_id="mission-control-test",
    )

    submission = runtime.submit_goal(
        "work in the selected desktop context",
        workspace_id=r"C:\work\project",
        session_id="session-123",
        metadata={"source": "mission-control"},
    )

    persisted = store.get_task(submission.task.id)
    assert persisted is not None
    assert persisted.workspace_id == r"C:\work\project"
    assert persisted.session_id == "session-123"
    assert persisted.metadata["source"] == "mission-control"
