import { Button, Codicon, host, type OperationsTask, type OperationsTaskSnapshot, type OperationsTaskSource } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

import { sourceForSnapshot, useHermesOperations, useLiveFleet } from './operations-data'
import {
  activeRunIds,
  attentionOperationalTasks,
  runningOperationalTasks,
  taskCountForProject,
  uniqueOperationalProjects
} from './selectors'

export type HermesOsSection = 'mission' | 'attention' | 'projects' | 'fleet' | 'timeline' | 'security'

interface SectionDefinition {
  description: string
  icon: string
  label: string
  path: string
}

const SECTIONS: Record<HermesOsSection, SectionDefinition> = {
  mission: {
    description: 'Operational overview of active work, agents, attention, and system health.',
    icon: 'dashboard',
    label: 'Mission Control',
    path: '/hermes-os'
  },
  attention: {
    description: 'Producer-authored blockers, review states, and diagnostics that warrant inspection.',
    icon: 'bell',
    label: 'What Needs Me',
    path: '/hermes-os/attention'
  },
  projects: {
    description: 'Project-linked operational work projected from existing Hermes authorities.',
    icon: 'project',
    label: 'Projects',
    path: '/hermes-os/projects'
  },
  fleet: {
    description: 'Persistent profiles and execution routes, with ephemeral workers added in the next runtime slice.',
    icon: 'hubot',
    label: 'Fleet',
    path: '/hermes-os/fleet'
  },
  timeline: {
    description: 'Live runtime sessions and task execution, joined without duplicating source state.',
    icon: 'graph',
    label: 'Timeline',
    path: '/hermes-os/timeline'
  },
  security: {
    description: 'Current execution boundary; policy editing follows after the task/run model is complete.',
    icon: 'shield',
    label: 'Security',
    path: '/hermes-os/security'
  }
}

const ORDER = Object.keys(SECTIONS) as HermesOsSection[]

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 py-3">
      <div className="text-[0.6875rem] uppercase tracking-wide text-(--ui-text-tertiary)">{label}</div>
      <div className="mt-1 truncate text-lg font-medium tabular-nums text-(--ui-text-primary)">{value}</div>
    </div>
  )
}

function FoundationRow({
  action,
  detail,
  icon,
  label,
  state
}: {
  action?: () => void
  detail: string
  icon: string
  label: string
  state: string
}) {
  const body = (
    <>
      <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={icon} size="0.9rem" />
      <div className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-medium text-(--ui-text-primary)">{label}</div>
        <div className="truncate text-xs text-(--ui-text-tertiary)">{detail}</div>
      </div>
      <div className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-secondary)">{state}</div>
    </>
  )

  return action ? (
    <button
      className="flex w-full min-w-0 items-center gap-3 py-2.5 hover:bg-(--chrome-action-hover)"
      onClick={action}
      type="button"
    >
      {body}
    </button>
  ) : (
    <div className="flex min-w-0 items-center gap-3 py-2.5">{body}</div>
  )
}

function taskDetail(task: OperationsTask): string {
  const parts = [
    task.projectName,
    task.assignee ? `agent ${task.assignee}` : null,
    task.workerSessionId ? `worker ${task.workerSessionId}` : task.originSessionId ? `origin ${task.originSessionId}` : null,
    task.runId != null ? `run ${task.runId}` : null,
    task.warning?.count ? `${task.warning.count} diagnostic${task.warning.count === 1 ? '' : 's'}` : null
  ].filter(Boolean)

  return parts.join(' · ') || 'Operational task'
}

function OperationalTaskRows({
  snapshots,
  sources,
  tasks
}: {
  snapshots: readonly OperationsTaskSnapshot[]
  sources: readonly OperationsTaskSource[]
  tasks: readonly OperationsTask[]
}) {
  const owner = (task: OperationsTask) =>
    snapshots.find(snapshot => snapshot.tasks.some(candidate => candidate === task)) ?? null

  return (
    <div className="divide-y divide-(--ui-stroke-tertiary)">
      {tasks.map(task => {
        const snapshot = owner(task)
        const source = snapshot ? sourceForSnapshot(sources, snapshot) : undefined

        return (
          <FoundationRow
            action={source?.openTask ? () => source.openTask?.(task.id) : undefined}
            detail={taskDetail(task)}
            icon={task.status === 'blocked' ? 'error' : task.status === 'review' ? 'eye' : 'pulse'}
            key={`${snapshot?.sourceId ?? 'source'}:${task.id}`}
            label={task.title}
            state={(task.warning?.severity || task.status).toUpperCase()}
          />
        )
      })}
    </div>
  )
}

