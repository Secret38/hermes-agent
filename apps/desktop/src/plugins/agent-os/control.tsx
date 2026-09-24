import { cn, Codicon, host, queryClient, useQuery } from '@hermes/plugin-sdk'
import { useState } from 'react'

import {
  AGENT_OS_APPROVALS_KEY,
  AGENT_OS_MISSIONS_KEY,
  AGENT_OS_SNAPSHOT_KEY,
  createAgentOSMission,
  fetchAgentOSApprovals,
  fetchAgentOSMissions,
  resolveAgentOSApproval,
  resumeAgentOSMission
} from './api'
import { useAgentOSEstop } from './control-data'
import { type HumanGate, openHumanGateSession, resolveHumanGateApproval, useHumanGates } from './human-gates'
import type { AgentOSMissionJob, AgentOSPendingApproval } from './types'

const ACTIVE_MISSION_STATES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'WAITING_APPROVAL'])

function stateClass(state: string): string {
  if (state === 'COMPLETED') {return 'text-[#3fa779]'}

  if (state === 'FAILED' || state === 'BLOCKED') {return 'text-destructive'}

  if (state === 'WAITING_APPROVAL' || state === 'INTERRUPTED') {return 'text-[#d49b45]'}

  return 'text-(--dt-primary)'
}

