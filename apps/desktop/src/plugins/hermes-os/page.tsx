import { Button, Codicon, host, useQuery, useValue } from '@hermes/plugin-sdk'
import type { ReactNode } from 'react'

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
    description: 'Human decisions only: approvals, blockers, questions, failures, and security requests.',
    icon: 'bell',
    label: 'What Needs Me',
    path: '/hermes-os/attention'
  },
  projects: {
    description: 'Goal-linked workspaces that connect tasks, sessions, files, artifacts, and execution environments.',
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
    description: 'Run-level observability across queueing, execution, approvals, retries, and completion.',
    icon: 'graph',
    label: 'Timeline',
    path: '/hermes-os/timeline'
  },
  security: {
    description: 'Project-scoped autonomy, capability policies, approvals, and execution boundaries.',
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
  detail,
  icon,
  label,
  state
}: {
  detail: string
  icon: string
  label: string
  state: string
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={icon} size="0.9rem" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-(--ui-text-primary)">{label}</div>
        <div className="truncate text-xs text-(--ui-text-tertiary)">{detail}</div>
      </div>
      <div className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-secondary)">{state}</div>
    </div>
  )
}

function useOperationsSnapshot() {
  const busyBySession = useValue(host.state.busyBySession)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const model = useValue(host.state.model)
  const cwd = useValue(host.state.cwd)

  const routes = useQuery({
    queryKey: ['hermes-os', 'profile-routes'],
    queryFn: () => host.profileRoutes(),
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })

  return {
    activeRuns: Object.values(busyBySession).filter(Boolean).length,
    busyBySession,
    cwd,
    gateway,
    model,
    profile,
    routes
  }
}

function MissionControl() {
  const snapshot = useOperationsSnapshot()
  const routeCount = snapshot.routes.data?.length

  return (
    <div className="space-y-6">
      <section>
        <div className="grid grid-cols-2 gap-x-6 border-b border-(--ui-stroke-tertiary) sm:grid-cols-4">
          <Metric label="Active runs" value={String(snapshot.activeRuns)} />
          <Metric label="Agent routes" value={routeCount === undefined ? '—' : String(routeCount)} />
          <Metric label="Gateway" value={snapshot.gateway || 'unknown'} />
          <Metric label="Profile" value={snapshot.profile || 'default'} />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Current execution context</h2>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          <FoundationRow
            detail="The model selected by the live Hermes session surface."
            icon="symbol-method"
            label="Model"
            state={snapshot.model || 'UNRESOLVED'}
          />
          <FoundationRow
            detail={snapshot.cwd || 'No workspace directory is currently attached.'}
            icon="folder"
            label="Workspace"
            state={snapshot.cwd ? 'ATTACHED' : 'DETACHED'}
          />
          <FoundationRow
            detail="Profile routes are read from the existing desktop connection registry; credentials never cross this boundary."
            icon="server-environment"
            label="Fleet registry"
            state={snapshot.routes.isError ? 'DEGRADED' : snapshot.routes.isFetching ? 'SYNCING' : 'LIVE'}
          />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold text-(--ui-text-primary)">Active run IDs</h2>
          <button
            className="text-xs text-(--ui-text-tertiary) hover:text-(--ui-text-primary)"
            onClick={() => host.navigate('/hermes-os/timeline')}
            type="button"
          >
            Open timeline
          </button>
        </div>
        {snapshot.activeRuns === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-(--ui-text-tertiary)">
            No focused or background Hermes session is currently mid-turn.
          </p>
        ) : (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            {Object.entries(snapshot.busyBySession)
              .filter(([, busy]) => busy)
              .map(([sessionId]) => (
                <FoundationRow
                  detail="Runtime session currently executing a turn."
                  icon="loading"
                  key={sessionId}
                  label={sessionId}
                  state="RUNNING"
                />
              ))}
          </div>
        )}
      </section>
    </div>
  )
}

