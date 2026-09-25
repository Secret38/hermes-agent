"""Executable control-plane Golden Task handlers.

These handlers exercise the real Agent OS persistence, kernel, scheduler and
supervisors without requiring a network, GUI session, or external model. They
are deterministic production-control proofs, not substitutes for the later
Windows/browser/repository integration benchmarks.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from agent_os.agents.records import AgentInstanceState
from agent_os.agents.runtime import RuntimeLaunch, RuntimeSnapshot
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.events import EventType
from agent_os.kernel import AgentOSKernel, ExecutionResult
from agent_os.orchestration.plan import (
    PlanRecord,
    PlanState,
    PlanStepKind,
    PlanStepRecord,
    PlanStepState,
)
from agent_os.orchestration.scheduler import DurablePlanScheduler
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore
from agent_os.supervisor import AgentSupervisor
from agent_os.task_supervisor import TaskSupervisor
from agent_os.verification.gate import VerificationResult, VerificationVerdict

from .golden import (
    GoldenTaskDefinition,
    GoldenTaskOutcome,
    GoldenTaskResult,
)


class _PassExecutor:
    def __init__(self) -> None:
        self.calls = 0

    def execute(self, action: ActionRecord) -> ExecutionResult:
        self.calls += 1
        return ExecutionResult(
            {
                "ok": True,
                "tool": action.tool,
                "operation": action.operation,
                "call": self.calls,
            }
        )


class _NeverExecutor:
    def __init__(self) -> None:
        self.calls = 0

    def execute(self, action: ActionRecord) -> ExecutionResult:
        self.calls += 1
        raise AssertionError("permission gate allowed an execution that must be blocked")


class _PassVerifier:
    def verify(
        self,
        action: ActionRecord,
        actual_state: dict[str, Any],
    ) -> VerificationResult:
        return VerificationResult(
            VerificationVerdict.PASSED,
            "golden.control-plane",
            evidence={
                "action_id": action.id,
                "actual_state": dict(actual_state),
            },
        )


@dataclass
class _DurableRuntime:
    runtime_name: str = "golden-runtime"
    launches: int = 0
    states: dict[str, AgentInstanceState] = field(default_factory=dict)
    results: dict[str, dict[str, Any]] = field(default_factory=dict)
    orphan_next_inspection: bool = False

    def launch(self, agent) -> RuntimeLaunch:
        self.launches += 1
        self.states[agent.id] = AgentInstanceState.RUNNING
        return RuntimeLaunch(
            {
                "runtime_id": f"golden-{agent.id}",
                "generation": self.launches,
            },
            state=AgentInstanceState.RUNNING,
        )

    def inspect(self, agent) -> RuntimeSnapshot:
        if self.orphan_next_inspection:
            self.orphan_next_inspection = False
            return RuntimeSnapshot(
                connected=False,
                state=AgentInstanceState.ORPHANED,
                diagnostic="SYNTHETIC_OWNER_PROCESS_GONE",
                safe_to_restart=True,
            )
        state = self.states.get(agent.id, AgentInstanceState.ORPHANED)
        return RuntimeSnapshot(
            connected=state is not AgentInstanceState.ORPHANED,
            state=state,
            diagnostic=None,
            safe_to_restart=False,
            result=dict(self.results.get(agent.id) or {}),
        )

    def complete(self, agent_id: str, **result: Any) -> None:
        self.states[agent_id] = AgentInstanceState.SUCCEEDED
        self.results[agent_id] = dict(result or {"summary": "completed"})


def _db(root: Path) -> AgentOSStore:
    return AgentOSStore(root / "agent_os.db")


def _verified_action(
    store: AgentOSStore,
    task_id: str,
    *,
    operation: str = "inspect verification state",
) -> ActionRecord:
    action = store.create_action(
        ActionRecord.create(
            task_id,
            tool="terminal",
            operation=operation,
            expected_state={"verified": True},
            verification_required=True,
        )
    )
    result = AgentOSKernel(
        store,
        executor=_PassExecutor(),
        verifier=_PassVerifier(),
    ).execute_action(action.id)
    if result.state is not ActionState.SUCCEEDED:
        raise RuntimeError(f"verified action did not succeed: {result.state.value}")
    return result


def _unverified_success_action(store: AgentOSStore, task_id: str) -> ActionRecord:
    action = store.create_action(
        ActionRecord.create(
            task_id,
            tool="terminal",
            operation="read local status",
            verification_required=False,
        )
    )
    return AgentOSKernel(
        store,
        executor=_PassExecutor(),
        verifier=None,
    ).execute_action(action.id)


def critical_permission_gate(
    definition: GoldenTaskDefinition,
) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt17-") as temp:
        store = _db(Path(temp))
        task = store.create_task(TaskRecord.create(definition.goal))
        executor = _NeverExecutor()
        action = store.create_action(
            ActionRecord.create(
                task.id,
                tool="terminal",
                operation="publish release to external target",
                input={"target": "external"},
                verification_required=True,
            )
        )

        result = AgentOSKernel(
            store,
            executor=executor,
            verifier=_PassVerifier(),
        ).execute_action(action.id)

        events = store.list_events(task.id)
        denied = [
            event
            for event in events
            if event.type is EventType.APPROVAL_RESOLVED
            and event.payload.get("allowed") is False
        ]
        verified = (
            result.state is ActionState.BLOCKED
            and result.risk_level == "L3"
            and executor.calls == 0
            and bool(denied)
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "action_state": result.state.value,
                "risk_level": result.risk_level,
                "executor_calls": executor.calls,
                "approval_denials": len(denied),
            },
            error=None if verified else "critical action was not fail-closed",
        )


def false_completion_rejection(
    definition: GoldenTaskDefinition,
) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt18-") as temp:
        store = _db(Path(temp))

        # Layer 1: a verification-required action cannot succeed without a verifier.
        action_task = store.create_task(TaskRecord.create("reject unverified action success"))
        action = store.create_action(
            ActionRecord.create(
                action_task.id,
                tool="terminal",
                operation="read status",
                verification_required=True,
            )
        )
        action_result = AgentOSKernel(
            store,
            executor=_PassExecutor(),
            verifier=None,
        ).execute_action(action.id)

        # Layer 2: even a plan whose ordinary work succeeded cannot complete its
        # task unless the plan contains a successful VERIFICATION step.
        task = store.create_task(TaskRecord.create(definition.goal))
        plan = PlanRecord.create(task_id=task.id, objective="ordinary work only")
        step = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="ordinary work",
            kind=PlanStepKind.ACTION,
        )
        store.create_plan(plan, [step], {})
        store.transition_plan(plan.id, PlanState.ACTIVE)

        claimed = DurablePlanScheduler(store).claim_next(plan.id)
        if claimed is None:
            raise RuntimeError("plan did not expose its root step")

        ordinary = _unverified_success_action(store, task.id)
        store.bind_plan_step_execution(claimed.id, ordinary.id)

        reconciled = TaskSupervisor(store).reconcile(task.id, plan.id)
        verified = (
            action_result.state is ActionState.FAILED
            and reconciled.plan_state is PlanState.COMPLETED
            and reconciled.task_state is TaskState.VERIFYING
            and reconciled.needs_verification
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            false_completion=False,
            evidence={
                "verification_required_action_state": action_result.state.value,
                "ordinary_plan_state": reconciled.plan_state.value,
                "task_state": reconciled.task_state.value,
                "needs_verification": reconciled.needs_verification,
            },
            error=None if verified else "an unverified completion path escaped a gate",
        )


def agent_failure_recovery(
    definition: GoldenTaskDefinition,
) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt15-") as temp:
        store = _db(Path(temp))
        task = store.create_task(TaskRecord.create(definition.goal))
        runtime = _DurableRuntime(orphan_next_inspection=True)
        supervisor = AgentSupervisor(store, [runtime])

        agent = supervisor.launch_agent(
            task_id=task.id,
            runtime=runtime.runtime_name,
            goal="preserve this goal across a controlled runtime loss",
            max_restarts=1,
        )
        original_id = agent.id
        original_goal = agent.goal

        report = supervisor.reconcile_active()
        persisted = store.get_agent(original_id)
        verified = bool(
            persisted
            and report.restarted == 1
            and persisted.id == original_id
            and persisted.goal == original_goal
            and persisted.state is AgentInstanceState.RUNNING
            and persisted.restart_count == 1
            and runtime.launches == 2
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            recovery_attempts=persisted.restart_count if persisted else 0,
            evidence={
                "agent_id_preserved": bool(persisted and persisted.id == original_id),
                "goal_preserved": bool(persisted and persisted.goal == original_goal),
                "state": persisted.state.value if persisted else "MISSING",
                "restart_count": persisted.restart_count if persisted else None,
                "runtime_launches": runtime.launches,
            },
            error=None if verified else "controlled agent recovery did not preserve identity/intent",
        )


def restart_resume(
    definition: GoldenTaskDefinition,
) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt16-") as temp:
        path = Path(temp) / "agent_os.db"
        store = AgentOSStore(path)
        task = store.create_task(TaskRecord.create(definition.goal))
        plan = PlanRecord.create(task_id=task.id, objective="resume without duplicate execution")
        work = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="durable agent work",
            kind=PlanStepKind.AGENT,
        )
        verify = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="verify resumed result",
            kind=PlanStepKind.VERIFICATION,
        )
        store.create_plan(plan, [work, verify], {verify.id: [work.id]})
        store.transition_plan(plan.id, PlanState.ACTIVE)

        scheduler = DurablePlanScheduler(store)
        claimed = scheduler.claim_next(plan.id)
        if claimed is None or claimed.id != work.id:
            raise RuntimeError("work step was not claimable")

        runtime = _DurableRuntime()
        agent = AgentSupervisor(store, [runtime]).launch_agent(
            task_id=task.id,
            runtime=runtime.runtime_name,
            goal="long-running durable work",
            max_restarts=1,
        )
        store.bind_plan_step_execution(claimed.id, agent.id)
        launch_count_before_restart = runtime.launches

        # Simulated Agent OS process reconstruction: all control-plane objects
        # are discarded and re-opened from the same durable SQLite ledger.
        reopened = AgentOSStore(path)
        supervisor = AgentSupervisor(reopened, [runtime])
        scheduler_after_restart = DurablePlanScheduler(reopened)

        duplicate_claim = scheduler_after_restart.claim_next(plan.id)
        supervisor.reconcile_active()
        persisted = reopened.get_agent(agent.id)

        runtime.complete(agent.id, summary="work survived control-plane restart")
        supervisor.reconcile_active()
        TaskSupervisor(reopened).reconcile(task.id, plan.id)

        verify_claim = scheduler_after_restart.claim_next(plan.id)
        if verify_claim is None or verify_claim.id != verify.id:
            raise RuntimeError("verification step did not become ready after resumed work")

        verification_action = _verified_action(reopened, task.id)
        reopened.bind_plan_step_execution(verify_claim.id, verification_action.id)
        final = TaskSupervisor(reopened).reconcile(task.id, plan.id)

        verified = (
            duplicate_claim is None
            and runtime.launches == launch_count_before_restart
            and persisted is not None
            and persisted.id == agent.id
            and final.task_state is TaskState.COMPLETED
            and final.plan_state is PlanState.COMPLETED
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "duplicate_claim": duplicate_claim.id if duplicate_claim else None,
                "runtime_launches_before_restart": launch_count_before_restart,
                "runtime_launches_after_restart": runtime.launches,
                "agent_identity_preserved": bool(persisted and persisted.id == agent.id),
                "final_task_state": final.task_state.value,
                "final_plan_state": final.plan_state.value,
            },
            error=None if verified else "restart reconstruction duplicated or lost durable work",
        )


def multi_agent_delegation(
    definition: GoldenTaskDefinition,
) -> GoldenTaskResult:
    with TemporaryDirectory(prefix="agent-os-gt19-") as temp:
        store = _db(Path(temp))
        task = store.create_task(TaskRecord.create(definition.goal))
        plan = PlanRecord.create(task_id=task.id, objective="parallel work plus integration verification")

        first = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="agent A",
            kind=PlanStepKind.AGENT,
            priority=10,
        )
        second = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="agent B",
            kind=PlanStepKind.AGENT,
            priority=10,
        )
        verify = PlanStepRecord.create(
            plan_id=plan.id,
            task_id=task.id,
            title="integrate and verify both results",
            kind=PlanStepKind.VERIFICATION,
        )
        store.create_plan(
            plan,
            [first, second, verify],
            {verify.id: [first.id, second.id]},
        )
        store.transition_plan(plan.id, PlanState.ACTIVE)

        scheduler = DurablePlanScheduler(store)
        claim_a = scheduler.claim_next(plan.id)
        claim_b = scheduler.claim_next(plan.id)
        if claim_a is None or claim_b is None:
            raise RuntimeError("independent agent steps were not concurrently claimable")

        runtime = _DurableRuntime()
        supervisor = AgentSupervisor(store, [runtime])
        agent_a = supervisor.launch_agent(
            task_id=task.id,
            runtime=runtime.runtime_name,
            goal="produce independent result A",
        )
        agent_b = supervisor.launch_agent(
            task_id=task.id,
            runtime=runtime.runtime_name,
            goal="produce independent result B",
        )
        store.bind_plan_step_execution(claim_a.id, agent_a.id)
        store.bind_plan_step_execution(claim_b.id, agent_b.id)

        runtime.complete(agent_a.id, artifact="A")
        runtime.complete(agent_b.id, artifact="B")
        supervisor.reconcile_active()
        TaskSupervisor(store).reconcile(task.id, plan.id)

        verify_claim = scheduler.claim_next(plan.id)
        if verify_claim is None or verify_claim.id != verify.id:
            raise RuntimeError("integration verification did not wait for both agents")

        verification_action = _verified_action(store, task.id)
        store.bind_plan_step_execution(verify_claim.id, verification_action.id)
        final = TaskSupervisor(store).reconcile(task.id, plan.id)

        agents = {agent.id: store.get_agent(agent.id) for agent in (agent_a, agent_b)}
        verified = (
            len({claim_a.id, claim_b.id}) == 2
            and all(
                record is not None and record.state is AgentInstanceState.SUCCEEDED
                for record in agents.values()
            )
            and final.plan_state is PlanState.COMPLETED
            and final.task_state is TaskState.COMPLETED
        )
        return GoldenTaskResult(
            task_id=definition.id,
            outcome=GoldenTaskOutcome.PASS if verified else GoldenTaskOutcome.FAIL,
            verified=verified,
            evidence={
                "claimed_agent_steps": [claim_a.id, claim_b.id],
                "agent_ids": [agent_a.id, agent_b.id],
                "runtime_launches": runtime.launches,
                "verification_step": verify_claim.id,
                "final_plan_state": final.plan_state.value,
                "final_task_state": final.task_state.value,
            },
            error=None if verified else "multi-agent outputs did not converge through verification",
        )


def control_plane_handlers():
    return {
        "agent_failure_recovery": agent_failure_recovery,
        "restart_resume": restart_resume,
        "critical_permission_gate": critical_permission_gate,
        "false_completion_rejection": false_completion_rejection,
        "multi_agent_delegation": multi_agent_delegation,
    }
