from __future__ import annotations

from contextlib import contextmanager
import importlib.util
from pathlib import Path
import threading

import pytest

from agent import secret_scope
from agent_os.contracts import TaskRecord
from agent_os.mission_control import MissionBusyError, MissionRuntimeService
from agent_os.orchestration.plan import PlanRecord, PlanState, PlanStepKind, PlanStepRecord
from agent_os.states import TaskState
from agent_os.store import AgentOSStore
from hermes_constants import get_hermes_home, reset_hermes_home_override, set_hermes_home_override


@contextmanager
def profile(home: Path):
    home_token = set_hermes_home_override(home)
    secret_token = secret_scope.set_secret_scope(
        {"MISSION_TEST_KEY": home.name}, profile_home=str(home),
    )
    try:
        yield
    finally:
        secret_scope.reset_secret_scope(secret_token)
        reset_hermes_home_override(home_token)


@pytest.fixture
def multiplex(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "launch"))
    previous = secret_scope.is_multiplex_active()
    secret_scope.set_multiplex_active(True)
    try:
        yield
    finally:
        secret_scope.set_multiplex_active(previous)


def test_api_keeps_mission_ledgers_and_approval_brokers_in_the_owning_profile(tmp_path, multiplex):
    path = Path(__file__).resolve().parents[2] / "plugins/agent-os/dashboard/plugin_api.py"
    spec = importlib.util.spec_from_file_location("mission_profile_api", path)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    services = {}

    for name in ("a", "b", "a"):
        home = tmp_path / name
        with profile(home):
            service = api._mission_service()
            assert service.store.path == home / "agent-os/agent_os.db"
            if name not in services:
                service.store.create_task(TaskRecord.create(
                    f"mission for {name}",
                    metadata={"source": "mission-control", "mission_job_id": f"mission-{name}"},
                ))
                service._hydrate_jobs()
                services[name] = service
            assert service is services[name]
            assert [job["id"] for job in service.jobs()] == [f"mission-{name}"]

    assert services["a"].approvals is not services["b"].approvals


@pytest.mark.parametrize("operation", ["submit", "resume", "approve"])
def test_workers_keep_profile_scope_and_serialize_the_shared_desktop(
    tmp_path, monkeypatch, multiplex, operation,
):
    services = {}
    for name in ("a", "b"):
        with profile(tmp_path / name):
            store = AgentOSStore()
            task = store.create_task(TaskRecord.create(
                name, metadata={"source": "mission-control", "mission_job_id": name},
            ))
            store.transition_task(task.id, TaskState.PLANNING)
            store.transition_task(task.id, TaskState.READY)
            plan = PlanRecord.create(task_id=task.id, objective=name)
            step = PlanStepRecord.create(
                plan_id=plan.id, task_id=task.id, title=name, kind=PlanStepKind.MANUAL,
            )
            store.create_plan(plan, [step])
            if operation != "approve":
                store.transition_plan(plan.id, PlanState.ACTIVE)
            services[name] = MissionRuntimeService(store)

    seen = []
    release = threading.Event()
    entered = threading.Event()

    def worker(_job_id):
        # Real scope readers and SQLite in a real worker thread; no model/network call.
        try:
            home = get_hermes_home()
            key = secret_scope.get_secret("MISSION_TEST_KEY")
            seen.append((home, key, AgentOSStore().path))
        except Exception as exc:
            seen.append(exc)
        finally:
            entered.set()
        assert release.wait(10)

    for service in services.values():
        monkeypatch.setattr(service, "_run_job", worker)
        monkeypatch.setattr(service, "_resume_job", worker)

    for name in ("a", "b", "a"):
        service = services[name]
        home = tmp_path / name
        entered.clear()
        release.clear()
        if operation == "approve":
            task = service.store.list_tasks()[0]
            plan = service.store.latest_plan_for_task(task.id)
            if plan.state is PlanState.ACTIVE:
                plan = PlanRecord.create(task_id=task.id, objective=name, revision=plan.revision + 1)
                service.store.create_plan(plan, [PlanStepRecord.create(
                    plan_id=plan.id, task_id=task.id, title=name, kind=PlanStepKind.MANUAL,
                )])
        if operation != "submit":
            service._hydrate_jobs()
        with profile(home):
            if operation == "approve":
                job = service.decide_plan(name, plan.id, plan.revision, "approve")
            else:
                job = service.submit(name) if operation == "submit" else service.resume(name)
            thread = service._worker
        try:
            assert entered.wait(5)
            assert seen[-1] == (home, name, home / "agent-os/agent_os.db")
            other = "b" if name == "a" else "a"
            with profile(tmp_path / other), pytest.raises(MissionBusyError):
                services[other].submit("competing desktop work")
            if operation == "approve":
                with profile(home), pytest.raises(MissionBusyError):
                    service.decide_plan(name, plan.id, plan.revision, "approve")
                assert service.jobs()[0]["state"] == "RUNNING"
        finally:
            release.set()
            thread.join(timeout=5)
        assert not thread.is_alive()
        assert job["id"]
