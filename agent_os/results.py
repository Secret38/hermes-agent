"""Mission output references come from verified file writes, never model prose."""

import hashlib
from pathlib import PurePosixPath

from agent_os.redaction import redact_display_value
from agent_os.states import ActionState


def _file_result(action):
    verification = action.verification_result
    evidence = verification.get('evidence', {})
    if (action.tool != 'file' or action.operation not in {'write', 'write_file'}
            or action.state is not ActionState.SUCCEEDED
            or verification.get('verdict') != 'PASSED'
            or verification.get('method') != 'hermes.file.raw-read'
            or not evidence.get('resolved_path') or not evidence.get('sha256')):
        return None
    path = str(evidence['resolved_path'])
    return {
        'id': action.id, 'task_id': action.task_id,
        'name': PurePosixPath(path.replace('\\', '/')).name,
        'path': path, 'sha256': evidence['sha256'], 'bytes': evidence.get('bytes'),
        'verified_at': action.updated_at,
    }


def task_results(store, task_id):
    if store.get_task(task_id) is None:
        raise KeyError('Unknown task')
    results = [_file_result(action) for action in store.list_actions(task_id=task_id)]
    return {'task_id': task_id, 'results': [item for item in results if item is not None]}


def preview_result(store, task_id, result_id):
    from tools.file_tools import _get_file_ops

    action = store.get_action(result_id)
    result = _file_result(action) if action and action.task_id == task_id else None
    if result is None:
        raise KeyError('Unknown verified result for this task')
    # The identity is taken exclusively from the durable verifier evidence.
    # The caller cannot provide a path to this endpoint.
    reader = _get_file_ops(task_id)
    data = reader.read_file_bytes(result['path'], max_bytes=2 * 1024 * 1024)
    if data.error:
        raise ValueError('The result file is unavailable or too large to preview.')
    import base64
    raw = base64.b64decode(data.base64_content, validate=True)
    try:
        content = raw.decode('utf-8-sig')
    except UnicodeDecodeError as exc:
        raise ValueError('This result cannot be previewed as text.') from exc
    if hashlib.sha256(content.encode('utf-8')).hexdigest() != result['sha256']:
        raise ValueError('The file has changed since verification. Its saved proof no longer describes the current content.')
    return {**result, 'preview': redact_display_value(content[:32_000], bounded=False),
            'truncated': len(content) > 32_000}
