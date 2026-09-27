import './agent-os.css'

import { cn, Codicon, host, queryClient, useQuery } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import {
  AGENT_OS_APPROVALS_KEY,
  AGENT_OS_CONTEXT_KEY,
  AGENT_OS_MISSIONS_KEY,
  AGENT_OS_SNAPSHOT_KEY,
  fetchAgentOSSnapshot
} from './api'
import { useAgentOSAudit } from './audit-data'
import { ExternalConnectionsSection, SemanticMemorySection } from './context'
import { MissionControlActions } from './control'
import { useHermesOperations, useLiveFleet } from './operations-data'
import { ProjectsView } from './projects'
import { useComputerUseSecurity, useNetworkSecurity, useTelemetrySecurity } from './security-data'
import { exactOperationsRoute, exactWorkerRoute } from './selectors'
import { openHermesSession } from './session-navigation'
import type {
  AgentOSAction,
  AgentOSAgent,
  AgentOSEvent,
  AgentOSPlan,
  AgentOSPlanStep,
  AgentOSSnapshot,
  AgentOSTask
} from './types'
import { ExecutionCanvas, RuntimeObservatory, RuntimeTopologyCanvas } from './visual-intelligence'

type MissionTab = 'overview' | 'tasks' | 'operations' | 'projects' | 'fleet' | 'memory' | 'connections' | 'security'

const ACTIVE_TASK_STATES = new Set([
  'CREATED',
  'INTERPRETING',
  'PLANNING',
  'READY',
  'RUNNING',
  'VERIFYING',
  'WAITING_FOR_APPROVAL',
  'WAITING_FOR_USER',
  'RECOVERING',
  'BLOCKED'
])

const RUNNING_STATES = new Set(['RUNNING', 'EXECUTING', 'VERIFYING', 'RECOVERING', 'STARTING', 'ACTIVE'])

