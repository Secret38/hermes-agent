import './agent-os.css'

import { cn, Codicon, useQuery } from '@hermes/plugin-sdk'
import { useEffect, useMemo, useState } from 'react'

import { AGENT_OS_SNAPSHOT_KEY, fetchAgentOSSnapshot } from './api'
import type { AgentOSEvent, AgentOSTask } from './types'

type EventFilter = 'all' | 'artifact' | 'checkpoint' | 'recovery' | 'safety' | 'verification'

const FILTERS: Array<{ id: EventFilter; label: string }> = [
  { id: 'all', label: 'All events' },
  { id: 'verification', label: 'Verification' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'safety', label: 'Risk & approvals' },
  { id: 'checkpoint', label: 'Checkpoints' },
  { id: 'artifact', label: 'Artifacts' }
]

function eventMatches(event: AgentOSEvent, filter: EventFilter): boolean {
  if (filter === 'all') {return true}

  if (filter === 'verification') {return event.type.startsWith('verification.')}

  if (filter === 'recovery') {return event.type.startsWith('recovery.')}

  if (filter === 'checkpoint') {return event.type.startsWith('checkpoint.')}

  if (filter === 'artifact') {return event.type.startsWith('artifact.')}

  return event.type.startsWith('risk.') || event.type.startsWith('approval.')
}

