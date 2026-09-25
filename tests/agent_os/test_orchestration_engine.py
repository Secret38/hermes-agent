from __future__ import annotations

from agent_os.agents.records import AgentInstanceState
from agent_os.agents.runtime import RuntimeLaunch, RuntimeSnapshot
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.kernel import AgentOSKernel, ExecutionResult
from agent_os.orchestration.engine import EngineOutcome, PlanExecutionEngine
from agent_os.orchestration.plan import (
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
)
from agent_os.orchestration.scheduler import DurablePlanScheduler
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore
from agent_os.supervisor import AgentSupervisor
from agent_os.verification.gate import VerificationResult, VerificationVerdict


class PassExecutor:
    def execute(self, action):
        return ExecutionResult({"ok": True, "operation": action.operation})


class PassVerifier:
    def verify(self, action, actual_state):
        return VerificationResult(
            VerificationVerdict.PASSED,
            "fixture",
            {"actual_state": actual_state},
        )


class FakeRuntime:
    runtime_name = "fake"

    def __init__(self, store=None, plan_id=None):
        self.store = store
        self.plan_id = plan_id
        self.launches = 0

    def launch(self, agent):
        self.launches += 1
        if self.store is not None and self.plan_id is not None:
            bound = [
                step
                for step in self.store.list_plan_steps(self.plan_id)
                if step.execution_id == agent.id
            ]
            assert bound, "agent side effect started before plan-step binding"
        return RuntimeLaunch({"generation": self.launches}, AgentInstanceState.RUNNING)

    def inspect(self, agent):
        return RuntimeSnapshot(True, agent.state)


def make_kernel(store):
    return AgentOSKernel(
        store,
        executor=PassExecutor(),
        verifier=PassVerifier(),
    )


def test_engine_persists_binds_then_executes_action(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("engine action"))
    plan = PlanRecord.create(task_id=task.id, objective="run verified action")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="read work",
        kind=PlanStepKind.VERIFICATION,
        spec={
            "tool": "fixture",
            "operation": "read work",
            "expected_state": {"ok": True},
        },
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)

    engine = PlanExecutionEngine(
        store,
        action_kernels={"fixture": make_kernel(store)},
        agent_supervisor=AgentSupervisor(store, []),
    )
    result = engine.run_once(plan.id)

    persisted_step = store.get_plan_step(step.id)
    action = store.get_action(persisted_step.execution_id)
    assert result.outcome is EngineOutcome.ACTION_EXECUTED
    assert action.state is ActionState.SUCCEEDED
    assert store.get_task(task.id).state is TaskState.COMPLETED


def test_engine_resumes_bound_planned_action_without_creating_duplicate(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("resume action"))
    plan = PlanRecord.create(task_id=task.id, objective="resume")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="read work",
        kind=PlanStepKind.VERIFICATION,
        spec={"tool": "fixture", "operation": "read work"},
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    claimed = DurablePlanScheduler(store, owner_id="before-crash").claim_next(plan.id)
    action = store.create_action(
        ActionRecord.create(
            task.id,
            tool="fixture",
            operation="read work",
            verification_required=True,
        )
    )
    store.bind_plan_step_execution(claimed.id, action.id)

    engine = PlanExecutionEngine(
        store,
        action_kernels={"fixture": make_kernel(store)},
        agent_supervisor=AgentSupervisor(store, []),
    )
    result = engine.run_once(plan.id)

    assert result.outcome is EngineOutcome.ACTION_RESUMED
    assert result.execution_id == action.id
    assert store.get_action(action.id).state is ActionState.SUCCEEDED
    assert len([e for e in store.list_events(task.id) if e.type.value == "action.created"]) == 1


def test_agent_step_is_bound_before_runtime_launch(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("engine agent"))
    plan = PlanRecord.create(task_id=task.id, objective="start agent")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="agent work",
        kind=PlanStepKind.AGENT,
        spec={"runtime": "fake", "goal": "do work"},
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)

    runtime = FakeRuntime(store, plan.id)
    supervisor = AgentSupervisor(store, [runtime])
    engine = PlanExecutionEngine(
        store,
        action_kernels={},
        agent_supervisor=supervisor,
    )

    result = engine.run_once(plan.id)
    persisted_step = store.get_plan_step(step.id)
    agent = store.get_agent(persisted_step.execution_id)

    assert result.outcome is EngineOutcome.AGENT_STARTED
    assert agent.state is AgentInstanceState.RUNNING
    assert runtime.launches == 1


def test_unbound_prepared_agent_stays_dormant_on_reconcile(tmp_path):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("prepared recovery"))
    runtime = FakeRuntime()
    supervisor = AgentSupervisor(store, [runtime])
    agent = supervisor.prepare_agent(
        task_id=task.id,
        runtime="fake",
        goal="do not start until bound",
    )

    report = supervisor.reconcile_active()

    assert report.items[0].before is AgentInstanceState.CREATED
    assert store.get_agent(agent.id).state is AgentInstanceState.CREATED
    assert runtime.launches == 0


def test_engine_resumes_bound_prepared_agent_after_restart(tmp_path):
    path = tmp_path / "agent_os.db"
    store = AgentOSStore(path)
    task = store.create_task(TaskRecord.create("bound prepared recovery"))
    plan = PlanRecord.create(task_id=task.id, objective="resume bound agent")
    step = PlanStepRecord.create(
        plan_id=plan.id,
        task_id=task.id,
        title="agent work",
        kind=PlanStepKind.AGENT,
        spec={"runtime": "fake", "goal": "resume me"},
    )
    store.create_plan(plan, [step], {})
    store.transition_plan(plan.id, PlanState.ACTIVE)
    claimed = DurablePlanScheduler(store, owner_id="before-crash").claim_next(plan.id)

    runtime = FakeRuntime()
    supervisor = AgentSupervisor(store, [runtime])
    agent = supervisor.prepare_agent(
        task_id=task.id,
        runtime="fake",
        goal="resume me",
    )
    store.bind_plan_step_execution(claimed.id, agent.id)

    reopened = AgentOSStore(path)
    resumed_supervisor = AgentSupervisor(reopened, [runtime])
    engine = PlanExecutionEngine(
        reopened,
        action_kernels={},
        agent_supervisor=resumed_supervisor,
    )
    result = engine.run_once(plan.id)

    assert result.outcome is EngineOutcome.AGENT_RESUMED
    assert result.execution_id == agent.id
    assert reopened.get_agent(agent.id).state is AgentInstanceState.RUNNING
    assert runtime.launches == 1
