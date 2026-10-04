import { Button, Input, Textarea, usePluginI18n, useQuery } from '@hermes/plugin-sdk'
import { useId, useRef, useState } from 'react'

import { AGENT_OS_PLAN_REVIEW_KEY, decideAgentOSPlan, editAgentOSPlan, fetchAgentOSPlanReview } from './api'
import type { AgentOSMissionJob } from './types'

interface MissionPlanReviewProps {
  job: AgentOSMissionJob
  startBlocked?: string
  onResolved: () => void
}

export function MissionPlanReview({ job, startBlocked, onResolved }: MissionPlanReviewProps) {
  const t = usePluginI18n('agent-os')
  const contentId = useId()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [resolved, setResolved] = useState(false)
  const [edits, setEdits] = useState<Record<string, { title: string; spec: string }> | null>(null)
  const inFlight = useRef(false)

  const query = useQuery({
    queryKey: [...AGENT_OS_PLAN_REVIEW_KEY, job.id],
    queryFn: () => fetchAgentOSPlanReview(job.id),
    enabled: open,
    retry: 1,
    // Keep the reviewed version on screen until the user explicitly reloads.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity
  })

  const plan = query.data

  const ready = plan?.job_id === job.id && plan.reviewable && plan.steps.length > 0
    && !query.isFetching && !query.isError && !error && !saving && !resolved

  const reload = async () => {
    const result = await query.refetch()

    if (result.isSuccess) {setError(undefined); setEdits(null)}
  }

  const decide = async (choice: 'approve' | 'discard') => {
    if (!ready || !plan || inFlight.current || (choice === 'approve' && (startBlocked || edits))) {return}
    inFlight.current = true
    setSaving(true)

    try {
      const response = await decideAgentOSPlan(job.id, plan, choice)

      if (!response.ok || response.job.id !== job.id) {throw new Error(t('decisionFailed'))}
      setResolved(true)
      onResolved()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  const saveEdits = async () => {
    if (!ready || !plan || !edits || inFlight.current) {return}
    inFlight.current = true
    setSaving(true)

    try {
      const steps = plan.steps.map(step => ({
        id: step.id, title: edits[step.id].title,
        spec: JSON.parse(edits[step.id].spec) as Record<string, unknown>
      }))

      await editAgentOSPlan(job.id, plan, steps)
      setEdits(null)
      await query.refetch()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }

  return (
    <section aria-label={t('waitingPlan')} className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-foreground">{t('waitingPlan')}</div>
          <p className="mt-1 whitespace-pre-wrap break-words text-xs text-(--ui-text-secondary)">{job.goal}</p>
        </div>
        <Button aria-controls={contentId} aria-expanded={open} onClick={() => setOpen(value => !value)} size="sm" variant="secondary">
          {t(open ? 'hidePlan' : 'reviewPlan')}
        </Button>
      </div>
      {open && (
        <div className="space-y-3" id={contentId}>
          {query.isFetching && <p className="text-xs text-(--ui-text-secondary)" role="status">{t('loadingPlan')}</p>}
          {query.isError && <p className="text-xs text-destructive" role="alert">{t('loadFailed')}</p>}
          {plan && plan.job_id === job.id && (
            <>
              <p className="whitespace-pre-wrap break-words text-sm font-medium text-foreground">{plan.objective}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--ui-text-secondary)">
                <span>{t('version')}: {plan.revision}</span>
                <span>{t('steps')}: {plan.steps.length}</span>
                {plan.workspace_id && <span className="break-all">{t('workspace')}: {plan.workspace_id}</span>}
              </div>
              <ul aria-label={t('steps')} className="space-y-4">
                {plan.steps.map(step => (
                  <li className="min-w-0 space-y-1 text-xs" key={step.id}>
                    {edits ? <label className="block space-y-1">
                      <span>{t('stepTitle')}</span>
                      <Input disabled={saving} onChange={event => setEdits({ ...edits, [step.id]: { ...edits[step.id], title: event.target.value } })} value={edits[step.id].title} />
                    </label> : <div className="whitespace-pre-wrap break-words font-medium text-foreground">{step.title}</div>}
                    <div className="text-(--ui-text-secondary)">{t(step.kind)}</div>
                    <p className="break-words text-(--ui-text-tertiary)">
                      {step.depends_on.length
                        ? `${t('dependsOn')}: ${step.depends_on.map(id => plan.steps.find(item => item.id === id)?.title ?? id).join(', ')}`
                        : t('noDependencies')}
                    </p>
                    {Object.keys(step.spec).length > 0 && (
                      <details open>
                        <summary className="cursor-pointer text-(--ui-text-secondary)">{t('details')}</summary>
                        {edits ? <Textarea aria-label={`${t('details')}: ${step.title}`} disabled={saving} onChange={event => setEdits({ ...edits, [step.id]: { ...edits[step.id], spec: event.target.value } })} rows={8} value={edits[step.id].spec} />
                          : <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-(--ui-text-secondary)">{JSON.stringify(step.spec, null, 2)}</pre>}
                      </details>
                    )}
                  </li>
                ))}
              </ul>
              {!plan.reviewable && <p className="text-xs text-(--ui-text-secondary)" role="status">{t('unavailable')}</p>}
            </>
          )}
          <p className="text-xs text-(--ui-text-tertiary)">{t(edits ? 'editNote' : 'reviewNote')}</p>
          {startBlocked && <p className="text-xs text-(--ui-text-secondary)" role="status">{startBlocked}</p>}
          {error && <div className="space-y-1 text-xs text-destructive" role="alert"><p>{t('decisionFailed')}</p><p>{error}</p></div>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button disabled={saving || query.isFetching || resolved} onClick={() => void reload()} size="sm" variant="text">{t('reloadPlan')}</Button>
            {edits ? <>
              <Button disabled={saving} onClick={() => setEdits(null)} size="sm" variant="text">{t('cancelEdit')}</Button>
              <Button disabled={!ready} onClick={() => void saveEdits()} size="sm" variant="secondary">{t('saveRevision')}</Button>
            </> : <Button disabled={!ready} onClick={() => plan && setEdits(Object.fromEntries(plan.steps.map(step => [step.id, { title: step.title, spec: JSON.stringify(step.spec, null, 2) }])))} size="sm" variant="secondary">{t('editPlan')}</Button>}
            <Button disabled={!ready || Boolean(edits)} onClick={() => void decide('discard')} size="sm" variant="secondary">{t('discardPlan')}</Button>
            <Button disabled={!ready || Boolean(startBlocked) || Boolean(edits)} onClick={() => void decide('approve')} size="sm">{t(saving ? 'saving' : 'approvePlan')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
