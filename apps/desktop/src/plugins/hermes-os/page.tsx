import { Button, cn, Codicon, host } from '@hermes/plugin-sdk'
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
    description: 'Persistent profiles and ephemeral workers with normalized runtime state.',
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
      <div className="mt-1 text-lg font-medium tabular-nums text-(--ui-text-primary)">{value}</div>
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

function MissionControl() {
  return (
    <div className="space-y-6">
      <section>
        <div className="grid grid-cols-2 gap-x-6 border-b border-(--ui-stroke-tertiary) sm:grid-cols-4">
          <Metric label="Agents active" value="—" />
          <Metric label="Tasks running" value="—" />
          <Metric label="Needs attention" value="—" />
          <Metric label="Runs today" value="—" />
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          The shell is live. These counters intentionally stay unbound until the next slice connects existing Hermes
          fleet, session, Kanban, and gateway authorities instead of inventing a second state system.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Control-plane foundation</h2>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          <FoundationRow
            detail="Bundled plugin discovered by the existing desktop plugin loader."
            icon="extensions"
            label="Hermes OS plugin"
            state="ACTIVE"
          />
          <FoundationRow
            detail="Six durable workspace destinations; no core route edits."
            icon="link"
            label="Navigation"
            state="READY"
          />
          <FoundationRow
            detail="Next: project existing Hermes truth into normalized operational selectors."
            icon="pulse"
            label="Data layer"
            state="NEXT"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Next bindings</h2>
        <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
          <FoundationRow detail="$fleetRoster + profiles + subagents" icon="hubot" label="Agent fleet" state="SOURCE" />
          <FoundationRow detail="Hermes Kanban plugin API" icon="project" label="Tasks" state="SOURCE" />
          <FoundationRow detail="Sessions + working session state" icon="comment-discussion" label="Runs" state="SOURCE" />
          <FoundationRow detail="Goals + projects + workspace ownership" icon="target" label="Projects" state="SOURCE" />
        </div>
      </section>
    </div>
  )
}

function FoundationPage({
  children,
  section
}: {
  children?: ReactNode
  section: Exclude<HermesOsSection, 'mission'>
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
            This destination is deliberately present before its data adapter. The next implementation slice will read
            existing Hermes authorities and normalize them for this surface without creating duplicate persistence.
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
                  variant="ghost"
                  className={cn(selected && 'bg-(--chrome-action-hover) text-(--ui-text-primary)')}
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
