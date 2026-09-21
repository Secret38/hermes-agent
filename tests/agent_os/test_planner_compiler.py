from __future__ import annotations

import pytest

from agent_os.contracts import TaskRecord
from agent_os.orchestration.goal_orchestrator import GoalOrchestrator
from agent_os.orchestration.plan import InvalidPlan, PlanState, PlanStepKind
from agent_os.orchestration.planner import PlanCompiler, PlanProposal, ProposedStep
from agent_os.states import TaskState
from agent_os.store import AgentOSStore


class StaticPlanner:
    def __init__(self, proposal):
        self.proposal = proposal

    def plan(self, task):
        return self.proposal


def valid_proposal():
    return PlanProposal(
        objective="build and verify",
        steps=(
            ProposedStep(
                key="build",
                title="Build project",
                kind=PlanStepKind.ACTION,
                spec={"tool": "terminal", "operation": "build"},
            ),
            ProposedStep(
                key="verify",
                title="Verify result",
                kind=PlanStepKind.VERIFICATION,
                spec={"tool": "terminal", "operation": "verify"},
                depends_on=("build",),
            ),
        ),
    )


def test_compiler_rejects_plan_without_verification(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("no false done"))
    proposal = PlanProposal(
        objective="unsafe",
        steps=(
            ProposedStep(
                key="work",
                title="Work",
                kind=PlanStepKind.ACTION,
            ),
        ),
    )

    with pytest.raises(InvalidPlan, match="VERIFICATION"):
        PlanCompiler(store).compile(task, proposal)


def test_compiler_rejects_terminal_branch_not_covered_by_verification(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("cover branches"))
    proposal = PlanProposal(
        objective="branch coverage",
        steps=(
            ProposedStep("a", "A", PlanStepKind.ACTION),
            ProposedStep("b", "B", PlanStepKind.ACTION),
            ProposedStep(
                "verify-a",
                "Verify A",
                PlanStepKind.VERIFICATION,
                depends_on=("a",),
            ),
        ),
    )

    with pytest.raises(InvalidPlan, match="b"):
        PlanCompiler(store).compile(task, proposal)


def test_goal_orchestrator_persists_valid_plan_and_marks_task_ready(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    result = GoalOrchestrator(
        store,
        StaticPlanner(valid_proposal()),
    ).submit("bring project to a verified state")

    assert result.task.state is TaskState.READY
    assert result.plan.state is PlanState.ACTIVE
    steps = store.list_plan_steps(result.plan.id)
    assert {step.kind for step in steps} == {
        PlanStepKind.ACTION,
        PlanStepKind.VERIFICATION,
    }


def test_planner_failure_marks_task_failed(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")

    class BrokenPlanner:
        def plan(self, task):
            raise RuntimeError("planner exploded")

    orchestrator = GoalOrchestrator(store, BrokenPlanner())

    with pytest.raises(RuntimeError, match="planner exploded"):
        orchestrator.submit("failing goal")

    tasks = [
        event.task_id
        for event in []
    ]
    stored = store.list_events(
        store.list_actions()[0].task_id
    ) if store.list_actions() else None

    # Find the only task via its creation event.
    conn = store._connect()
    try:
        row = conn.execute("SELECT id, state FROM tasks LIMIT 1").fetchone()
    finally:
        conn.close()
    assert row["state"] == TaskState.FAILED.value


def test_plan_proposal_from_dict_parses_untrusted_model_shape():
    proposal = PlanProposal.from_dict(
        {
            "objective": "ship",
            "steps": [
                {
                    "key": "work",
                    "title": "Do work",
                    "kind": "action",
                    "spec": {"tool": "terminal", "operation": "read status"},
                },
                {
                    "key": "verify",
                    "title": "Verify",
                    "kind": "verification",
                    "depends_on": ["work"],
                    "spec": {"tool": "terminal", "operation": "verify"},
                },
            ],
        }
    )

    assert proposal.steps[0].kind is PlanStepKind.ACTION
    assert proposal.steps[1].depends_on == ("work",)


def test_compiler_rejects_unavailable_tool_and_runtime(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("capability fence"))
    proposal = PlanProposal(
        objective="fenced",
        steps=(
            ProposedStep(
                "work",
                "Work",
                PlanStepKind.AGENT,
                spec={"runtime": "invented-runtime"},
            ),
            ProposedStep(
                "verify",
                "Verify",
                PlanStepKind.VERIFICATION,
                spec={"tool": "invented-tool", "operation": "check"},
                depends_on=("work",),
            ),
        ),
    )

    compiler = PlanCompiler(
        store,
        allowed_action_tools={"terminal"},
        allowed_agent_runtimes={"hermes-subagent"},
    )
    with pytest.raises(InvalidPlan, match="unavailable"):
        compiler.compile(task, proposal)


def test_compiler_requires_action_semantics_in_spec(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("typed spec"))
    proposal = PlanProposal(
        objective="typed",
        steps=(
            ProposedStep(
                "verify",
                "Verify",
                PlanStepKind.VERIFICATION,
                spec={},
            ),
        ),
    )

    with pytest.raises(InvalidPlan, match="spec.tool"):
        PlanCompiler(store).compile(task, proposal)