function humanize(value: string): string {
  return value
    .replaceAll('.', ' · ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function compactId(value: null | string | undefined): string {
  if (!value) {return '—'}

  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-7)}`
}

function formatTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {return value}

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function eventIcon(type: string): string {
  if (type.startsWith('verification.')) {return 'verified'}

  if (type.startsWith('recovery.')) {return 'debug-restart'}

  if (type.startsWith('approval.')) {return 'shield'}

  if (type.startsWith('risk.')) {return 'warning'}

  if (type.startsWith('checkpoint.')) {return 'save'}

  if (type.startsWith('artifact.')) {return 'package'}

  if (type.startsWith('agent.')) {return 'hubot'}

  if (type.startsWith('plan_step.')) {return 'list-tree'}

  if (type.startsWith('plan.')) {return 'type-hierarchy'}

  if (type.startsWith('action.')) {return 'tools'}

  if (type.startsWith('task.')) {return 'target'}

  return 'circle-large-outline'
}

interface ReplayState {
  task: string
  plan: string
  actions: Record<string, string>
  agents: Record<string, string>
  steps: Record<string, string>
  approvals: number
  recoveries: number
  verifications: number
  artifacts: number
}

function replayState(events: AgentOSEvent[]): ReplayState {
  const state: ReplayState = {
    task: 'CREATED',
    plan: '—',
    actions: {},
    agents: {},
    steps: {},
    approvals: 0,
    recoveries: 0,
    verifications: 0,
    artifacts: 0
  }

  for (const event of events) {
    const payload = event.payload ?? {}
    const to = typeof payload.to === 'string' ? payload.to : undefined

    if (event.type === 'task.state_changed' && to) {state.task = to}

    if (event.type === 'plan.created') {state.plan = 'DRAFT'}

    if (event.type === 'plan.state_changed' && to) {state.plan = to}

    if (event.type === 'action.created' && event.action_id) {
      state.actions[event.action_id] = typeof payload.state === 'string' ? payload.state : 'PLANNED'
    }

    if (event.type === 'action.state_changed' && event.action_id && to) {
      state.actions[event.action_id] = to
    }

    if (event.type === 'agent.created') {
      const id = typeof payload.agent_id === 'string' ? payload.agent_id : undefined

      if (id) {state.agents[id] = typeof payload.state === 'string' ? payload.state : 'CREATED'}
    }

    if (event.type === 'agent.state_changed') {
      const id = typeof payload.agent_id === 'string' ? payload.agent_id : undefined

      if (id && to) {state.agents[id] = to}
    }

    if (event.type === 'plan_step.created') {
      const id = typeof payload.step_id === 'string' ? payload.step_id : undefined

      if (id) {state.steps[id] = typeof payload.state === 'string' ? payload.state : 'PENDING'}
    }

    if (event.type === 'plan_step.state_changed') {
      const id = typeof payload.step_id === 'string' ? payload.step_id : undefined

      if (id && to) {state.steps[id] = to}
    }

    if (event.type === 'approval.requested') {state.approvals += 1}

    if (event.type === 'recovery.attempted') {state.recoveries += 1}

    if (event.type === 'verification.recorded') {state.verifications += 1}

    if (event.type === 'artifact.recorded') {state.artifacts += 1}
  }

  return state
}

function MiniMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2.5 py-2">
      <div className="aos-kicker">{label}</div>
      <div className="mt-1 truncate text-xs font-semibold tabular-nums text-foreground">{value}</div>
    </div>
  )
}

function EventRow({
  active,
  event,
  onSelect
}: {
  active: boolean
  event: AgentOSEvent
  onSelect: () => void
}) {
  return (
    <button
      className={cn(
        'grid w-full grid-cols-[4.5rem_1.5rem_minmax(0,1fr)] items-start gap-2 border-b border-(--ui-stroke-tertiary) px-2.5 py-2 text-left transition-colors',
        active ? 'bg-(--ui-control-active-background)' : 'hover:bg-(--ui-control-hover-background)'
      )}
      onClick={onSelect}
      type="button"
    >
      <span className="pt-0.5 text-[0.6rem] tabular-nums text-(--ui-text-tertiary)">{formatTime(event.created_at)}</span>
      <span className="grid size-5 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-secondary)">
        <Codicon name={eventIcon(event.type)} size="0.72rem" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[0.68rem] font-medium text-foreground">{humanize(event.type)}</span>
        <span className="mt-0.5 block truncate font-mono text-[0.56rem] text-(--ui-text-tertiary)">
          #{event.sequence} · {compactId(event.action_id)}
        </span>
      </span>
    </button>
  )
}

function EventInspector({ event }: { event: AgentOSEvent | undefined }) {
  if (!event) {
    return (
      <div className="grid h-full min-h-48 place-items-center p-6 text-center text-xs text-(--ui-text-tertiary)">
        Select an event to inspect its redacted ledger evidence.
      </div>
    )
  }

  const payload = event.payload ?? {}

  return (
    <div className="aos-scrollbar h-full overflow-auto p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="aos-kicker">Ledger evidence</div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">{humanize(event.type)}</div>
          <div className="mt-1 font-mono text-[0.58rem] text-(--ui-text-tertiary)">
            sequence #{event.sequence} · {event.id}
          </div>
        </div>
        <Codicon className="text-(--ui-text-tertiary)" name={eventIcon(event.type)} size="1rem" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MiniMetric label="Task" value={compactId(event.task_id)} />
        <MiniMetric label="Action" value={compactId(event.action_id)} />
        <MiniMetric label="Recorded" value={formatTime(event.created_at)} />
        <MiniMetric label="Payload keys" value={Object.keys(payload).length} />
      </div>

      <div className="mt-3 rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) p-2.5">
        <div className="aos-kicker">Redacted payload</div>
        <pre className="aos-scrollbar mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words font-mono text-[0.62rem] leading-relaxed text-(--ui-text-secondary)">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    </div>
  )
}

function ReplayStatePanel({ state }: { state: ReplayState }) {
  const activeActions = Object.values(state.actions).filter(
    value => !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value)
  ).length

  const activeAgents = Object.values(state.agents).filter(
    value => !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value)
  ).length

  const completedSteps = Object.values(state.steps).filter(value => value === 'SUCCEEDED').length

  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <MiniMetric label="Task state" value={state.task} />
      <MiniMetric label="Plan state" value={state.plan} />
      <MiniMetric label="Active actions" value={activeActions} />
      <MiniMetric label="Active agents" value={activeAgents} />
      <MiniMetric label="Steps verified" value={completedSteps} />
      <MiniMetric label="Verifications" value={state.verifications} />
      <MiniMetric label="Recoveries" value={state.recoveries} />
      <MiniMetric label="Artifacts" value={state.artifacts} />
    </div>
  )
}

function ForensicsTaskPicker({
  selected,
  tasks,
  onSelect
}: {
  selected: string
  tasks: AgentOSTask[]
  onSelect: (id: string) => void
}) {
  return (
    <select
      className="h-7 min-w-0 max-w-md rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2 text-xs text-foreground outline-none"
      onChange={event => onSelect(event.target.value)}
      value={selected}
    >
      {tasks.map(task => (
        <option key={task.id} value={task.id}>
          {task.goal}
        </option>
      ))}
    </select>
  )
}

export function AgentOSForensicsPage() {
  const { data: snapshot, isLoading, refetch } = useQuery({
    queryFn: fetchAgentOSSnapshot,
    queryKey: AGENT_OS_SNAPSHOT_KEY,
    refetchInterval: 5_000
  })

  const tasks = useMemo(() => snapshot?.tasks ?? [], [snapshot?.tasks])
  const [taskId, setTaskId] = useState('')
  const [filter, setFilter] = useState<EventFilter>('all')
  const [cursor, setCursor] = useState(0)
  const [selectedSequence, setSelectedSequence] = useState<number>()

  useEffect(() => {
    if (!tasks.length) {
      setTaskId('')

      return
    }

    if (!taskId || !tasks.some(task => task.id === taskId)) {
      setTaskId(tasks[0].id)
    }
  }, [taskId, tasks])

  const task = tasks.find(item => item.id === taskId)
  const allEvents = useMemo(() => task?.events ?? [], [task])
  const eventCount = allEvents.length
  const lastSequence = allEvents.at(-1)?.sequence
  const filteredEvents = useMemo(() => allEvents.filter(event => eventMatches(event, filter)), [allEvents, filter])
  const safeCursor = Math.min(Math.max(cursor, 0), Math.max(eventCount - 1, 0))
  const replayEvents = useMemo(
    () => (allEvents.length ? allEvents.slice(0, safeCursor + 1) : []),
    [allEvents, safeCursor]
  )
  const state = useMemo(() => replayState(replayEvents), [replayEvents])

  const selectedEvent =
    allEvents.find(event => event.sequence === selectedSequence) ??
    (allEvents.length ? allEvents[safeCursor] : undefined)

  useEffect(() => {
    setCursor(Math.max(eventCount - 1, 0))
    setSelectedSequence(lastSequence)
  }, [taskId, eventCount, lastSequence])

  return (
    <section className="flex h-full min-h-0 flex-col bg-(--ui-bg-primary) text-foreground">
      <header className="shrink-0 border-b border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-4 pb-3 pt-[calc(var(--titlebar-height)+0.8rem)]">
        <div className="flex min-w-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="aos-kicker">Agent OS · Forensics</div>
            <h1 className="mt-1 truncate text-base font-semibold tracking-tight">Execution Replay</h1>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
              Replay the append-only execution ledger, inspect verification evidence, recovery branches, approvals,
              checkpoints and recorded artifacts without mutating mission state.
            </p>
          </div>
          <button
            aria-label="Refresh ledger"
            className="grid size-7 shrink-0 place-items-center rounded-md border border-(--ui-stroke-tertiary) text-(--ui-text-secondary) hover:bg-(--ui-control-hover-background)"
            onClick={() => void refetch()}
            type="button"
          >
            <Codicon name="refresh" size="0.78rem" />
          </button>
        </div>

        {tasks.length > 0 && (
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
            <ForensicsTaskPicker onSelect={setTaskId} selected={taskId} tasks={tasks} />
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(item => (
                <button
                  className={cn(
                    'h-7 rounded-md border px-2 text-[0.62rem] transition-colors',
                    filter === item.id
                      ? 'border-(--ui-stroke-secondary) bg-(--ui-control-active-background) text-foreground'
                      : 'border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground'
                  )}
                  key={item.id}
                  onClick={() => setFilter(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div className="aos-scrollbar min-h-0 flex-1 overflow-auto p-3">
        {isLoading && !snapshot ? (
          <div className="grid min-h-72 place-items-center text-xs text-(--ui-text-tertiary)">
            <span className="flex items-center gap-2">
              <Codicon className="animate-spin" name="loading" size="0.82rem" />
              Reading Agent OS ledger…
            </span>
          </div>
        ) : !task ? (
          <div className="grid min-h-72 place-items-center p-8 text-center">
            <div>
              <Codicon className="mx-auto text-(--ui-text-tertiary)" name="history" size="1.5rem" />
              <div className="mt-3 text-sm font-medium">No mission history yet</div>
              <div className="mt-1 text-xs text-(--ui-text-tertiary)">
                Start a mission in Mission Control. Its durable ledger will become replayable here.
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1600px] gap-3">
            <div className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3">
              <div className="flex min-w-0 items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="aos-kicker">Replay position</div>
                  <div className="mt-1 truncate text-xs font-medium" title={task.goal}>
                    {task.goal}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[0.58rem] text-(--ui-text-tertiary)">
                  {eventCount ? `${safeCursor + 1} / ${eventCount}` : '0 events'}
                </span>
              </div>
              <input
                aria-label="Replay position"
                className="mt-3 w-full accent-current"
                disabled={!eventCount}
                max={Math.max(eventCount - 1, 0)}
                min={0}
                onChange={event => {
                  const next = Number(event.target.value)
                  setCursor(next)
                  setSelectedSequence(allEvents[next]?.sequence)
                }}
                step={1}
                type="range"
                value={safeCursor}
              />
              <div className="mt-3">
                <ReplayStatePanel state={state} />
              </div>
            </div>

            <div className="grid min-h-[30rem] gap-3 xl:grid-cols-[minmax(20rem,0.78fr)_minmax(24rem,1.22fr)]">
              <div className="min-h-0 overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)">
                <div className="flex items-center justify-between border-b border-(--ui-stroke-tertiary) px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <Codicon name="history" size="0.78rem" />
                    <span className="text-xs font-semibold">Ledger timeline</span>
                  </div>
                  <span className="text-[0.6rem] tabular-nums text-(--ui-text-tertiary)">
                    {filteredEvents.length} shown
                  </span>
                </div>
                <div className="aos-scrollbar max-h-[36rem] overflow-auto">
                  {filteredEvents.map(event => (
                    <EventRow
                      active={selectedEvent?.sequence === event.sequence}
                      event={event}
                      key={event.sequence}
                      onSelect={() => {
                        const index = allEvents.findIndex(item => item.sequence === event.sequence)

                        if (index >= 0) {setCursor(index)}
                        setSelectedSequence(event.sequence)
                      }}
                    />
                  ))}
                  {!filteredEvents.length && (
                    <div className="grid min-h-40 place-items-center p-5 text-center text-xs text-(--ui-text-tertiary)">
                      No events match this forensic filter.
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-0 overflow-hidden rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary)">
                <EventInspector event={selectedEvent} />
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
