import { cn, Codicon, host, queryClient, useQuery } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import './agent-os.css'
import { AGENT_OS_CONTEXT_KEY, AGENT_OS_SNAPSHOT_KEY, fetchAgentOSSnapshot } from './api'
import { ExternalConnectionsSection, SemanticMemorySection } from './context'
import type {
  AgentOSAction,
  AgentOSAgent,
  AgentOSEvent,
  AgentOSPlan,
  AgentOSPlanStep,
  AgentOSSnapshot,
  AgentOSTask,
  AgentOSTopologyNode
} from './types'

type MissionTab = 'overview' | 'tasks' | 'memory' | 'connections'

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
                      <Codicon
                        className="mt-0.5 shrink-0 text-(--ui-text-tertiary)"
                        name={stateGlyph(step.state)}
                        size="0.78rem"
                      />
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
    </div>
  )
}

function eventIcon(type: string): string {
  if (type.startsWith('agent.')) return 'hubot'
  if (type.startsWith('plan')) return 'list-tree'
  if (type.startsWith('action.')) return 'tools'
  if (type.startsWith('verification.')) return 'verified'
  if (type.startsWith('recovery.')) return 'debug-restart'
  if (type.startsWith('approval.') || type.startsWith('risk.')) return 'shield'
  if (type.startsWith('checkpoint.')) return 'save'
  if (type.startsWith('artifact.')) return 'files'

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
  const rows = [...events].slice(-32).reverse()

  if (rows.length === 0) {
    return (
      <div className="grid min-h-48 place-items-center p-6 text-center text-xs text-(--ui-text-tertiary)">
        No execution events recorded yet.
      </div>
    )
  }

  return (
    <div className="aos-scrollbar max-h-[34rem] overflow-y-auto p-3">
      <div className="aos-timeline space-y-3">
        {rows.map(event => (
          <div className="aos-timeline-row" key={event.id}>
            <span className="aos-timeline-glyph">
              <Codicon name={eventIcon(event.type)} size="0.7rem" />
            </span>
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
          <div className="flex w-full min-w-0 items-start justify-between gap-3">
            <span className="line-clamp-2 min-w-0 text-xs font-medium leading-relaxed text-foreground">{task.goal}</span>
            <StateBadge compact state={task.state} />
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
              <StateBadge compact state={action.state} />
            </div>
            {action.error && (
              <div className="mt-2 rounded bg-[color-mix(in_srgb,var(--dt-destructive)_8%,transparent)] px-2 py-1.5 text-[0.62rem] leading-relaxed text-destructive">
                {action.error}
              </div>
            )}
          </div>
        ))}
      </div>
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
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-(--ui-text-tertiary)">
        <span>created {formatDateTime(task.created_at)}</span>
        <span>updated {formatDateTime(task.updated_at)}</span>
        {task.session_id && <span>session {compactId(task.session_id)}</span>}
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

      <SafetyStrip task={task} />

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
      </div>

      <div className="grid gap-3 xl:grid-cols-[1fr_1fr_1fr]">
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

function TopologyNode({ node }: { node: AgentOSTopologyNode }) {
  return (
    <div className="aos-topology-node" data-status={node.status}>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="aos-kicker">{humanize(node.kind)}</div>
          <div className="mt-1 truncate text-xs font-semibold text-foreground">{node.label}</div>
        </div>
        <StateBadge compact state={node.status} />
      </div>
      {node.detail && <div className="mt-2 line-clamp-3 text-[0.62rem] leading-relaxed text-(--ui-text-tertiary)">{node.detail}</div>}
      {node.remediation && (
        <div className="mt-2 border-t border-(--ui-stroke-tertiary) pt-2 text-[0.6rem] leading-relaxed text-(--ui-text-tertiary)">
          {node.remediation}
        </div>
      )}
    </div>
  )
}

function ConnectionsView({ snapshot }: { snapshot: AgentOSSnapshot }) {
  const core = snapshot.topology.nodes.find(node => node.id === 'agent-os')
  const children = snapshot.topology.nodes.filter(node => node.id !== 'agent-os')

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
        <div className="aos-topology p-5">
          {core && (
            <div className="aos-topology-core rounded-lg border border-[color-mix(in_srgb,var(--dt-primary)_35%,var(--ui-stroke-tertiary))] bg-[color-mix(in_srgb,var(--dt-primary)_7%,var(--ui-bg-secondary))] p-3 text-center">
              <div className="mx-auto mb-2 grid size-8 place-items-center rounded-full border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
                <Codicon name="circuit-board" size="0.95rem" />
              </div>
              <div className="text-sm font-semibold text-foreground">{core.label}</div>
              <div className="mt-1 flex justify-center">
                <StateBadge compact state={core.status} />
              </div>
            </div>
          )}

          <div className="aos-topology-grid">
            {children.map(node => (
              <TopologyNode key={node.id} node={node} />
            ))}
          </div>
        </div>
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
    { id: 'memory', label: 'Memory', icon: 'database' },
    { id: 'connections', label: 'Connections', icon: 'type-hierarchy' }
  ]

  return (
    <section className="agent-os-page flex min-h-0 flex-col">
      <header className="shrink-0 border-b border-(--ui-stroke-tertiary) bg-[color-mix(in_srgb,var(--ui-bg-primary)_92%,transparent)] px-4 pb-3 pt-4 backdrop-blur">
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
              }}
              title="Refresh Agent OS state, memory and connections"
              type="button"
            >
              <Codicon className={cn(isFetching && 'animate-spin')} name="refresh" size="0.8rem" />
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <nav className="flex min-w-0 gap-0.5 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-0.5">
            {tabs.map(item => (
              <button
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[0.68rem] font-medium text-(--ui-text-tertiary) transition-colors',
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
                {error instanceof Error ? error.message : String(error)}
              </p>
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
            {tab === 'memory' && <MemoryView snapshot={snapshot} />}
            {tab === 'connections' && <ConnectionsView snapshot={snapshot} />}
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
      className="aos-state inline-flex h-full items-center gap-1.5 rounded-none px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground"
      data-state={state}
      onClick={() => host.navigate('/agent-os')}
      title={`Agent OS · ${data.summary.active_tasks} active tasks · ${data.summary.active_agents} active agents`}
      type="button"
    >
      <span className="aos-state-dot" />
      <span>Agent OS</span>
      {data.summary.active_tasks > 0 && <span className="tabular-nums">{data.summary.active_tasks}</span>}
    </button>
  )
}