function NoTaskSource() {
  return (
    <div className="border-t border-(--ui-stroke-tertiary) pt-4">
      <div className="text-xs font-medium text-(--ui-text-secondary)">No operational task source active</div>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-(--ui-text-tertiary)">
        Enable the Kanban plugin to project its existing tasks and projects into Hermes OS. Hermes OS does not create a
        second task database.
      </p>
    </div>
  )
}

function MissionControl() {
  const snapshot = useHermesOperations()
  const runningTasks = runningOperationalTasks(snapshot.snapshots)
  const attention = attentionOperationalTasks(snapshot.snapshots)
  const projects = uniqueOperationalProjects(snapshot.snapshots)

  return (
    <div className="space-y-6">
      <section>
        <div className="grid grid-cols-2 gap-x-6 border-b border-(--ui-stroke-tertiary) sm:grid-cols-4">
          <Metric label="Tasks running" value={snapshot.sources.length ? String(runningTasks.length) : '—'} />
          <Metric label="Active runs" value={String(snapshot.activeRuns)} />
          <Metric label="Needs attention" value={snapshot.sources.length ? String(attention.length) : '—'} />
          <Metric label="Projects" value={snapshot.sources.length ? String(projects.length) : '—'} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Current execution context</h2>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          <FoundationRow detail="Live Hermes gateway transport state." icon="radio-tower" label="Gateway" state={snapshot.gateway || 'UNKNOWN'} />
          <FoundationRow detail="The model selected by the live Hermes session surface." icon="symbol-method" label="Model" state={snapshot.model || 'UNRESOLVED'} />
          <FoundationRow detail={snapshot.cwd || 'No workspace directory is currently attached.'} icon="folder" label="Workspace" state={snapshot.cwd ? 'ATTACHED' : 'DETACHED'} />
          <FoundationRow
            detail={`${snapshot.routes.data?.length ?? 0} connection-qualified profile route(s)`}
            icon="server-environment"
            label="Fleet registry"
            state={snapshot.routes.isError ? 'DEGRADED' : snapshot.routes.isFetching ? 'SYNCING' : 'LIVE'}
          />
          <FoundationRow
            detail={snapshot.sources.map(source => source.label).join(', ') || 'No task source registered'}
            icon="project"
            label="Operational sources"
            state={snapshot.query.isError ? 'DEGRADED' : snapshot.query.isFetching ? 'SYNCING' : snapshot.sources.length ? 'LIVE' : 'NONE'}
          />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold text-(--ui-text-primary)">Running work</h2>
          <Button onClick={() => host.navigate('/hermes-os/timeline')} size="inline" type="button" variant="text">
            Open timeline
          </Button>
        </div>
        {!snapshot.sources.length ? (
          <NoTaskSource />
        ) : runningTasks.length ? (
          <OperationalTaskRows snapshots={snapshot.snapshots} sources={snapshot.sources} tasks={runningTasks} />
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No operational task is currently in the running state.</p>
        )}
      </section>
    </div>
  )
}

function AttentionPage() {
  const snapshot = useHermesOperations()
  const tasks = attentionOperationalTasks(snapshot.snapshots)

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="bell" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Attention queue</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          No intent is inferred here: entries appear only from explicit blocked/review states or diagnostics published by
          the authoritative task source.
        </p>
      </div>

      {!snapshot.sources.length ? (
        <NoTaskSource />
      ) : snapshot.query.isError ? (
        <p className="text-xs text-(--ui-text-tertiary)">The task source could not be read.</p>
      ) : tasks.length ? (
        <OperationalTaskRows snapshots={snapshot.snapshots} sources={snapshot.sources} tasks={tasks} />
      ) : (
        <p className="text-xs text-(--ui-text-tertiary)">No blocked, review, or diagnosed task currently needs inspection.</p>
      )}
    </div>
  )
}