function compactId(value: null | string | undefined): string {
  if (!value) {
    return '—'
  }

  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`
}

function formatTime(value: null | string | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function formatDateTime(value: null | string | undefined): string {
  if (!value) {
    return '—'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function humanize(value: string): string {
  return value
    .replaceAll('.', ' · ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function isActiveTask(task: AgentOSTask): boolean {
  return ACTIVE_TASK_STATES.has(task.state)
}

function stateGlyph(state: string): string {
  if (state === 'SUCCEEDED' || state === 'COMPLETED' || state === 'PASS') {
    return 'check'
  }

  if (state === 'FAILED' || state === 'FAIL') {
    return 'error'
  }

  if (state === 'BLOCKED' || state === 'WARN' || state.includes('WAITING')) {
    return 'warning'
  }

  if (state === 'CANCELLED') {
    return 'circle-slash'
  }

  if (RUNNING_STATES.has(state)) {
    return 'loading'
  }

  return 'circle-large-outline'
}

function StateBadge({ state, compact = false }: { state: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'aos-state inline-flex min-w-0 items-center gap-1.5',
        compact ? 'text-[0.625rem]' : 'text-[0.6875rem]'
      )}
      data-state={state}
      title={humanize(state)}
    >
      <span className="aos-state-dot" />
      <span className="truncate font-medium uppercase tracking-[0.06em] text-(--ui-text-secondary)">
        {humanize(state)}
      </span>
    </span>
  )
}

function SectionHeader({
  icon,
  meta,
  title
}: {
  icon: string
  meta?: string
  title: string
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={icon} size="0.85rem" />
        <span className="truncate text-xs font-semibold tracking-tight text-foreground">{title}</span>
      </div>
      {meta && <span className="shrink-0 text-[0.625rem] tabular-nums text-(--ui-text-tertiary)">{meta}</span>}
    </div>
  )
}

function MetricCard({
  icon,
  label,
  meta,
  value
}: {
  icon: string
  label: string
  meta?: string
  value: number | string
}) {
  return (
    <div className="aos-panel min-w-0 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="aos-kicker">{label}</span>
        <Codicon className="text-(--ui-text-tertiary)" name={icon} size="0.8rem" />
      </div>
      <div className="mt-1.5 truncate text-lg font-semibold tabular-nums tracking-tight text-foreground">{value}</div>
      {meta && <div className="mt-0.5 truncate text-[0.625rem] text-(--ui-text-tertiary)">{meta}</div>}
    </div>
  )
}

function SummaryGrid({ snapshot }: { snapshot: AgentOSSnapshot }) {
  const s = snapshot.summary

  return (
    <div className="aos-summary-grid grid grid-cols-3 gap-2 xl:grid-cols-6">
      <MetricCard icon="pulse" label="Active tasks" meta={`${s.tasks} total`} value={s.active_tasks} />
      <MetricCard icon="tools" label="Actions" meta={`${s.running_actions} in flight`} value={s.actions} />
      <MetricCard icon="hubot" label="Agents" meta={`${s.active_agents} active`} value={s.agents} />
      <MetricCard icon="verified" label="Verifications" value={s.verifications} />
      <MetricCard icon="debug-restart" label="Recoveries" value={s.recoveries} />
      <MetricCard icon="database" label="Events" meta={`${s.workspaces} workspaces`} value={s.events} />
    </div>
  )
}

function PlanProgress({ plan }: { plan: AgentOSPlan }) {
  const progress = plan.progress
  const done = progress.succeeded
  const pct = progress.total > 0 ? Math.round((done / progress.total) * 100) : 0

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-[0.625rem] text-(--ui-text-tertiary)">
        <span>
          {done}/{progress.total} steps verified
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="aos-progress-track">
        <div className="aos-progress-value" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function planLayers(plan: AgentOSPlan): AgentOSPlanStep[][] {
  const byId = new Map(plan.steps.map(step => [step.id, step]))
  const deps = new Map<string, string[]>()

  for (const edge of plan.dependencies) {
    deps.set(edge.step_id, [...(deps.get(edge.step_id) ?? []), edge.dependency_step_id])
  }

  const levels = new Map<string, number>()
  const pending = new Set(plan.steps.map(step => step.id))

  for (let pass = 0; pass < plan.steps.length + 1 && pending.size > 0; pass += 1) {
    let changed = false

    for (const id of [...pending]) {
      const parents = (deps.get(id) ?? []).filter(parent => byId.has(parent))

      if (parents.every(parent => levels.has(parent))) {
        const level = parents.length ? Math.max(...parents.map(parent => levels.get(parent) ?? 0)) + 1 : 0
        levels.set(id, level)
        pending.delete(id)
        changed = true
      }
    }

    if (!changed) {
      break
    }
  }

  const fallback = Math.max(0, ...levels.values()) + 1

  for (const id of pending) {
    levels.set(id, fallback)
  }

  const grouped = new Map<number, AgentOSPlanStep[]>()

  for (const step of plan.steps) {
    const level = levels.get(step.id) ?? 0
    grouped.set(level, [...(grouped.get(level) ?? []), step])
  }

  return [...grouped.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, steps]) => [...steps].sort((a, b) => b.priority - a.priority || a.created_at.localeCompare(b.created_at)))
}

function PlanGraph({ plan }: { plan: AgentOSPlan | null | undefined }) {
  const [selectedStepId, setSelectedStepId] = useState<string>()

  if (!plan) {
    return (
      <div className="grid min-h-56 place-items-center px-8 text-center">
        <div>
          <Codicon className="mx-auto text-(--ui-text-tertiary)" name="list-tree" size="1.5rem" />
          <div className="mt-3 text-sm font-medium text-foreground">No durable plan yet</div>
          <div className="mt-1 max-w-md text-xs leading-relaxed text-(--ui-text-tertiary)">
            Once the planner compiles a goal, its steps and dependencies appear here from the Agent OS ledger.
          </div>
        </div>
      </div>
    )
  }

  const layers = planLayers(plan)
  const titleById = new Map(plan.steps.map(step => [step.id, step.title]))
  const depsByStep = new Map<string, string[]>()
  const selectedStep = selectedStepId ? plan.steps.find(step => step.id === selectedStepId) : undefined

  for (const edge of plan.dependencies) {
    depsByStep.set(edge.step_id, [...(depsByStep.get(edge.step_id) ?? []), edge.dependency_step_id])
  }

  return (
    <div className="p-3.5">
      <div className="mb-4">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="aos-kicker">Plan · revision {plan.revision}</div>
            <div className="mt-1 truncate text-sm font-semibold text-foreground" title={plan.objective}>
              {plan.objective}
            </div>
          </div>
          <StateBadge compact state={plan.state} />
        </div>
        <div className="mt-3">
          <PlanProgress plan={plan} />
        </div>
      </div>

      <div className="aos-plan-canvas aos-scrollbar">
        <div className="aos-plan-layers">
          {layers.map((layer, layerIndex) => (
            <div className="aos-plan-layer" key={layerIndex}>
              <div className="aos-kicker px-0.5">Stage {layerIndex + 1}</div>
              {layer.map(step => {
                const dependencies = depsByStep.get(step.id) ?? []

                return (
                  <div className="aos-step" data-state={step.state} key={step.id}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
                          {humanize(step.kind)}
                        </div>
                        <div className="mt-1 line-clamp-2 text-xs font-medium leading-relaxed text-foreground">
                          {step.title}
                        </div>
                      </div>
                      <button
                        aria-label={`Inspect ${step.title}`}
                        className="grid size-6 shrink-0 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                        onClick={() => setSelectedStepId(step.id)}
                        type="button"
                      >
                        <Codicon name={stateGlyph(step.state)} size="0.78rem" />
                      </button>
                    </div>

                    <div className="mt-2.5">
                      <StateBadge compact state={step.state} />
                    </div>

                    {dependencies.length > 0 && (
                      <div className="mt-2 border-t border-(--ui-stroke-tertiary) pt-2 text-[0.6rem] leading-relaxed text-(--ui-text-tertiary)">
                        depends on{' '}
                        {dependencies
                          .map(id => titleById.get(id) ?? compactId(id))
                          .slice(0, 3)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {selectedStep && (
        <div className="mt-3 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="aos-kicker">Step inspector</div>
              <div className="mt-1 truncate text-xs font-semibold text-foreground" title={selectedStep.title}>
                {selectedStep.title}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StateBadge compact state={selectedStep.state} />
              <button
                aria-label="Close step inspector"
                className="grid size-6 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                onClick={() => setSelectedStepId(undefined)}
                type="button"
              >
                <Codicon name="close" size="0.72rem" />
              </button>
            </div>
          </div>

          <div className="mt-3 grid gap-x-6 gap-y-2 text-[0.62rem] md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="aos-kicker">Kind</div>
              <div className="mt-1 text-(--ui-text-secondary)">{humanize(selectedStep.kind)}</div>
            </div>
            <div>
              <div className="aos-kicker">Execution</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedStep.execution_id ?? undefined}>
                {compactId(selectedStep.execution_id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Claim owner</div>
              <div className="mt-1 truncate text-(--ui-text-secondary)" title={selectedStep.claim_owner ?? undefined}>
                {selectedStep.claim_owner || '—'}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Priority</div>
              <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{selectedStep.priority}</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2.5">
              <div className="aos-kicker">Dependencies</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(depsByStep.get(selectedStep.id) ?? []).length ? (
                  (depsByStep.get(selectedStep.id) ?? []).map(id => (
                    <button
                      aria-label={titleById.get(id) ?? id}
                      className="max-w-full truncate rounded border border-(--ui-stroke-tertiary) px-1.5 py-1 text-[0.58rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                      key={id}
                      onClick={() => setSelectedStepId(id)}
                      type="button"
                    >
                      {titleById.get(id) ?? compactId(id)}
                    </button>
                  ))
                ) : (
                  <span className="text-[0.6rem] text-(--ui-text-tertiary)">No dependencies</span>
                )}
              </div>
            </div>

            <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2.5">
              <div className="aos-kicker">Step spec</div>
              <div className="mt-2 grid gap-1">
                {Object.entries(selectedStep.spec ?? {}).length ? (
                  Object.entries(selectedStep.spec ?? {})
                    .slice(0, 8)
                    .map(([key, value]) => (
                      <div className="flex min-w-0 justify-between gap-3 text-[0.58rem]" key={key}>
                        <span className="truncate text-(--ui-text-tertiary)">{key}</span>
                        <span className="max-w-[65%] truncate font-mono text-(--ui-text-secondary)" title={String(value)}>
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))
                ) : (
                  <span className="text-[0.6rem] text-(--ui-text-tertiary)">No additional step metadata</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-2 text-right text-[0.56rem] tabular-nums text-(--ui-text-quaternary)">
            updated {formatDateTime(selectedStep.updated_at)}
          </div>
        </div>
      )}
    </div>
  )
}

type TimelineFilter = 'all' | 'actions' | 'agents' | 'plan' | 'safety' | 'system'

function eventGroup(type: string): Exclude<TimelineFilter, 'all'> {
  if (type.startsWith('action.')) {return 'actions'}

  if (type.startsWith('agent.')) {return 'agents'}

  if (type.startsWith('plan')) {return 'plan'}

  if (
    type.startsWith('verification.') ||
    type.startsWith('recovery.') ||
    type.startsWith('approval.') ||
    type.startsWith('risk.') ||
    type.startsWith('checkpoint.')
  ) {
    return 'safety'
  }

  return 'system'
}

function eventIcon(type: string): string {
  if (type.startsWith('agent.')) {return 'hubot'}

  if (type.startsWith('plan')) {return 'list-tree'}

  if (type.startsWith('action.')) {return 'tools'}

  if (type.startsWith('verification.')) {return 'verified'}

  if (type.startsWith('recovery.')) {return 'debug-restart'}

  if (type.startsWith('approval.') || type.startsWith('risk.')) {return 'shield'}

  if (type.startsWith('checkpoint.')) {return 'save'}

  if (type.startsWith('artifact.')) {return 'files'}

  return 'circle-large-outline'
}

function eventDetail(event: AgentOSEvent): string {
  const payload = event.payload ?? {}
  const from = typeof payload.from === 'string' ? payload.from : ''
  const to = typeof payload.to === 'string' ? payload.to : ''

  if (from && to) {
    return `${humanize(from)} → ${humanize(to)}`
  }

  const values = [
    typeof payload.decision === 'string' ? payload.decision : '',
    typeof payload.reason === 'string' ? payload.reason : '',
    typeof payload.runtime === 'string' ? payload.runtime : '',
    typeof payload.kind === 'string' ? payload.kind : '',
    typeof payload.risk_level === 'string' ? payload.risk_level : ''
  ].filter(Boolean)

  return values.join(' · ')
}

function Timeline({ events }: { events: AgentOSEvent[] }) {
  const [selectedEventId, setSelectedEventId] = useState<string>()
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const visibleEvents = filter === 'all' ? events : events.filter(event => eventGroup(event.type) === filter)
  const rows = [...visibleEvents].slice(-32).reverse()
  const selectedEvent = selectedEventId ? events.find(event => event.id === selectedEventId) : undefined

  if (events.length === 0) {
    return (
      <div className="grid min-h-48 place-items-center p-6 text-center text-xs text-(--ui-text-tertiary)">
        No execution events recorded yet.
      </div>
    )
  }

  const filters: Array<{ id: TimelineFilter; label: string }> = [
    { id: 'all', label: 'All execution events' },
    { id: 'actions', label: 'Actions' },
    { id: 'agents', label: 'Agents' },
    { id: 'plan', label: 'Plan' },
    { id: 'safety', label: 'Safety' },
    { id: 'system', label: 'System' }
  ]

  return (
    <div className="aos-scrollbar max-h-[34rem] overflow-y-auto p-3">
      <div className="mb-3 flex flex-wrap gap-1">
        {filters.map(item => (
          <button
            aria-label={item.label}
            className={cn(
              'rounded border px-1.5 py-1 text-[0.56rem] font-medium transition-colors',
              filter === item.id
                ? 'border-[color-mix(in_srgb,var(--dt-primary)_45%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-primary)_9%,var(--ui-bg-secondary))] text-foreground'
                : 'border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground'
            )}
            key={item.id}
            onClick={() => setFilter(item.id)}
            type="button"
          >
            {item.id === 'all' ? 'All' : item.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="grid min-h-32 place-items-center text-center text-xs text-(--ui-text-tertiary)">
          No {filter === 'all' ? '' : filter} events in this task.
        </div>
      ) : (
      <div className="aos-timeline space-y-3">
        {rows.map(event => (
          <div className="aos-timeline-row" key={event.id}>
            <button
              aria-label={`Inspect ${humanize(event.type)} event`}
              className="aos-timeline-glyph hover:border-[color-mix(in_srgb,var(--dt-primary)_40%,var(--ui-stroke-tertiary))] hover:text-foreground"
              onClick={() => setSelectedEventId(event.id)}
              type="button"
            >
              <Codicon name={eventIcon(event.type)} size="0.7rem" />
            </button>
            <div className="min-w-0 pb-1">
              <div className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="truncate text-[0.7rem] font-medium text-foreground">{humanize(event.type)}</span>
                <span className="shrink-0 text-[0.58rem] tabular-nums text-(--ui-text-tertiary)">
                  {formatTime(event.created_at)}
                </span>
              </div>
              {eventDetail(event) && (
                <div className="mt-0.5 line-clamp-2 text-[0.625rem] leading-relaxed text-(--ui-text-tertiary)">
                  {eventDetail(event)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      )}

      {selectedEvent && (
        <div className="mt-3 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="aos-kicker">Event inspector</div>
              <div className="mt-1 truncate text-[0.7rem] font-medium text-foreground">{humanize(selectedEvent.type)}</div>
            </div>
            <button
              aria-label="Close event inspector"
              className="grid size-6 shrink-0 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => setSelectedEventId(undefined)}
              type="button"
            >
              <Codicon name="close" size="0.7rem" />
            </button>
          </div>

          <div className="mt-2 grid gap-x-5 gap-y-2 text-[0.58rem] sm:grid-cols-2">
            <div>
              <div className="aos-kicker">Sequence</div>
              <div className="mt-1 font-mono tabular-nums text-(--ui-text-secondary)">#{selectedEvent.sequence}</div>
            </div>
            <div>
              <div className="aos-kicker">Action</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedEvent.action_id ?? undefined}>
                {compactId(selectedEvent.action_id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Task</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedEvent.task_id}>
                {compactId(selectedEvent.task_id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Recorded</div>
              <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{formatDateTime(selectedEvent.created_at)}</div>
            </div>
          </div>

          <div className="mt-3 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2">
            <div className="aos-kicker">Redacted event payload</div>
            {Object.entries(selectedEvent.payload ?? {}).length ? (
              <div className="mt-2 grid gap-1">
                {Object.entries(selectedEvent.payload ?? {}).map(([key, value]) => (
                  <div className="flex min-w-0 items-start justify-between gap-3 text-[0.58rem]" key={key}>
                    <span className="shrink-0 text-(--ui-text-tertiary)">{key}</span>
                    <span className="min-w-0 truncate text-right font-mono text-(--ui-text-secondary)" title={String(value)}>
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-[0.6rem] text-(--ui-text-tertiary)">No additional payload.</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TaskList({
  onSelect,
  query,
  selectedId,
  tasks
}: {
  onSelect: (id: string) => void
  query: string
  selectedId?: string
  tasks: AgentOSTask[]
}) {
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()

    if (!needle) {
      return tasks
    }

    return tasks.filter(task =>
      `${task.goal} ${task.id} ${task.state} ${task.workspace_id ?? ''}`.toLowerCase().includes(needle)
    )
  }, [query, tasks])

  if (filtered.length === 0) {
    return (
      <div className="grid min-h-48 place-items-center p-6 text-center">
        <div>
          <Codicon className="mx-auto text-(--ui-text-tertiary)" name="search" size="1.2rem" />
          <div className="mt-2 text-xs text-(--ui-text-tertiary)">
            {tasks.length ? 'No Agent OS tasks match this filter.' : 'No durable Agent OS tasks yet.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="aos-scrollbar max-h-[36rem] overflow-y-auto p-2">
      {filtered.map(task => (
        <button
          className="aos-task-row mb-1 flex w-full min-w-0 flex-col rounded-md px-2.5 py-2 text-left"
          data-selected={selectedId === task.id}
          key={task.id}
          onClick={() => onSelect(task.id)}
          type="button"
        >
          <div className="flex w-full min-w-0 items-start justify-between gap-3">            <span className="line-clamp-2 min-w-0 text-xs font-medium leading-relaxed text-foreground">{task.goal}</span>            <StateBadge compact state={task.state} />
          </div>
          <div className="mt-1.5 flex w-full min-w-0 items-center gap-2 text-[0.6rem] text-(--ui-text-tertiary)">
            <span className="truncate font-mono">{compactId(task.id)}</span>
            {task.workspace_id && (
              <>
                <span>·</span>
                <span className="truncate">{compactId(task.workspace_id)}</span>
              </>
            )}
            <span className="ml-auto shrink-0 tabular-nums">{formatTime(task.updated_at)}</span>
          </div>
          {task.plan && (
            <div className="mt-2 w-full">
              <PlanProgress plan={task.plan} />
            </div>
          )}
        </button>
      ))}
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentOSAgent }) {
  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="hubot" size="0.78rem" />
            <span className="truncate text-xs font-medium text-foreground">{agent.role || 'agent'}</span>
          </div>
          <div className="mt-1 line-clamp-2 text-[0.65rem] leading-relaxed text-(--ui-text-tertiary)">
            {agent.goal}
          </div>
        </div>
        <StateBadge compact state={agent.state} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.6rem] text-(--ui-text-tertiary)">
        <span>{agent.runtime}</span>
        <span>restarts {agent.restart_count}/{agent.max_restarts}</span>
        {agent.diagnostic && <span className="truncate">{agent.diagnostic}</span>}
      </div>
    </div>
  )
}

function AgentTreeBranch({
  agent,
  childrenByParent,
  depth
}: {
  agent: AgentOSAgent
  childrenByParent: Map<string, AgentOSAgent[]>
  depth: number
}) {
  const children = childrenByParent.get(agent.id) ?? []

  return (
    <div className={cn('relative', depth > 0 && 'ml-4 border-l border-(--ui-stroke-tertiary) pl-3')}>
      {depth > 0 && (
        <span className="absolute -left-px top-5 h-px w-3 -translate-x-0 bg-(--ui-stroke-tertiary)" />
      )}
      <AgentCard agent={agent} />
      {children.length > 0 && depth < 8 && (
        <div className="mt-1.5 space-y-1.5">
          {children.map(child => (
            <AgentTreeBranch
              agent={child}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              key={child.id}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AgentsPanel({ agents }: { agents: AgentOSAgent[] }) {
  if (agents.length === 0) {
    return <div className="p-4 text-xs text-(--ui-text-tertiary)">No delegated agent instances for this task.</div>
  }

  const ids = new Set(agents.map(agent => agent.id))
  const childrenByParent = new Map<string, AgentOSAgent[]>()

  for (const agent of agents) {
    if (!agent.parent_agent_id || !ids.has(agent.parent_agent_id)) {
      continue
    }

    childrenByParent.set(agent.parent_agent_id, [...(childrenByParent.get(agent.parent_agent_id) ?? []), agent])
  }

  const roots = agents.filter(agent => !agent.parent_agent_id || !ids.has(agent.parent_agent_id))
  const visibleRoots = roots.length > 0 ? roots : agents

  return (
    <div className="aos-scrollbar max-h-[30rem] space-y-2 overflow-y-auto p-3">
      {visibleRoots.map(agent => (
        <AgentTreeBranch agent={agent} childrenByParent={childrenByParent} depth={0} key={agent.id} />
      ))}
    </div>
  )
}

function verificationVerdict(action: AgentOSAction): string {
  const result = action.verification_result ?? {}

  for (const key of ['verdict', 'status', 'result']) {
    const value = result[key]

    if (typeof value === 'string' && value.trim()) {
      return value
    }

    if (typeof value === 'boolean') {
      return value ? 'PASS' : 'FAIL'
    }
  }

  return action.verification_required ? 'pending / implicit' : 'not required'
}

function riskWeight(value: null | string | undefined): number {
  const match = String(value ?? '').match(/L(\d+)/i)

  return match ? Number(match[1]) : 0
}

function ActionControls({ actions }: { actions: AgentOSAction[] }) {
  const [selectedActionId, setSelectedActionId] = useState<string>()
  const selectedAction = selectedActionId ? actions.find(action => action.id === selectedActionId) : undefined

  if (actions.length === 0) {
    return <div className="p-4 text-xs text-(--ui-text-tertiary)">No execution actions recorded for this task.</div>
  }

  const ordered = [...actions]
    .sort(
      (a, b) =>
        riskWeight(b.risk_level) - riskWeight(a.risk_level) ||
        b.recovery_attempts - a.recovery_attempts ||
        b.updated_at.localeCompare(a.updated_at)
    )
    .slice(0, 12)

  return (
    <div className="aos-scrollbar max-h-[28rem] overflow-y-auto p-2.5">
      <div className="space-y-1.5">
        {ordered.map(action => (
          <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-2" key={action.id}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="tools" size="0.72rem" />
                  <span className="truncate text-[0.7rem] font-medium text-foreground">
                    {action.tool} · {action.operation}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.6rem] text-(--ui-text-tertiary)">
                  {action.risk_level && <span>risk {action.risk_level}</span>}
                  {action.permission_policy && <span>policy {action.permission_policy}</span>}
                  <span>verify {verificationVerdict(action)}</span>
                  {action.recovery_attempts > 0 && <span>recovery ×{action.recovery_attempts}</span>}
                  {action.execution_attempts > 1 && <span>execution ×{action.execution_attempts}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <StateBadge compact state={action.state} />
                <button
                  aria-label={`Inspect ${action.tool} ${action.operation}`}
                  className="grid size-6 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
                  onClick={() => setSelectedActionId(action.id)}
                  type="button"
                >
                  <Codicon name="search" size="0.68rem" />
                </button>
              </div>
            </div>
            {action.error && (
              <div className="mt-2 rounded bg-[color-mix(in_srgb,var(--dt-destructive)_8%,transparent)] px-2 py-1.5 text-[0.62rem] leading-relaxed text-destructive">
                {action.error}
              </div>
            )}
          </div>
        ))}
      </div>

      {selectedAction && (
        <div className="mt-2 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2.5">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="aos-kicker">Action inspector</div>
              <div className="mt-1 truncate text-[0.7rem] font-medium text-foreground">
                {selectedAction.tool} · {selectedAction.operation}
              </div>
            </div>
            <button
              aria-label="Close action inspector"
              className="grid size-6 shrink-0 place-items-center rounded text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => setSelectedActionId(undefined)}
              type="button"
            >
              <Codicon name="close" size="0.68rem" />
            </button>
          </div>

          <div className="mt-2 grid gap-x-5 gap-y-2 text-[0.58rem] sm:grid-cols-2">
            <div>
              <div className="aos-kicker">Action id</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedAction.id}>
                {compactId(selectedAction.id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Agent</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedAction.agent_id ?? undefined}>
                {compactId(selectedAction.agent_id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Checkpoint</div>
              <div className="mt-1 truncate font-mono text-(--ui-text-secondary)" title={selectedAction.checkpoint_id ?? undefined}>
                {compactId(selectedAction.checkpoint_id)}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Verification</div>
              <div className="mt-1 truncate text-(--ui-text-secondary)">
                {selectedAction.verification_method || (selectedAction.verification_required ? 'required' : 'not required')}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Risk / policy</div>
              <div className="mt-1 truncate text-(--ui-text-secondary)">
                {selectedAction.risk_level || 'unclassified'} · {selectedAction.permission_policy || 'default'}
              </div>
            </div>
            <div>
              <div className="aos-kicker">Attempts</div>
              <div className="mt-1 tabular-nums text-(--ui-text-secondary)">
                execution {selectedAction.execution_attempts} · recovery {selectedAction.recovery_attempts}
              </div>
            </div>
          </div>

          {Object.entries(selectedAction.verification_result ?? {}).length > 0 && (
            <div className="mt-3 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2">
              <div className="aos-kicker">Verification evidence</div>
              <div className="mt-2 grid gap-1">
                {Object.entries(selectedAction.verification_result ?? {})
                  .slice(0, 10)
                  .map(([key, value]) => (
                    <div className="flex min-w-0 justify-between gap-3 text-[0.58rem]" key={key}>
                      <span className="shrink-0 text-(--ui-text-tertiary)">{key}</span>
                      <span className="min-w-0 truncate text-right font-mono text-(--ui-text-secondary)" title={String(value)}>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {selectedAction.error && (
            <div className="mt-2 rounded border border-[color-mix(in_srgb,var(--dt-destructive)_30%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-destructive)_6%,transparent)] p-2 text-[0.6rem] leading-relaxed text-destructive">
              {selectedAction.error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SafetyStrip({ task }: { task: AgentOSTask }) {
  const highRisk = task.actions.filter(action => riskWeight(action.risk_level) >= 2).length
  const waiting = task.actions.filter(action => action.state === 'WAITING_PERMISSION').length

  const items = [
    { icon: 'shield', label: 'Approvals', value: task.metrics.approvals, detail: waiting ? `${waiting} waiting` : 'no pending gate' },
    { icon: 'debug-restart', label: 'Recoveries', value: task.metrics.recoveries, detail: 'bounded retries / replans' },
    { icon: 'verified', label: 'Verification', value: task.metrics.verifications, detail: 'ledger evidence events' },
    { icon: 'lock', label: 'Risk controls', value: highRisk, detail: 'L2+ actions observed' },
    { icon: 'save', label: 'Checkpoints', value: task.metrics.checkpoints, detail: 'rollback anchors' }
  ]

  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-stroke-tertiary) md:grid-cols-5">
      {items.map(item => (
        <div className="min-w-0 bg-(--ui-bg-secondary) px-3 py-2.5" key={item.label}>
          <div className="flex items-center gap-1.5">
            <Codicon className="text-(--ui-text-tertiary)" name={item.icon} size="0.72rem" />
            <span className="aos-kicker">{item.label}</span>
          </div>
          <div className="mt-1 text-sm font-semibold tabular-nums text-foreground">{item.value}</div>
          <div className="mt-0.5 truncate text-[0.58rem] text-(--ui-text-tertiary)">{item.detail}</div>
        </div>
      ))}
    </div>
  )
}

function AttentionQueue({ task }: { task: AgentOSTask }) {
  const items = [
    ...task.actions
      .filter(action => ['WAITING_PERMISSION', 'RECOVERING', 'BLOCKED', 'FAILED'].includes(action.state))
      .map(action => ({
        id: `action:${action.id}`,
        icon: action.state === 'WAITING_PERMISSION' ? 'shield' : action.state === 'RECOVERING' ? 'debug-restart' : 'warning',
        title: `${action.tool} · ${action.operation}`,
        state: action.state,
        detail:
          action.state === 'WAITING_PERMISSION'
            ? `approval required · ${action.risk_level || 'risk unclassified'}`
            : action.error || (action.recovery_attempts ? `${action.recovery_attempts} recovery attempt(s)` : 'execution needs attention')
      })),
    ...task.agents
      .filter(agent => ['ORPHANED', 'FAILED'].includes(agent.state))
      .map(agent => ({
        id: `agent:${agent.id}`,
        icon: 'hubot',
        title: agent.role || agent.runtime,
        state: agent.state,
        detail: agent.error || agent.diagnostic || agent.goal
      }))
  ].slice(0, 8)

  if (!items.length && !['WAITING_FOR_APPROVAL', 'WAITING_FOR_USER', 'BLOCKED', 'RECOVERING', 'FAILED'].includes(task.state)) {
    return null
  }

  return (
    <section className="aos-panel overflow-hidden">
      <SectionHeader icon="bell" meta={items.length ? `${items.length} item(s)` : humanize(task.state)} title="Needs attention" />
      <div className="grid gap-1.5 p-2.5 md:grid-cols-2 xl:grid-cols-4">
        {items.length ? (
          items.map(item => (
            <div
              className="rounded-md border border-[color-mix(in_srgb,#d49b45_28%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,#d49b45_5%,var(--ui-bg-secondary))] p-2.5"
              key={item.id}
            >
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Codicon className="shrink-0 text-[#d49b45]" name={item.icon} size="0.7rem" />
                    <span className="truncate text-[0.68rem] font-medium text-foreground">{item.title}</span>
                  </div>
                  <div className="mt-1 line-clamp-2 text-[0.58rem] leading-relaxed text-(--ui-text-tertiary)">
                    {item.detail}
                  </div>
                </div>
                <StateBadge compact state={item.state} />
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full p-2 text-xs text-(--ui-text-tertiary)">
            Task state requires attention: {humanize(task.state)}
          </div>
        )}
      </div>
    </section>
  )
}

function TaskHeader({ task }: { task: AgentOSTask }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={task.state} />
        <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">{compactId(task.id)}</span>
        {task.workspace_id && (
          <span className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-[0.6rem] text-(--ui-text-tertiary)">
            workspace {compactId(task.workspace_id)}
          </span>
        )}
      </div>
      <h2 className="mt-2 max-w-4xl text-xl font-semibold leading-tight tracking-tight text-foreground">{task.goal}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.65rem] text-(--ui-text-tertiary)">
        <span>created {formatDateTime(task.created_at)}</span>
        <span>updated {formatDateTime(task.updated_at)}</span>
        {task.session_id && (
          <button
            aria-label={`Open originating session ${task.session_id}`}
            className="inline-flex items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => host.navigate(`/${encodeURIComponent(task.session_id!)}`)}
            type="button"
          >
            <Codicon name="comment-discussion" size="0.62rem" />
            Open originating session
          </button>
        )}
      </div>
    </div>
  )
}

function TaskDetail({ task }: { task: AgentOSTask }) {
  return (
    <div className="space-y-3">
      <div className="aos-panel p-4">
        <TaskHeader task={task} />
      </div>

      <AttentionQueue task={task} />
      <SafetyStrip task={task} />
      <ExecutionCanvas task={task} />
      <RuntimeObservatory task={task} />

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="list-tree" meta={task.plan ? `revision ${task.plan.revision}` : undefined} title="Plan graph" />
          <PlanGraph plan={task.plan} />
        </section>
        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="pulse" meta={`${task.events.length} recent`} title="Execution timeline" />
          <Timeline events={task.events} />
        </section>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="hubot" meta={`${task.agents.length}`} title="Agents" />
          <AgentsPanel agents={task.agents} />
        </section>
        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="shield" meta={`${task.actions.length}`} title="Actions · risk · verification" />
          <ActionControls actions={task.actions} />
        </section>
      </div>
    </div>
  )
}

function ProcessMap({ task }: { task: AgentOSTask }) {
  const plan = task.plan
  const activeAgents = task.agents.filter(agent => RUNNING_STATES.has(agent.state)).length
  const activeActions = task.actions.filter(action => RUNNING_STATES.has(action.state) || action.state === 'WAITING_PERMISSION').length
  const verificationActions = task.actions.filter(action => action.verification_required)
  const verified = verificationActions.filter(action => action.state === 'SUCCEEDED').length
  const recovery = task.metrics.recoveries > 0

  const stages = [
    {
      id: 'goal',
      icon: 'target',
      label: 'Goal',
      state: task.state,
      detail: task.goal
    },
    {
      id: 'plan',
      icon: 'list-tree',
      label: 'Plan',
      state: plan?.state ?? 'PENDING',
      detail: plan ? `${plan.progress.succeeded}/${plan.progress.total} steps` : 'waiting for compiled plan'
    },
    {
      id: 'agents',
      icon: 'hubot',
      label: 'Agents',
      state: activeAgents > 0 ? 'RUNNING' : task.agents.some(agent => agent.state === 'SUCCEEDED') ? 'SUCCEEDED' : 'READY',
      detail: `${task.agents.length} total · ${activeAgents} active`
    },
    {
      id: 'actions',
      icon: 'tools',
      label: 'Execution',
      state: activeActions > 0 ? 'EXECUTING' : task.actions.some(action => action.state === 'FAILED') ? 'FAILED' : 'READY',
      detail: `${task.actions.length} actions · ${activeActions} active`
    },
    {
      id: 'verify',
      icon: 'verified',
      label: 'Verify',
      state:
        task.state === 'COMPLETED'
          ? 'SUCCEEDED'
          : task.state === 'VERIFYING'
            ? 'VERIFYING'
            : verificationActions.some(action => action.state === 'FAILED')
              ? 'FAILED'
              : 'READY',
      detail: `${verified}/${verificationActions.length} verified`
    },
    {
      id: 'memory',
      icon: 'database',
      label: 'Persist',
      state: task.state === 'COMPLETED' ? 'SUCCEEDED' : 'ACTIVE',
      detail: task.workspace_id ? `workspace ${compactId(task.workspace_id)}` : 'durable ledger'
    }
  ]

  return (
    <section className="aos-panel overflow-hidden">
      <SectionHeader
        icon="type-hierarchy"
        meta={recovery ? `${task.metrics.recoveries} recovery` : 'live execution path'}
        title="Process map"
      />
      <div className="aos-process-map aos-scrollbar overflow-x-auto p-3">
        <div className="flex min-w-max items-stretch">
          {stages.map((stage, index) => (
            <div className="flex items-center" key={stage.id}>
              <div className="w-36 rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid size-6 shrink-0 place-items-center rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
                    <Codicon name={stage.icon} size="0.7rem" />
                  </div>
                  <StateBadge compact state={stage.state} />
                </div>
                <div className="mt-2 text-[0.68rem] font-semibold text-foreground">{stage.label}</div>
                <div
                  className="mt-1 line-clamp-2 min-h-7 text-[0.58rem] leading-relaxed text-(--ui-text-tertiary)"
                  title={stage.detail}
                >
                  {stage.detail}
                </div>
              </div>
              {index < stages.length - 1 && (
                <div className="relative mx-1.5 h-px w-8 bg-(--ui-stroke-tertiary)">
                  <Codicon
                    className="absolute -right-1.5 top-1/2 -translate-y-1/2 text-(--ui-text-tertiary)"
                    name="chevron-right"
                    size="0.55rem"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {recovery && (
        <div className="flex items-center gap-2 border-t border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,#d49b45_7%,transparent)] px-3 py-2 text-[0.6rem] text-(--ui-text-tertiary)">
          <Codicon name="debug-restart" size="0.68rem" />
          Recovery is part of this execution path · {task.metrics.recoveries} recorded attempt
          {task.metrics.recoveries === 1 ? '' : 's'}
        </div>
      )}
    </section>
  )
}

function Overview({
  onSelect,
  query,
  selected,
  snapshot
}: {
  onSelect: (id: string) => void
  query: string
  selected?: AgentOSTask
  snapshot: AgentOSSnapshot
}) {
  return (
    <div className="space-y-3">
      <SummaryGrid snapshot={snapshot} />

      <div
        className="aos-overview-grid grid min-h-0 gap-3"
        style={{ gridTemplateColumns: 'minmax(14rem,0.62fr) minmax(24rem,1.5fr) minmax(16rem,0.78fr)' }}
      >
        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="checklist" meta={`${snapshot.summary.active_tasks} active`} title="Tasks" />
          <TaskList onSelect={onSelect} query={query} selectedId={selected?.id} tasks={snapshot.tasks} />
        </section>

        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="list-tree" meta={selected?.plan ? selected.plan.state : 'no plan'} title="Live plan" />
          <PlanGraph plan={selected?.plan} />
        </section>

        <section className="aos-panel min-w-0 overflow-hidden">
          <SectionHeader icon="pulse" meta={selected ? compactId(selected.id) : undefined} title="Live activity" />
          <Timeline events={selected?.events ?? []} />
        </section>
      </div>

      {selected && (
        <>
          <ExecutionCanvas task={selected} />
          <RuntimeObservatory task={selected} />
          <ProcessMap task={selected} />
          <AttentionQueue task={selected} />
          <SafetyStrip task={selected} />
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="aos-panel min-w-0 overflow-hidden">
              <SectionHeader icon="hubot" meta={`${selected.agents.length}`} title="Agent topology" />
              <AgentsPanel agents={selected.agents} />
            </section>
            <section className="aos-panel min-w-0 overflow-hidden">
              <SectionHeader icon="shield" title="Execution controls" />
              <ActionControls actions={selected.actions} />
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function MemoryTopology({ snapshot }: { snapshot: AgentOSSnapshot }) {
  const memory = snapshot.memory

  const nodes = [
    {
      id: 'workspaces',
      icon: 'folder',
      label: 'Workspaces',
      value: memory.workspaces.length,
      detail: 'Where durable work is scoped'
    },
    {
      id: 'sessions',
      icon: 'comment-discussion',
      label: 'Sessions',
      value: memory.sessions.length,
      detail: 'Conversation lineage into tasks'
    },
    {
      id: 'checkpoints',
      icon: 'save',
      label: 'Checkpoints',
      value: memory.checkpoints.length,
      detail: 'Recovery and rollback anchors'
    },
    {
      id: 'events',
      icon: 'pulse',
      label: 'Event memory',
      value: snapshot.summary.events,
      detail: `${memory.event_types.length} event kinds`
    }
  ]

  return (
    <section className="aos-panel overflow-hidden">
      <SectionHeader icon="type-hierarchy" meta={`${memory.relations.length} relations`} title="Memory topology" />
      <div className="aos-topology p-5">
        <div className="aos-topology-core rounded-lg border border-[color-mix(in_srgb,var(--dt-primary)_35%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-primary)_7%,var(--ui-bg-secondary))] p-3 text-center">
          <div className="mx-auto mb-2 grid size-8 place-items-center rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
            <Codicon name="database" size="0.95rem" />
          </div>
          <div className="text-sm font-semibold text-foreground">Durable Store</div>
          <div className="mt-1 text-[0.62rem] text-(--ui-text-tertiary)">Agent OS operational memory</div>
        </div>

        <div className="aos-topology-grid">
          {nodes.map(node => (
            <div className="aos-topology-node" key={node.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Codicon className="text-(--ui-text-tertiary)" name={node.icon} size="0.72rem" />
                    <span className="text-xs font-medium text-foreground">{node.label}</span>
                  </div>
                  <div className="mt-1.5 text-lg font-semibold tabular-nums tracking-tight text-foreground">
                    {node.value}
                  </div>
                  <div className="mt-0.5 text-[0.6rem] leading-relaxed text-(--ui-text-tertiary)">
                    {node.detail}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function MemoryView({ snapshot }: { snapshot: AgentOSSnapshot }) {
  const memory = snapshot.memory

  return (
    <div className="space-y-3">
      <div className="aos-panel p-4">
        <div className="aos-kicker">Operational memory</div>
        <div className="mt-1.5 max-w-3xl text-lg font-semibold tracking-tight text-foreground">
          What Agent OS remembers about execution
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          This graph is derived from the durable execution ledger: workspaces, originating sessions, checkpoints,
          tasks and event history. It is separate from conversational semantic memory and exists so autonomous work
          can resume, be audited and be explained after a restart.
        </p>
      </div>

      <SemanticMemorySection />

      <MemoryTopology snapshot={snapshot} />

      <div className="aos-summary-grid grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard icon="folder" label="Workspaces" value={memory.workspaces.length} />
        <MetricCard icon="comment-discussion" label="Sessions" value={memory.sessions.length} />
        <MetricCard icon="save" label="Checkpoints" value={memory.checkpoints.length} />
        <MetricCard icon="git-merge" label="Relations" value={memory.relations.length} />
      </div>      <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr]">
        <section className="aos-panel overflow-hidden">
          <SectionHeader icon="folder" meta={`${memory.workspaces.length}`} title="Workspace memory" />
          <div className="aos-memory-column aos-scrollbar max-h-[30rem] space-y-1 overflow-y-auto p-3">
            {memory.workspaces.length === 0 ? (
              <div className="pl-6 text-xs text-(--ui-text-tertiary)">No workspace relations recorded.</div>
            ) : (
              memory.workspaces.map(workspace => (
                <div className="aos-memory-node py-1.5" key={workspace.id}>
                  <div className="truncate font-mono text-[0.68rem] text-foreground" title={workspace.id}>
                    {compactId(workspace.id)}
                  </div>
                  <div className="mt-0.5 text-[0.6rem] text-(--ui-text-tertiary)">
                    {workspace.tasks} tasks · {workspace.active_tasks} active
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="aos-panel overflow-hidden">
          <SectionHeader icon="comment-discussion" meta={`${memory.sessions.length}`} title="Session lineage" />
          <div className="aos-memory-column aos-scrollbar max-h-[30rem] space-y-1 overflow-y-auto p-3">
            {memory.sessions.length === 0 ? (
              <div className="pl-6 text-xs text-(--ui-text-tertiary)">No session links recorded.</div>
            ) : (
              memory.sessions.map(session => (
                <div className="aos-memory-node py-1.5" key={session.id}>
                  <div className="truncate font-mono text-[0.68rem] text-foreground" title={session.id}>
                    {compactId(session.id)}
                  </div>
                  <div className="mt-0.5 text-[0.6rem] text-(--ui-text-tertiary)">{session.tasks} durable tasks</div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="aos-panel overflow-hidden">
          <SectionHeader icon="pulse" meta={`${memory.event_types.length} kinds`} title="Memory signals" />
          <div className="aos-scrollbar max-h-[30rem] overflow-y-auto p-3">
            <div className="space-y-1">
              {memory.event_types.slice(0, 18).map(event => (
                <div className="flex items-center justify-between gap-3 rounded px-1.5 py-1.5 hover:bg-(--ui-control-hover-background)" key={event.type}>
                  <span className="truncate text-[0.68rem] text-(--ui-text-secondary)">{humanize(event.type)}</span>
                  <span className="shrink-0 font-mono text-[0.62rem] tabular-nums text-(--ui-text-tertiary)">
                    {event.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="aos-panel overflow-hidden">
        <SectionHeader icon="git-merge" meta={`${memory.relations.length} visible`} title="Relationship ledger" />
        <div className="aos-scrollbar max-h-[22rem] overflow-y-auto p-2.5">
          {memory.relations.length === 0 ? (
            <div className="p-3 text-xs text-(--ui-text-tertiary)">Relations appear as tasks bind to workspaces, sessions and checkpoints.</div>
          ) : (
            <div className="grid gap-1 md:grid-cols-2">
              {[...memory.relations].slice(-60).reverse().map((edge, index) => (
                <div className="flex min-w-0 items-center gap-2 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-2" key={`${edge.source}-${edge.target}-${index}`}>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.62rem] text-(--ui-text-secondary)">
                    {compactId(edge.source)}
                  </span>
                  <span className="shrink-0 text-[0.58rem] uppercase tracking-[0.08em] text-(--ui-text-tertiary)">
                    {edge.relation}
                  </span>
                  <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="arrow-right" size="0.65rem" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.62rem] text-(--ui-text-secondary)">
                    {compactId(edge.target)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ConnectionsView({ snapshot }: { snapshot: AgentOSSnapshot }) {
  return (
    <div className="space-y-3">
      <div className="aos-panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="aos-kicker">Connections</div>
            <div className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">Runtime topology</div>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
              The graph below is runtime truth, not a configured wish-list. Health probes represent the durable store,
              browser and native computer-use substrate; tools and agent runtimes appear as they are available or observed.
            </p>
          </div>
          <button
            className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-1.5 text-[0.68rem] font-medium text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={() => host.navigate('/capabilities')}
            type="button"
          >
            Manage capabilities
          </button>
        </div>
      </div>

      <section className="aos-panel overflow-hidden">
        <SectionHeader icon="type-hierarchy" meta={`${snapshot.topology.edges.length} links`} title="Execution topology" />
        <RuntimeTopologyCanvas edges={snapshot.topology.edges} nodes={snapshot.topology.nodes} />
      </section>

      <ExternalConnectionsSection />

      <section className="aos-panel overflow-hidden">
        <SectionHeader icon="heart" meta={snapshot.health.full_ready ? 'FULL READY' : snapshot.health.core_ready ? 'CORE READY' : 'DEGRADED'} title="Health contract" />
        <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-4">
          {snapshot.health.checks.map(check => (
            <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5" key={check.name}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">{humanize(check.name)}</div>
                  <div className="mt-1 line-clamp-3 text-[0.62rem] leading-relaxed text-(--ui-text-tertiary)">
                    {check.detail}
                  </div>
                </div>
                <StateBadge compact state={check.status} />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function OperationsView() {
  const operations = useHermesOperations()
  const audit = useAgentOSAudit()
  const routes = operations.routes.data ?? []

  const rows = operations.snapshots.flatMap(snapshot =>
    snapshot.tasks.map(task => ({ snapshot, task }))
  )

  const running = rows.filter(row => row.task.status === 'running').length

  const attention = rows.filter(
    row => row.task.status === 'blocked' || row.task.status === 'review' || Boolean(row.task.warning?.count)
  ).length

  return (
    <div className="space-y-3">
      <div className="aos-summary-grid grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard icon="plug" label="Sources" value={operations.sources.length} />
        <MetricCard icon="checklist" label="Operational tasks" value={rows.length} />
        <MetricCard icon="pulse" label="Running" value={running} />
        <MetricCard icon="bell" label="Needs attention" value={attention} />
      </div>

      <section className="aos-panel overflow-hidden">
        <SectionHeader
          icon="server-process"
          meta={operations.query.isFetching ? 'refreshing' : `${rows.length} visible`}
          title="Operational work"
        />
        {operations.query.error ? (
          <div className="p-4 text-xs text-destructive">
            {operations.query.error instanceof Error ? operations.query.error.message : String(operations.query.error)}
          </div>
        ) : rows.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-6 text-center text-xs text-(--ui-text-tertiary)">
            No external operational tasks are currently published.
          </div>
        ) : (
          <div className="aos-scrollbar max-h-[38rem] overflow-y-auto p-2.5">
            <div className="space-y-1.5">
              {rows.map(({ snapshot, task }) => {
                const source = operations.sources.find(item => item.id === snapshot.sourceId)
                const workerRoute = exactWorkerRoute(task, snapshot, routes)
                const originRoute = exactOperationsRoute(snapshot.connectionId, snapshot.profile, routes)

                return (
                  <div
                    className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5"
                    key={`${snapshot.sourceId}:${snapshot.scopeKey ?? ''}:${task.id}`}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="aos-kicker">{snapshot.sourceLabel}</span>
                          {snapshot.scopeLabel && (
                            <span className="truncate text-[0.56rem] text-(--ui-text-quaternary)">
                              {snapshot.scopeLabel}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 truncate text-xs font-medium text-foreground" title={task.title}>
                          {task.title}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.58rem] text-(--ui-text-tertiary)">
                          {task.assignee && <span>assignee {task.assignee}</span>}
                          {task.projectName && <span>project {task.projectName}</span>}
                          {task.runId != null && <span>run {task.runId}</span>}
                          {task.warning?.count ? <span>{task.warning.count} diagnostic(s)</span> : null}
                        </div>
                      </div>
                      <StateBadge compact state={task.status} />
                    </div>

                    <div className="mt-2 flex flex-wrap justify-end gap-1.5">
                      {source?.openTask && (
                        <button
                          className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.58rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                          onClick={() => source.openTask?.(task.id)}
                          type="button"
                        >
                          Open source
                        </button>
                      )}
                      {task.originSessionId && originRoute && (
                        <button
                          className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.58rem] text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
                          onClick={() => openHermesSession(task.originSessionId!, originRoute)}
                          type="button"
                        >
                          Origin
                        </button>
                      )}
                      {task.workerSessionId && workerRoute && (
                        <button
                          aria-label="Open the exact worker session bound to this run"
                          className="rounded border border-[color-mix(in_srgb,var(--dt-primary)_40%,var(--ui-stroke-tertiary))] px-2 py-1 text-[0.58rem] font-medium text-foreground hover:bg-(--ui-control-hover-background)"
                          onClick={() => openHermesSession(task.workerSessionId!, workerRoute)}
                          type="button"
                        >
                          Worker
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </section>

      <section className="aos-panel overflow-hidden">
        <SectionHeader
          icon="history"
          meta={audit.data ? `${audit.data.events.length} recent` : undefined}
          title="Operator audit"
        />
        {audit.isLoading ? (
          <div className="grid min-h-32 place-items-center text-xs text-(--ui-text-tertiary)">
            Reading metadata-only audit history…
          </div>
        ) : audit.error ? (
          <div className="p-4 text-xs text-destructive">
            {audit.error instanceof Error ? audit.error.message : String(audit.error)}
          </div>
        ) : !audit.data?.events.length ? (
          <div className="grid min-h-32 place-items-center text-xs text-(--ui-text-tertiary)">
            No durable operator events recorded yet.
          </div>
        ) : (
          <div className="aos-scrollbar max-h-[24rem] overflow-y-auto p-2.5">
            <div className="space-y-1">
              {audit.data.events.map(event => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-2"
                  key={event.id}
                >
                  <div className="min-w-0">
                    <div className="truncate text-[0.66rem] font-medium text-foreground">{humanize(event.event)}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-[0.56rem] text-(--ui-text-tertiary)">
                      <span>{event.category}</span>
                      {event.subject && <span>{event.subject}</span>}
                      {event.outcome && <span>{event.outcome}</span>}
                      {event.task_id && <span>task {compactId(event.task_id)}</span>}
                      {event.run_id != null && <span>run {event.run_id}</span>}
                      {event.project_id && <span>project {compactId(event.project_id)}</span>}
                    </div>
                  </div>
                  <span className="shrink-0 text-[0.56rem] tabular-nums text-(--ui-text-quaternary)">
                    {formatDateTime(new Date(event.created_at * 1000).toISOString())}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2 text-[0.56rem] leading-relaxed text-(--ui-text-quaternary)">
          Metadata only · no prompt text, command text, secrets, verification codes, URLs, headers or tool output are stored.
        </div>
      </section>
    </div>
  )
}

function FleetView() {
  const fleet = useLiveFleet()
  const sessions = fleet.data.sessions
  const subagents = sessions.reduce((total, session) => total + session.subagents.length, 0)
  const active = sessions.filter(session => ['working', 'waiting', 'starting'].includes(session.status)).length

  return (
    <div className="space-y-3">
      <div className="aos-summary-grid grid grid-cols-2 gap-2 md:grid-cols-4">
        <MetricCard icon="comment-discussion" label="Live sessions" value={sessions.length} />
        <MetricCard icon="pulse" label="Active sessions" value={active} />
        <MetricCard icon="hubot" label="Subagents" value={subagents} />
        <MetricCard
          icon="history"
          label="Snapshot"
          value={fleet.updatedAt ? formatTime(new Date(fleet.updatedAt).toISOString()) : '—'}
        />
      </div>

      <section className="aos-panel overflow-hidden">
        <SectionHeader icon="type-hierarchy" meta={`${sessions.length} gateway session(s)`} title="Live fleet" />
        {sessions.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-6 text-center text-xs text-(--ui-text-tertiary)">
            No live sessions are currently reported by the active gateway scope.
          </div>
        ) : (
          <div className="aos-scrollbar max-h-[40rem] space-y-2 overflow-y-auto p-3">
            {sessions.map(session => (
              <div
                className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5"
                key={session.id}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <button
                    aria-label="Open Hermes session"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => openHermesSession(session.id)}
                    type="button"
                  >
                    <div className="truncate text-xs font-medium text-foreground">
                      {session.title || session.preview || session.session_key}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.58rem] text-(--ui-text-tertiary)">
                      {session.model && <span>{session.model}</span>}
                      <span>{session.message_count} messages</span>
                      <span>{session.subagents.length} subagent(s)</span>
                    </div>
                  </button>
                  <StateBadge compact state={session.status} />
                </div>

                {session.subagents.length > 0 && (
                  <div className="mt-2 grid gap-1.5 border-t border-(--ui-stroke-tertiary) pt-2 md:grid-cols-2">
                    {session.subagents.map(agent => (
                      <div
                        className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2"
                        key={agent.subagent_id}
                      >
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[0.65rem] font-medium text-foreground">
                              {agent.goal || agent.subagent_id}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[0.55rem] text-(--ui-text-tertiary)">
                              {agent.model && <span>{agent.model}</span>}
                              {agent.last_tool && <span>tool {agent.last_tool}</span>}
                              {agent.tool_count != null && <span>{agent.tool_count} calls</span>}
                            </div>
                          </div>
                          <StateBadge compact state={agent.status || 'ACTIVE'} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SecurityView() {
  const computerUse = useComputerUseSecurity()
  const telemetry = useTelemetrySecurity()
  const network = useNetworkSecurity()

  const networkRows = network.data
    ? [
        ['Model provider', network.data.model_provider.class, network.data.model_provider.provider],
        ['MCP', network.data.mcp.enabled ? 'mixed' : 'disabled', `${network.data.mcp.enabled}/${network.data.mcp.configured} enabled`],
        ['Shared metrics', network.data.telemetry.class, network.data.telemetry.transmission_enabled ? 'transmitting' : 'not transmitting'],
        ['Browser', network.data.browser.class, 'user-directed destinations'],
        ['Computer use', network.data.computer_use.class, 'controlled apps may have their own egress'],
        ['Messaging', network.data.messaging.class, 'no narrow runtime authority'],
        ['Updates', network.data.updates.class, network.data.updates.mode]
      ]
    : []

  return (
    <div className="space-y-3">
      <div className="aos-panel p-4">
        <div className="aos-kicker">Security & privacy</div>
        <div className="mt-1.5 text-lg font-semibold tracking-tight text-foreground">Execution boundary</div>
        <p className="mt-2 max-w-4xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          This surface reports sanitized runtime/config authorities only. Unknown means Hermes cannot prove the boundary;
          it does not mean offline. Raw endpoints, secrets, headers, commands and prompt content are intentionally absent.
        </p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="aos-panel overflow-hidden">
          <SectionHeader icon="shield" title="Computer Use" />
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <MetricCard
              icon="lock"
              label="Permission mode"
              value={computerUse.data?.permission_mode?.toUpperCase() ?? (computerUse.isLoading ? '…' : 'UNKNOWN')}
            />
            <MetricCard
              icon="broadcast"
              label="Driver telemetry"
              value={computerUse.data ? (computerUse.data.telemetry_enabled ? 'ENABLED' : 'DISABLED') : 'UNKNOWN'}
            />
          </div>
          {computerUse.data && (
            <div className="border-t border-(--ui-stroke-tertiary) p-3 text-[0.62rem] leading-relaxed text-(--ui-text-tertiary)">
              Capability manifest · {computerUse.data.manifest.configured ? 'configured' : 'not configured'}
              {computerUse.data.manifest.configured
                ? ` · ${computerUse.data.manifest.readable ? 'readable' : 'unreadable'} · v${computerUse.data.manifest.version ?? 'unknown'}`
                : ''}
              {computerUse.data.manifest.required ? ' · required by bounded mode' : ''}
            </div>
          )}
          {computerUse.error && <div className="p-3 text-xs text-destructive">{String(computerUse.error)}</div>}
        </section>

        <section className="aos-panel overflow-hidden">
          <SectionHeader icon="radio-tower" title="Shared metrics" />
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <MetricCard
              icon="database"
              label="Collection"
              value={telemetry.data ? (telemetry.data.shared_metrics.collection_enabled ? 'ENABLED' : 'DISABLED') : 'UNKNOWN'}
            />
            <MetricCard
              icon="cloud-upload"
              label="Transmission"
              value={telemetry.data ? (telemetry.data.shared_metrics.transmission_enabled ? 'ENABLED' : 'DISABLED') : 'UNKNOWN'}
            />
          </div>
          {telemetry.data && (
            <div className="border-t border-(--ui-stroke-tertiary) p-3 text-[0.62rem] text-(--ui-text-tertiary)">
              Destination class · {humanize(telemetry.data.shared_metrics.destination)}
              {telemetry.data.shared_metrics.transmission_requested && !telemetry.data.shared_metrics.transmission_enabled
                ? ' · transmission requested but not effective'
                : ''}
            </div>
          )}
          {telemetry.error && <div className="p-3 text-xs text-destructive">{String(telemetry.error)}</div>}
        </section>
      </div>

      <section className="aos-panel overflow-hidden">
        <SectionHeader icon="globe" meta={network.data?.coverage === 'partial' ? 'PARTIAL COVERAGE' : undefined} title="Outbound network inventory" />
        {network.isLoading ? (
          <div className="grid min-h-32 place-items-center text-xs text-(--ui-text-tertiary)">Reading sanitized network posture…</div>
        ) : network.error ? (
          <div className="p-4 text-xs text-destructive">{String(network.error)}</div>
        ) : (
          <div className="grid gap-1 p-3 md:grid-cols-2">
            {networkRows.map(([label, state, detail]) => (
              <div className="flex min-w-0 items-center gap-3 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5" key={label}>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className="mt-0.5 truncate text-[0.6rem] text-(--ui-text-tertiary)">{detail}</div>
                </div>
                <StateBadge compact state={String(state).toUpperCase()} />
              </div>
            ))}
          </div>
        )}
        <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2 text-[0.56rem] leading-relaxed text-(--ui-text-quaternary)">
          Classification only · no live network probe is performed. Browser destinations and app-driven Computer Use egress remain unknown by design.
        </div>
      </section>
    </div>
  )
}

function TasksView({
  onSelect,
  query,
  selected,
  snapshot
}: {
  onSelect: (id: string) => void
  query: string
  selected?: AgentOSTask
  snapshot: AgentOSSnapshot
}) {
  return (
    <div className="grid min-h-0 gap-3 xl:grid-cols-[19rem_minmax(0,1fr)]">
      <section className="aos-panel min-w-0 overflow-hidden">
        <SectionHeader icon="checklist" meta={`${snapshot.tasks.length} loaded`} title="Durable tasks" />
        <TaskList onSelect={onSelect} query={query} selectedId={selected?.id} tasks={snapshot.tasks} />
      </section>
      <div className="min-w-0">
        {selected ? (
          <TaskDetail task={selected} />
        ) : (
          <div className="aos-panel grid min-h-72 place-items-center p-8 text-center">
            <div>
              <Codicon className="mx-auto text-(--ui-text-tertiary)" name="checklist" size="1.5rem" />
              <div className="mt-3 text-sm font-medium text-foreground">Select a task</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function EmptyStore({ snapshot }: { snapshot: AgentOSSnapshot }) {
  return (
    <div className="aos-panel grid min-h-72 place-items-center p-8 text-center">
      <div className="max-w-lg">
        <Codicon className="mx-auto text-(--ui-text-tertiary)" name="database" size="1.7rem" />
        <div className="mt-3 text-sm font-semibold text-foreground">Agent OS is ready for durable work</div>
        <p className="mt-1.5 text-xs leading-relaxed text-(--ui-text-tertiary)">
          The execution ledger has no tasks yet. Mission Control will populate automatically when an Agent OS goal is
          submitted. Runtime health and connections remain visible now.
        </p>
        {snapshot.store_error && (
          <div className="mt-4 rounded-md border border-[color-mix(in_srgb,var(--dt-destructive)_35%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-destructive)_7%,transparent)] p-2 text-left text-[0.65rem] text-destructive">
            {snapshot.store_error}
          </div>
        )}
      </div>
    </div>
  )
}

export function AgentOSMissionControl() {
  const [tab, setTab] = useState<MissionTab>('overview')
  const [selectedId, setSelectedId] = useState<string>()
  const [query, setQuery] = useState('')

  const { data: snapshot, error, isFetching, refetch } = useQuery({
    queryFn: fetchAgentOSSnapshot,
    queryKey: AGENT_OS_SNAPSHOT_KEY,
    refetchInterval: 20_000
  })

  const selected = useMemo(() => {
    if (!snapshot?.tasks.length) {
      return undefined
    }

    const explicit = selectedId ? snapshot.tasks.find(task => task.id === selectedId) : undefined

    return explicit ?? snapshot.tasks.find(isActiveTask) ?? snapshot.tasks[0]
  }, [selectedId, snapshot])

  const tabs: Array<{ id: MissionTab; label: string; icon: string }> = [
    { id: 'overview', label: 'Mission Control', icon: 'dashboard' },
    { id: 'tasks', label: 'Tasks', icon: 'checklist' },
    { id: 'operations', label: 'Operations', icon: 'server-process' },
    { id: 'projects', label: 'Projects', icon: 'project' },
    { id: 'fleet', label: 'Fleet', icon: 'hubot' },
    { id: 'memory', label: 'Memory', icon: 'database' },
    { id: 'connections', label: 'Connections', icon: 'type-hierarchy' },
    { id: 'security', label: 'Security', icon: 'shield' }
  ]

  return (
    <section className="agent-os-page flex min-h-0 flex-col">
      <header className="aos-mission-header shrink-0 border-b border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,var(--ui-bg-primary)_92%,transparent)] px-4 pb-3 pt-4 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="grid size-7 shrink-0 place-items-center rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)">
                <Codicon name="circuit-board" size="0.9rem" />
              </div>
              <div className="min-w-0">
                <div className="aos-kicker">Agent OS</div>
                <h1 className="truncate text-base font-semibold tracking-tight text-foreground">Mission Control</h1>
              </div>
            </div>
            {selected && (
              <div className="mt-2 max-w-3xl truncate text-[0.68rem] text-(--ui-text-tertiary)" title={selected.goal}>
                Focus · {selected.goal}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {snapshot && (
              <span className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2 py-1">
                <StateBadge compact state={snapshot.health.full_ready ? 'PASS' : snapshot.health.core_ready ? 'WARN' : 'FAIL'} />
              </span>
            )}
            <button
              aria-label="Refresh Agent OS"
              className="grid size-7 place-items-center rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
              onClick={() => {
                void refetch()
                void queryClient.invalidateQueries({ queryKey: AGENT_OS_CONTEXT_KEY })
                void queryClient.invalidateQueries({ queryKey: AGENT_OS_MISSIONS_KEY })
                void queryClient.invalidateQueries({ queryKey: AGENT_OS_APPROVALS_KEY })
              }}
              type="button"
            >
              <Codicon className={cn(isFetching && 'animate-spin')} name="refresh" size="0.8rem" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Agent OS sections" className="aos-primary-nav aos-scrollbar flex min-w-0 max-w-full gap-0.5 overflow-x-auto rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-0.5">
            {tabs.map(item => (
              <button
                aria-pressed={tab === item.id}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-[0.68rem] font-medium text-(--ui-text-tertiary) transition-colors',
                  tab === item.id && 'bg-(--ui-control-active-background) text-foreground'
                )}
                key={item.id}
                onClick={() => setTab(item.id)}
                type="button"
              >
                <Codicon name={item.icon} size="0.7rem" />
                {item.label}
              </button>
            ))}
          </nav>

          {(tab === 'overview' || tab === 'tasks') && (
            <div className="relative w-64 max-w-full">
              <Codicon className="absolute left-2 top-1/2 -translate-y-1/2 text-(--ui-text-tertiary)" name="search" size="0.7rem" />
              <input
                aria-label="Filter Agent OS tasks"
                className="h-7 w-full rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) pl-7 pr-2 text-[0.68rem] text-foreground outline-none placeholder:text-(--ui-text-quaternary) focus:border-[color-mix(in_srgb,var(--dt-primary)_45%,var(--ui-stroke-tertiary))]"
                onChange={event => setQuery(event.target.value)}
                placeholder="Filter tasks, states, workspaces…"
                value={query}
              />
            </div>
          )}
        </div>
      </header>

      <div className="aos-scrollbar min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <div className="aos-panel grid min-h-72 place-items-center p-8 text-center">
            <div className="max-w-lg">
              <Codicon className="mx-auto text-destructive" name="error" size="1.6rem" />
              <div className="mt-3 text-sm font-semibold text-foreground">Mission Control API unavailable</div>
              <p className="mt-1.5 text-xs leading-relaxed text-(--ui-text-tertiary)">
                {error instanceof Error ? error.message : String(error)}              </p>
              <button
                className="mt-4 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-3 py-1.5 text-xs font-medium text-foreground hover:bg-(--ui-control-hover-background)"
                onClick={() => void refetch()}
                type="button"
              >
                Retry
              </button>
            </div>
          </div>
        ) : !snapshot ? (
          <div className="grid min-h-72 place-items-center">
            <div className="flex items-center gap-2 text-xs text-(--ui-text-tertiary)">
              <Codicon className="animate-spin" name="loading" size="0.85rem" />
              Reading durable Agent OS state…
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3">
              <MissionControlActions
                coreReady={snapshot.health.core_ready}
                onSelectTask={taskId => {
                  setSelectedId(taskId)
                  setTab('tasks')
                }}
              />
            </div>
            {tab === 'overview' &&
              (snapshot.tasks.length ? (
                <Overview
                  onSelect={setSelectedId}
                  query={query}
                  selected={selected}
                  snapshot={snapshot}
                />
              ) : (
                <div className="space-y-3">
                  <SummaryGrid snapshot={snapshot} />
                  <EmptyStore snapshot={snapshot} />
                  <ConnectionsView snapshot={snapshot} />
                </div>
              ))}
            {tab === 'tasks' && (
              <TasksView
                onSelect={setSelectedId}
                query={query}
                selected={selected}
                snapshot={snapshot}
              />
            )}
            {tab === 'operations' && <OperationsView />}
            {tab === 'projects' && <ProjectsView />}
            {tab === 'fleet' && <FleetView />}
            {tab === 'memory' && <MemoryView snapshot={snapshot} />}
            {tab === 'connections' && <ConnectionsView snapshot={snapshot} />}
            {tab === 'security' && <SecurityView />}
          </>
        )}
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-3 py-1.5 text-[0.58rem] text-(--ui-text-tertiary)">
        <span className="truncate">
          {snapshot ? `ledger · ${snapshot.store_path}` : 'Agent OS durable ledger'}
        </span>
        <span className="shrink-0 tabular-nums">
          {snapshot ? `snapshot ${formatTime(snapshot.generated_at)}` : 'connecting'}
        </span>
      </footer>
    </section>
  )
}

export function AgentOSStatusChip() {
  const { data } = useQuery({
    queryFn: fetchAgentOSSnapshot,
    queryKey: AGENT_OS_SNAPSHOT_KEY,
    refetchInterval: 30_000
  })

  if (!data) {
    return null
  }

  const state = data.health.full_ready ? 'PASS' : data.health.core_ready ? 'WARN' : 'FAIL'

  return (
    <button
      aria-label={`Agent OS · ${data.summary.active_tasks} active tasks · ${data.summary.active_agents} active agents`}
      className="aos-state inline-flex h-full items-center gap-1.5 rounded-none px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
      data-state={state}
      onClick={() => host.navigate('/agent-os')}
      type="button"
    >
      <span className="aos-state-dot" />
      <span>Agent OS</span>
      {data.summary.active_tasks > 0 && <span className="tabular-nums">{data.summary.active_tasks}</span>}
    </button>
  )
}