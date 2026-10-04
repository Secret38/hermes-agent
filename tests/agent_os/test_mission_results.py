from dataclasses import asdict

import pytest

from agent_os.adapters.hermes_file import HermesFileExecutor, HermesFileVerifier
from agent_os.contracts import ActionRecord, TaskRecord
from agent_os.results import preview_result, task_results
from agent_os.states import ActionState, TaskState
from agent_os.store import AgentOSStore


def test_results_follow_real_verified_file_and_reject_changed_or_wrong_task(tmp_path):
    store = AgentOSStore(tmp_path / 'ledger.db')
    task = store.create_task(TaskRecord.create('Create a result'))
    other = store.create_task(TaskRecord.create('Another mission'))
    store.transition_task(task.id, TaskState.PLANNING)
    store.transition_task(task.id, TaskState.READY)
    store.transition_task(task.id, TaskState.RUNNING)
    path = tmp_path / 'result.txt'
    action = store.create_action(ActionRecord.create(
        task.id, tool='file', operation='write_file',
        input={'path': str(path), 'content': 'A real verified result\n'},
    ))
    assert task_results(store, task.id)['results'] == []
    store.transition_action(action.id, ActionState.EXECUTING)
    actual = HermesFileExecutor().execute(action).actual_state
    proof = HermesFileVerifier().verify(action, actual)
    assert proof.passed
    store.transition_action(action.id, ActionState.VERIFYING, actual_state=actual)
    store.transition_action(action.id, ActionState.SUCCEEDED, verification_result=asdict(proof))
    rows = task_results(store, task.id)['results']
    assert [row['id'] for row in rows] == [action.id]
    assert task_results(store, other.id)['results'] == []
    assert preview_result(store, task.id, action.id)['preview'] == path.read_text()
    with pytest.raises(KeyError):
        preview_result(store, other.id, action.id)
    path.write_text('Changed after verification')
    with pytest.raises(ValueError, match='changed'):
        preview_result(store, task.id, action.id)
    path.unlink()
    with pytest.raises(ValueError, match='unavailable'):
        preview_result(store, task.id, action.id)
    assert task_results(AgentOSStore(store.path), task.id)['results'][0]['id'] == action.id