function MissionRow({
  busy,
  job,
  onResume,
  onSelectTask
}: {
  busy: boolean
  job: AgentOSMissionJob
  onResume?: (job: AgentOSMissionJob) => void
  onSelectTask?: (taskId: string) => void
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <span className={cn('mt-0.5 size-2 shrink-0 rounded-full bg-current', stateClass(job.state))} />
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[0.68rem] font-medium leading-relaxed text-foreground">{job.goal}</div>
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.56rem] uppercase tracking-[0.05em] text-(--ui-text-tertiary)">
          <span className={stateClass(job.state)}>{job.state.replaceAll('_', ' ')}</span>
          {job.workspace_id && <span className="max-w-48 truncate">{job.workspace_id}</span>}
        </div>
        {job.error && <div className="mt-1.5 line-clamp-3 text-[0.6rem] leading-relaxed text-destructive">{job.error}</div>}
      </div>
      {job.state === 'INTERRUPTED' && onResume && (
        <button
          aria-label="Resume this interrupted durable mission"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded border border-[color-mix(in_srgb,#d49b45_40%,var(--ui-stroke-tertiary))] px-2 text-[0.6rem] font-medium text-[#d49b45] hover:bg-[color-mix(in_srgb,#d49b45_8%,transparent)] disabled:opacity-50"
          disabled={busy}
          onClick={() => onResume(job)}
          type="button"
        >
          {busy ? <Codicon className="animate-spin" name="loading" size="0.62rem" /> : <Codicon name="debug-continue" size="0.62rem" />}
          Resume
        </button>
      )}
      {job.task_id && onSelectTask && (
        <button
          aria-label="Inspect durable task"
          className="grid size-7 shrink-0 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
          onClick={() => onSelectTask(job.task_id!)}
          type="button"
        >
          <Codicon name="arrow-right" size="0.7rem" />
        </button>
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  busy,
  onDecision
}: {
  approval: AgentOSPendingApproval
  busy: boolean
  onDecision: (approval: AgentOSPendingApproval, choice: 'allow_once' | 'deny') => void
}) {
  return (
    <div className="rounded-lg border border-[color-mix(in_srgb,#d49b45_40%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,#d49b45_6%,var(--ui-bg-secondary))] p-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Codicon className="shrink-0 text-[#d49b45]" name="shield" size="0.78rem" />
            <span className="text-[0.68rem] font-semibold text-foreground">Approval required</span>
          </div>
          <div className="mt-1.5 line-clamp-2 text-xs font-medium leading-relaxed text-foreground">
            {approval.tool} · {approval.operation}
          </div>
        </div>
        <span className="shrink-0 rounded border border-[color-mix(in_srgb,#d49b45_40%,var(--ui-stroke-tertiary))] px-1.5 py-0.5 text-[0.55rem] font-semibold tracking-[0.08em] text-[#d49b45]">
          {approval.risk_level}
        </span>
      </div>

      <div className="mt-2 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2 font-mono text-[0.62rem] leading-relaxed text-(--ui-text-secondary)">
        {approval.target}
      </div>
      <div className="mt-2 text-[0.62rem] leading-relaxed text-(--ui-text-tertiary)">{approval.reason}</div>

      <div className="mt-3 flex justify-end gap-1.5">
        <button
          className="rounded-md border border-(--ui-stroke-tertiary) px-2.5 py-1.5 text-[0.64rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecision(approval, 'deny')}
          type="button"
        >
          Deny
        </button>
        <button
          className="rounded-md border border-[color-mix(in_srgb,var(--dt-primary)_45%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-primary)_11%,var(--ui-bg-secondary))] px-2.5 py-1.5 text-[0.64rem] font-semibold text-foreground hover:bg-[color-mix(in_srgb,var(--dt-primary)_17%,var(--ui-bg-secondary))] disabled:opacity-50"
          disabled={busy}
          onClick={() => onDecision(approval, 'allow_once')}
          type="button"
        >
          Allow once
        </button>
      </div>
    </div>
  )
}

function gateIcon(kind: HumanGate['kind']): string {
  if (kind === 'approval') {return 'shield'}

  if (kind === 'clarify') {return 'question'}

  if (kind === 'sudo') {return 'key'}

  if (kind === 'secret') {return 'lock'}

  if (kind === 'vault-code') {return 'verified'}

  return 'archive'
}

function HumanGateCard({
  busy,
  gate,
  onDecision
}: {
  busy: boolean
  gate: HumanGate
  onDecision: (gate: HumanGate, choice: 'deny' | 'once') => void
}) {
  const provenance = gate.approvalProvenance

  const provenanceText = provenance
    ? [
        `mode ${provenance.mode}`,
        provenance.toolName ? `tool ${provenance.toolName}` : null,
        provenance.patternKeys.length ? `rule ${provenance.patternKeys.join(', ')}` : null,
        provenance.smartDenied ? 'smart guardian override' : null
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <button
          aria-label="Open owning Hermes session"
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
          onClick={() => openHumanGateSession(gate)}
          type="button"
        >
          <Codicon className="mt-0.5 shrink-0 text-[#d49b45]" name={gateIcon(gate.kind)} size="0.75rem" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className="truncate text-[0.68rem] font-semibold text-foreground">{gate.label}</span>
              <span className="shrink-0 text-[0.55rem] font-medium tracking-[0.06em] text-[#d49b45]">{gate.state}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[0.61rem] leading-relaxed text-(--ui-text-tertiary)">
              {gate.sessionLabel} · {gate.detail}
            </div>
            {provenanceText && (
              <div className="mt-1 truncate font-mono text-[0.55rem] text-(--ui-text-quaternary)" title={provenanceText}>
                {provenanceText}
              </div>
            )}
          </div>
        </button>
        {gate.kind === 'approval' && (
          <div className="flex shrink-0 gap-1">
            <button
              className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.58rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) disabled:opacity-50"
              disabled={busy}
              onClick={() => onDecision(gate, 'deny')}
              type="button"
            >
              Deny
            </button>
            <button
              className="rounded border border-[color-mix(in_srgb,var(--dt-primary)_40%,var(--ui-stroke-tertiary))] px-2 py-1 text-[0.58rem] font-medium text-foreground hover:bg-(--ui-control-hover-background) disabled:opacity-50"
              disabled={busy}
              onClick={() => onDecision(gate, 'once')}
              type="button"
            >
              Run once
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function MissionControlActions({
  coreReady,
  onSelectTask
}: {
  coreReady: boolean
  onSelectTask?: (taskId: string) => void
}) {
  const [composerOpen, setComposerOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [decisionId, setDecisionId] = useState<string>()
  const [humanDecisionId, setHumanDecisionId] = useState<string>()
  const [resumeId, setResumeId] = useState<string>()
  const [error, setError] = useState<string>()
  const [changingEstop, setChangingEstop] = useState(false)

  const { data: missionData } = useQuery({
    queryFn: fetchAgentOSMissions,
    queryKey: AGENT_OS_MISSIONS_KEY,
    refetchInterval: 2_500
  })

  const { data: approvalData } = useQuery({
    queryFn: fetchAgentOSApprovals,
    queryKey: AGENT_OS_APPROVALS_KEY,
    refetchInterval: 1_500
  })

  const humanGates = useHumanGates()
  const estop = useAgentOSEstop()
  const jobs = missionData?.jobs ?? []
  const approvals = approvalData?.approvals ?? []
  const active = jobs.find(job => ACTIVE_MISSION_STATES.has(job.state))
  const recent = jobs.slice(0, 4)

  const invalidateControl = () => {
    void queryClient.invalidateQueries({ queryKey: AGENT_OS_MISSIONS_KEY })
    void queryClient.invalidateQueries({ queryKey: AGENT_OS_APPROVALS_KEY })
    void queryClient.invalidateQueries({ queryKey: AGENT_OS_SNAPSHOT_KEY })
  }

  const submit = async () => {
    const trimmed = goal.trim()

    if (!trimmed || submitting || active || estop.data?.engaged) {return}

    setSubmitting(true)
    setError(undefined)

    try {
      const response = await createAgentOSMission({
        goal: trimmed,
        ...(workspace.trim() ? { workspace_id: workspace.trim() } : {})
      })

      setGoal('')
      setWorkspace('')
      setComposerOpen(false)
      invalidateControl()

      if (response.job.task_id && onSelectTask) {onSelectTask(response.job.task_id)}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSubmitting(false)
    }
  }

  const resume = async (job: AgentOSMissionJob) => {
    if (resumeId || submitting || active || estop.data?.engaged) {return}

    setResumeId(job.id)
    setError(undefined)

    try {
      await resumeAgentOSMission(job.id)
      invalidateControl()

      if (job.task_id && onSelectTask) {onSelectTask(job.task_id)}
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setResumeId(undefined)
    }
  }

  const decideHumanGate = async (gate: HumanGate, choice: 'deny' | 'once') => {
    if (humanDecisionId) {return}

    setHumanDecisionId(gate.id)
    setError(undefined)

    try {
      const resolved = await resolveHumanGateApproval(gate, choice)

      if (!resolved) {
        throw new Error('This approval is no longer pending.')
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      host.notifyError(cause, 'Could not resolve Hermes approval')
    } finally {
      setHumanDecisionId(undefined)
    }
  }

  const setNewWorkPaused = async (engaged: boolean) => {
    if (changingEstop) {return}

    setChangingEstop(true)
    setError(undefined)

    try {
      await estop.setEngaged(
        engaged,
        engaged ? 'Agent OS operator emergency stop' : undefined
      )
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message)
      host.notifyError(cause, engaged ? 'Could not pause new work' : 'Could not resume new work')
    } finally {
      setChangingEstop(false)
    }
  }

  const decide = async (approval: AgentOSPendingApproval, choice: 'allow_once' | 'deny') => {
    if (decisionId) {return}

    setDecisionId(approval.id)
    setError(undefined)

    try {
      await resolveAgentOSApproval(approval.id, choice)
      invalidateControl()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDecisionId(undefined)
    }
  }

  return (
    <section className="aos-panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
            <Codicon name="rocket" size="0.78rem" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Mission control</div>
            <div className="mt-0.5 truncate text-[0.58rem] text-(--ui-text-tertiary)">
              L0/L1 execute automatically · L2+ pauses here for explicit approval
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {estop.data?.engaged ? (
            <button
              aria-label="Resume new work. Existing in-flight work is not affected."
              className="inline-flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,#d49b45_45%,var(--ui-stroke-tertiary))] px-2.5 py-1.5 text-[0.65rem] font-semibold text-[#d49b45] hover:bg-[color-mix(in_srgb,#d49b45_8%,transparent)] disabled:opacity-50"
              disabled={changingEstop}
              onClick={() => void setNewWorkPaused(false)}
              type="button"
            >
              <Codicon name="play" size="0.68rem" />
              Resume new work
            </button>
          ) : (
            <button
              aria-label="Pause new gateway turns, scheduled fires and Kanban dispatch. Existing in-flight work continues."
              className="inline-flex items-center gap-1.5 rounded-md border border-(--ui-stroke-tertiary) px-2.5 py-1.5 text-[0.65rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-50"
              disabled={changingEstop || estop.isError}
              onClick={() => void setNewWorkPaused(true)}
              type="button"
            >
              <Codicon name="debug-pause" size="0.68rem" />
              Pause new work
            </button>
          )}

          <button
          aria-label={!coreReady ? 'Agent OS core is not ready' : estop.data?.engaged ? 'New work is paused by the global emergency stop' : active ? 'An interactive mission is already running' : 'Start a new Agent OS mission'}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[0.65rem] font-semibold transition-colors',
            coreReady && !active && !estop.data?.engaged
              ? 'border-[color-mix(in_srgb,var(--dt-primary)_45%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-primary)_10%,var(--ui-bg-secondary))] text-foreground hover:bg-[color-mix(in_srgb,var(--dt-primary)_16%,var(--ui-bg-secondary))]'
              : 'cursor-not-allowed border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) opacity-60'
          )}
          disabled={!coreReady || Boolean(active) || Boolean(estop.data?.engaged)}
          onClick={() => setComposerOpen(value => !value)}
          type="button"
        >
          <Codicon name="add" size="0.7rem" />
          New mission
          </button>
        </div>
      </div>

      {estop.data?.engaged && (
        <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,#d49b45_7%,transparent)] px-3 py-2 text-[0.62rem] text-(--ui-text-secondary)">
          <Codicon name="debug-pause" size="0.7rem" />
          <span className="font-semibold text-[#d49b45]">NEW WORK PAUSED</span>
          <span className="truncate text-(--ui-text-tertiary)">
            Gateway turns, scheduled fires and Kanban dispatch are gated. Existing in-flight work is intentionally not killed.
            {estop.data.reason ? ` · ${estop.data.reason}` : ''}
          </span>
        </div>
      )}

      {humanGates.length > 0 && (
        <div className="border-b border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,#d49b45_3%,transparent)] p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="aos-kicker">What needs me</div>
              <div className="mt-0.5 text-[0.58rem] text-(--ui-text-tertiary)">
                Canonical Hermes approvals, clarification, sudo, credentials, vault and verification-code gates
              </div>
            </div>
            <span className="shrink-0 text-[0.58rem] tabular-nums text-[#d49b45]">{humanGates.length} waiting</span>
          </div>
          <div className="grid gap-1.5 xl:grid-cols-2">
            {humanGates.slice(0, 8).map(gate => (
              <HumanGateCard
                busy={humanDecisionId === gate.id}
                gate={gate}
                key={gate.id}
                onDecision={decideHumanGate}
              />
            ))}
          </div>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="border-b border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,#d49b45_3%,transparent)] p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="aos-kicker">Approval inbox</div>
            <span className="text-[0.58rem] tabular-nums text-[#d49b45]">{approvals.length} pending</span>
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {approvals.map(approval => (
              <ApprovalCard
                approval={approval}
                busy={decisionId === approval.id}
                key={approval.id}
                onDecision={decide}
              />
            ))}
          </div>
        </div>
      )}

      {composerOpen && (
        <div className="border-b border-(--ui-stroke-tertiary) p-3">
          <label className="aos-kicker" htmlFor="aos-mission-goal">
            Goal
          </label>
          <textarea
            autoFocus
            className="mt-2 min-h-24 w-full resize-y rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-3 py-2 text-xs leading-relaxed text-foreground outline-none placeholder:text-(--ui-text-quaternary) focus:border-[color-mix(in_srgb,var(--dt-primary)_50%,var(--ui-stroke-tertiary))]"
            id="aos-mission-goal"
            maxLength={16000}
            onChange={event => setGoal(event.target.value)}
            placeholder="Describe the verified outcome Agent OS should achieve…"
            value={goal}
          />

          <div className="mt-2 grid gap-2 md:grid-cols-[1fr_auto]">
            <input
              className="h-8 min-w-0 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2.5 text-[0.65rem] text-foreground outline-none placeholder:text-(--ui-text-quaternary) focus:border-[color-mix(in_srgb,var(--dt-primary)_50%,var(--ui-stroke-tertiary))]"
              maxLength={4096}
              onChange={event => setWorkspace(event.target.value)}
              placeholder="Optional workspace path / id"
              value={workspace}
            />
            <div className="flex justify-end gap-1.5">
              <button
                className="rounded-md border border-(--ui-stroke-tertiary) px-2.5 text-[0.64rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                onClick={() => setComposerOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-(--dt-primary) px-3 text-[0.64rem] font-semibold text-white disabled:opacity-50"
                disabled={!goal.trim() || submitting}
                onClick={() => void submit()}
                type="button"
              >
                {submitting && <Codicon className="animate-spin" name="loading" size="0.65rem" />}
                Plan & run
              </button>
            </div>
          </div>
        </div>
      )}

      {(active || recent.length > 0 || error) && (
        <div className="p-3">
          {error && (
            <div className="mb-2 rounded-md border border-[color-mix(in_srgb,var(--dt-destructive)_30%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-destructive)_6%,transparent)] p-2 text-[0.62rem] leading-relaxed text-destructive">
              {error}
            </div>
          )}
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="aos-kicker">{active ? 'Active mission' : 'Recent missions'}</div>
            {active && <span className={cn('text-[0.58rem] font-medium', stateClass(active.state))}>{active.state.replaceAll('_', ' ')}</span>}
          </div>
          <div className="grid gap-1.5 lg:grid-cols-2">
            {(active ? [active, ...recent.filter(job => job.id !== active.id).slice(0, 1)] : recent.slice(0, 4)).map(job => (
              <MissionRow
                busy={resumeId === job.id}
                job={job}
                key={job.id}
                onResume={resume}
                onSelectTask={onSelectTask}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  )
}