function FleetPage() {
  const snapshot = useOperationsSnapshot()
  const routes = snapshot.routes.data ?? []

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="hubot" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Registered execution routes</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          One row is one connection-qualified Hermes profile route. This is identity and reachability topology, not a
          guessed online/offline agent state.
        </p>
      </div>

      {snapshot.routes.isLoading ? (
        <p className="text-xs text-(--ui-text-tertiary)">Loading fleet registry…</p>
      ) : snapshot.routes.isError ? (
        <div className="border-t border-(--ui-stroke-tertiary) pt-4">
          <div className="text-xs font-medium text-destructive">Fleet registry unavailable</div>
          <p className="mt-1 text-xs text-(--ui-text-tertiary)">
            The current desktop connection registry could not be read. Existing Hermes work remains unaffected.
          </p>
        </div>
      ) : routes.length === 0 ? (
        <p className="text-xs text-(--ui-text-tertiary)">No registered profile routes are available.</p>
      ) : (
        <div className="divide-y divide-(--ui-stroke-tertiary)">
          {routes.map(route => (
            <div className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]" key={`${route.connectionId}:${route.profile}`}>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-(--ui-text-primary)">{route.profile}</div>
                <div className="truncate font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
                  {route.connectionId}
                </div>
              </div>
              <div className="font-mono text-xs text-(--ui-text-secondary)">{route.mode.toUpperCase()}</div>
              <div className="truncate text-xs text-(--ui-text-tertiary)">
                target {route.targetProfile || route.profile}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function TimelinePage() {
  const snapshot = useOperationsSnapshot()
  const running = Object.entries(snapshot.busyBySession).filter(([, busy]) => busy)

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="graph" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Live execution</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          V1 begins with Hermes' authoritative mid-turn state. Durable run spans, retries, approvals, and task links will
          layer onto this surface rather than replacing it.
        </p>
      </div>

      {running.length === 0 ? (
        <p className="text-xs text-(--ui-text-tertiary)">No runs are executing right now.</p>
      ) : (
        <div className="divide-y divide-(--ui-stroke-tertiary)">
          {running.map(([sessionId]) => (
            <FoundationRow
              detail="Live runtime session; task/run metadata will be joined in the Kanban binding slice."
              icon="pulse"
              key={sessionId}
              label={sessionId}
              state="RUNNING"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SecurityPage() {
  const snapshot = useOperationsSnapshot()

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="shield" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Current boundary</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          This first read-only view reports the execution context already known to Hermes. Capability manifests and
          project-scoped policy editing come after the task/run model is connected.
        </p>
      </div>

      <div className="divide-y divide-(--ui-stroke-tertiary)">
        <FoundationRow detail="Live gateway transport state." icon="radio-tower" label="Gateway" state={snapshot.gateway || 'UNKNOWN'} />
        <FoundationRow detail="Current Hermes profile scope." icon="account" label="Profile" state={snapshot.profile || 'default'} />
        <FoundationRow detail={snapshot.cwd || 'No workspace attached.'} icon="folder" label="Workspace scope" state={snapshot.cwd ? 'BOUND' : 'NONE'} />
      </div>
    </div>
  )
}

function FoundationPage({
  children,
  section
}: {
  children?: ReactNode
  section: 'attention' | 'projects'
}) {
  const definition = SECTIONS[section]

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name={definition.icon} size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">{definition.label}</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">{definition.description}</p>
      </div>

      {children ?? (
        <div className="border-t border-(--ui-stroke-tertiary) pt-4">
          <div className="text-xs font-medium text-(--ui-text-secondary)">V1 data binding pending</div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-(--ui-text-tertiary)">
            This surface will be connected to existing Hermes authorities only. No second task, project, approval, or
            session database will be introduced.
          </p>
        </div>
      )}
    </div>
  )
}

function PageBody({ section }: { section: HermesOsSection }) {
  if (section === 'mission') {
    return <MissionControl />
  }

  if (section === 'fleet') {
    return <FleetPage />
  }

  if (section === 'timeline') {
    return <TimelinePage />
  }

  if (section === 'security') {
    return <SecurityPage />
  }

  return <FoundationPage section={section} />
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