function ProjectsPage() {
  const snapshot = useHermesOperations()
  const projects = uniqueOperationalProjects(snapshot.snapshots)

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="project" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Operational projects</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Projects are projected from the source that already owns them; Hermes OS adds no project persistence.
        </p>
      </div>

      {!snapshot.sources.length ? (
        <NoTaskSource />
      ) : projects.length ? (
        <div className="divide-y divide-(--ui-stroke-tertiary)">
          {projects.map(project => (
            <FoundationRow
              detail={project.path || project.slug || project.id}
              icon="repo"
              key={project.id}
              label={project.name}
              state={`${taskCountForProject(snapshot.snapshots, project.id)} ACTIVE`}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-(--ui-text-tertiary)">The active task source has no project records.</p>
      )}
    </div>
  )
}

function FleetPage() {
  const snapshot = useHermesOperations()
  const routes = snapshot.routes.data ?? []

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="hubot" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Registered execution routes</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          One row is one connection-qualified Hermes profile route. This is identity topology, not a guessed online state.
        </p>
      </div>

      {snapshot.routes.isLoading ? (
        <p className="text-xs text-(--ui-text-tertiary)">Loading fleet registry…</p>
      ) : snapshot.routes.isError ? (
        <p className="text-xs text-(--ui-text-tertiary)">The current desktop connection registry could not be read.</p>
      ) : routes.length === 0 ? (
        <p className="text-xs text-(--ui-text-tertiary)">No registered profile routes are available.</p>
      ) : (
        <div className="divide-y divide-(--ui-stroke-tertiary)">
          {routes.map(route => (
            <div className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]" key={`${route.connectionId}:${route.profile}`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-(--ui-text-primary)">{route.profile}</div>
                <div className="truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{route.connectionId}</div>
              </div>
              <div className="font-mono text-xs text-(--ui-text-secondary)">{route.mode.toUpperCase()}</div>
              <div className="truncate text-xs text-(--ui-text-tertiary)">target {route.targetProfile || route.profile}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelinePage() {
  const snapshot = useHermesOperations()
  const runtimeRuns = activeRunIds(snapshot.busyBySession)
  const tasks = runningOperationalTasks(snapshot.snapshots)

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Running tasks</h2>
        {!snapshot.sources.length ? (
          <NoTaskSource />
        ) : tasks.length ? (
          <OperationalTaskRows snapshots={snapshot.snapshots} sources={snapshot.sources} tasks={tasks} />
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No task source reports running work.</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Runtime sessions</h2>
        {runtimeRuns.length === 0 ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No Hermes session is currently mid-turn.</p>
        ) : (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            {runtimeRuns.map(sessionId => (
              <FoundationRow detail="Hermes runtime session currently executing a turn." icon="pulse" key={sessionId} label={sessionId} state="RUNNING" />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function SecurityPage() {
  const snapshot = useHermesOperations()

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="shield" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Current boundary</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          This read-only view reports the execution context already known to Hermes. Capability manifests and
          project-scoped policy editing are intentionally not invented ahead of their backend authority.
        </p>
      </div>

      <div className="divide-y divide-(--ui-stroke-tertiary)">
        <FoundationRow detail="Live gateway transport state." icon="radio-tower" label="Gateway" state={snapshot.gateway || 'UNKNOWN'} />
        <FoundationRow detail="Current Hermes profile scope." icon="account" label="Profile" state={snapshot.profile || 'default'} />
        <FoundationRow detail={snapshot.cwd || 'No workspace attached.'} icon="folder" label="Workspace scope" state={snapshot.cwd ? 'BOUND' : 'NONE'} />
        <FoundationRow detail={`${snapshot.sources.length} registered read-only source(s)`} icon="lock" label="Operations data" state="READ ONLY" />
      </div>
    </div>
  )
}

function PageBody({ section }: { section: HermesOsSection }) {
  const pages: Record<HermesOsSection, ReactNode> = {
    mission: <MissionControl />,
    attention: <AttentionPage />,
    projects: <ProjectsPage />,
    fleet: <FleetPage />,
    timeline: <TimelinePage />,
    security: <SecurityPage />
  }

  return pages[section]
}

export function HermesOsPage({ section }: { section: HermesOsSection }) {
  const active = SECTIONS[section]

  return (
    <div className="flex h-full min-h-0 flex-col bg-(--ui-chat-surface-background)">
      <header className="shrink-0 border-b border-(--ui-stroke-tertiary)">
        <div className="px-4 pb-3 pt-4">
          <div className="flex min-w-0 items-start gap-3">
            <Codicon className="mt-0.5 shrink-0 text-(--ui-text-secondary)" name={active.icon} size="1.15rem" />
            <div className="min-w-0">
              <h1 className="text-lg font-semibold tracking-tight text-(--ui-text-primary)">{active.label}</h1>
              <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">{active.description}</p>
            </div>
          </div>

          <nav aria-label="Hermes OS" className="mt-4 flex flex-wrap gap-1">
            {ORDER.map(key => {
              const item = SECTIONS[key]
              const selected = key === section

              return (
                <Button
                  aria-current={selected ? 'page' : undefined}
                  key={key}
                  onClick={() => host.navigate(item.path)}
                  size="sm"
                  type="button"
                  variant={selected ? 'secondary' : 'ghost'}
                >
                  <Codicon name={item.icon} size="0.8rem" />
                  {item.label}
                </Button>
              )
            })}
          </nav>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-6xl px-4 py-5">
          <PageBody section={section} />
        </div>
      </main>
    </div>
  )
}
