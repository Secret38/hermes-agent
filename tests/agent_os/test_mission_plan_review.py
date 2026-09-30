from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import importlib.util
from pathlib import Path
import sys
import threading

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from agent import estop
from agent_os.adapters.hermes_planner import HermesPlanner
from agent_os.contracts import TaskRecord
from agent_os.mission_control import MissionRuntimeService
from agent_os.orchestration.engine import EngineOutcome
from agent_os.orchestration.plan import PlanState, PlanStepKind
from agent_os.orchestration.planner import PlanCompiler, PlanProposal, ProposedStep
from agent_os.runtime import AgentOSRuntime
from agent_os.states import TaskState
from agent_os.store import AgentOSStore


def proposal():
    return PlanProposal(
        objective="Review the complete plan before work starts",
        steps=(
            ProposedStep(
                "review", "Manual checkpoint", PlanStepKind.MANUAL,
                spec={"instructions": "Review " + "detail " * 200,
                      "items": list(range(100)), "password": "private-value"},
            ),
            ProposedStep(
                "verify", "Verify result", PlanStepKind.VERIFICATION,
                spec={"tool": "file", "operation": "read_file",
                      "input": {"path": "result.txt"}},
                depends_on=("review",),
            ),
        ),
    )


def join_worker(service):
    worker = service._worker
    if worker is not None:
        worker.join(timeout=10)
        assert not worker.is_alive()


@pytest.mark.parametrize("choice", ["approve", "discard"])
def test_mission_api_waits_for_exact_plan_review_across_restart(tmp_path, monkeypatch, choice):
    # Only the model boundary is substituted. The HTTP router, production runtime
    # composition, compiler, workers, scheduler and SQLite ledger are real.
    monkeypatch.setattr(HermesPlanner, "plan", lambda self, task: proposal())
    path = Path(__file__).resolve().parents[2] / "plugins/agent-os/dashboard/plugin_api.py"
    spec = importlib.util.spec_from_file_location("mission_review_api", path)
    api = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, api)
    spec.loader.exec_module(api)
    app = FastAPI()
    app.include_router(api.router)

    with TestClient(app) as client:
        response = client.post("/missions", json={"goal": "Prepare a reviewed outcome"})
        assert response.status_code == 200
        job_id = response.json()["job"]["id"]
        service = api._mission_service()
        join_worker(service)
        job = service.jobs()[0]
        assert job["state"] == "WAITING_PLAN", job
        assert service.store.list_actions() == []

        api._mission_service_for_home.cache_clear()
        service = api._mission_service()
        assert service._worker is None
        assert service.jobs()[0]["state"] == "WAITING_PLAN"
        assert client.post(f"/missions/{job_id}/resume", json={"confirm": True}).status_code == 409
        # Pending reviews remain reachable even when the recent-history limit is small.
        recent = service.store.create_task(TaskRecord.create(
            "Newer failed mission", metadata={"source": "mission-control", "mission_job_id": "recent"},
        ))
        service.store.transition_task(recent.id, TaskState.PLANNING)
        service.store.transition_task(recent.id, TaskState.FAILED)
        service._hydrate_jobs()
        assert {row["id"] for row in service.jobs(limit=1)} == {job_id, "recent"}

        review = client.get(f"/missions/{job_id}/plan").json()
        assert review["plan_id"] == job["plan_id"]
        assert review["state"] == "DRAFT"
        first, verify = review["steps"]
        assert first["spec"]["instructions"] == proposal().steps[0].spec["instructions"]
        assert first["spec"]["items"] == list(range(100))
        assert first["spec"]["password"] == "[redacted]"
        assert verify["depends_on"] == [first["id"]]
        assert service.store.get_plan_step(first["id"]).spec["password"] == "private-value"

        # Even a direct engine tick against the persisted draft cannot claim work.
        runtime = AgentOSRuntime(service.store, planner=HermesPlanner, action_kernels={})
        assert runtime.run_once(review["plan_id"]).outcome is EngineOutcome.IDLE
        assert service.store.list_actions() == []

        url = f"/missions/{job_id}/plan/decision"
        body = {"plan_id": review["plan_id"], "revision": review["revision"], "choice": choice}
        with monkeypatch.context() as paused:
            paused.setattr(estop, "get_state", lambda: {"reason": "operator pause"})
            assert client.post(url, json={**body, "choice": "approve"}).status_code == 409
            assert service.store.get_plan(review["plan_id"]).state is PlanState.DRAFT
        for mismatch in ({"revision": review["revision"] + 1}, {"plan_id": "unseen-plan"}):
            assert client.post(url, json={**body, **mismatch}).status_code == 409
            assert service.store.get_plan(review["plan_id"]).state is PlanState.DRAFT

        with monkeypatch.context() as paused:
            if choice == "discard":
                paused.setattr(estop, "get_state", lambda: {"reason": "operator pause"})
            response = client.post(url, json=body)
        assert response.status_code == 200, response.text
        join_worker(service)
        assert client.post(url, json=body).status_code == 409
        reopened = MissionRuntimeService(AgentOSStore(service.store.path))
        if choice == "approve":
            # A manual checkpoint blocks the REAL engine, proving approval started it.
            assert next(row for row in service.jobs() if row["id"] == job_id)["state"] == "BLOCKED"
            assert reopened.store.get_plan(review["plan_id"]).state is PlanState.ACTIVE
            assert reopened._worker is None
            assert next(row for row in reopened.jobs() if row["id"] == job_id)["state"] == "INTERRUPTED"
        else:
            assert next(row for row in reopened.jobs() if row["id"] == job_id)["state"] == "CANCELLED"
            assert reopened.store.get_plan(review["plan_id"]).state is PlanState.CANCELLED
        assert reopened.store.list_actions() == []


@pytest.mark.parametrize("intake_finished", [True, False])
def test_plan_review_rejects_superseded_plans_and_commits_only_one_decision(tmp_path, intake_finished):
    store = AgentOSStore(tmp_path / "agent_os.db")
    task = store.create_task(TaskRecord.create("Review once"))
    store.transition_task(task.id, TaskState.PLANNING)
    compiler = PlanCompiler(store)
    old = compiler.compile(task, proposal(), activate=False)
    current = compiler.compile(task, proposal(), revision=old.revision + 1, activate=False)
    if intake_finished:
        store.transition_task(task.id, TaskState.READY)

    with pytest.raises(RuntimeError, match="changed|pending"):
        store.resolve_plan_review(task.id, old.id, old.revision, approve=True)

    barrier = threading.Barrier(2)

    def decide(approve):
        reopened = AgentOSStore(store.path)
        barrier.wait(timeout=10)
        try:
            return reopened.resolve_plan_review(task.id, current.id, current.revision, approve=approve).state
        except RuntimeError:
            return None

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(decide, (True, False)))

    winners = [result for result in results if result is not None]
    assert len(winners) == 1
    assert store.get_plan(current.id).state is winners[0]
    assert store.get_task(task.id).state is (
        TaskState.CANCELLED if winners[0] is PlanState.CANCELLED else TaskState.READY
    )
    decisions = [event for event in store.list_events(task.id) if event.payload.get("review_decision")]
    assert len(decisions) == 1
    assert decisions[0].payload["revision"] == current.revision
    assert store.get_plan(old.id).state is PlanState.DRAFT
