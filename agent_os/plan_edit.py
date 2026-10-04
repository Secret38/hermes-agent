"""Edits of displayed steps preserve undisclosed values and the original DAG."""

from copy import deepcopy

from agent_os.orchestration.planner import PlanProposal, ProposedStep
from agent_os.redaction import redact_display_value


def _restore_hidden(original, edited, displayed):
    if edited == displayed:
        return deepcopy(original)
    if isinstance(original, dict) and isinstance(edited, dict):
        if any(key not in edited and displayed[key] != value for key, value in original.items()):
            raise ValueError("Hidden values cannot be removed in this editor.")
        return {key: _restore_hidden(original[key], value, displayed[key]) if key in original else value
                for key, value in edited.items()}
    if isinstance(original, list) and isinstance(edited, list):
        if displayed != original:
            raise ValueError("Lists containing hidden values cannot be changed in this editor.")
        return edited
    if displayed != original:
        raise ValueError("Hidden values cannot be changed in this editor.")
    return edited


def edited_proposal(store, plan, edits):
    steps = store.list_plan_steps(plan.id)
    by_id = {step.id: step for step in steps}
    if not edits or len({edit['id'] for edit in edits}) != len(edits):
        raise ValueError("Choose each step at most once.")
    if any(edit['id'] not in by_id for edit in edits):
        raise ValueError("An edited step does not belong to this plan.")
    replacements = {edit['id']: edit for edit in edits}
    dependencies = store.plan_dependencies(plan.id)
    proposed = []
    changed = False
    for step in steps:
        edit = replacements.get(step.id)
        title, spec = step.title, step.spec
        if edit:
            title = _restore_hidden(title, edit['title'], redact_display_value(title, bounded=False)).strip()
            spec = _restore_hidden(spec, edit['spec'], redact_display_value(spec, bounded=False))
            if not title:
                raise ValueError("Step titles must not be empty.")
            changed |= title != step.title or spec != step.spec
        proposed.append(ProposedStep(
            key=step.id, title=title, kind=step.kind, spec=spec,
            depends_on=tuple(dependencies.get(step.id, [])), priority=step.priority,
        ))
    if not changed:
        raise ValueError("No changes to save.")
    return PlanProposal(objective=plan.objective, steps=tuple(proposed), metadata=plan.metadata)
