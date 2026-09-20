import { Button, Codicon, host, type OperationsTask, type OperationsTaskSnapshot, type OperationsTaskSource, type PluginProfileRoute } from '@hermes/plugin-sdk'
import { useStore } from '@nanostores/react'
import { type ReactNode, useState } from 'react'

import { $approvalModes } from '@/store/approval-mode'
import { notifyError } from '@/store/notifications'

import {
  ExecutionInspector,
  type ExecutionInspectorSelection
} from './execution-inspector'
import { useHermesAudit } from './audit-data'
import { useHermesEstop } from './control-data'
import { openHumanGateSession, resolveHumanGateApproval, useHumanGates, type HumanGate } from './human-gates'
import { sourceForSnapshot, useHermesOperations, useLiveFleet } from './operations-data'
import { ProjectInspector } from './project-inspector'
import { useHermesProjects } from './project-data'
import { useComputerUseSecurity, useNetworkSecurity, useTelemetrySecurity } from './security-data'
import { openHermesSession, storedHermesSessionId } from './session-navigation'
import {
  activeRunIds,
  attentionOperationalTasks,
  exactWorkerRoute,
  executionOperationalTasks,
  runningOperationalTasks
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
    description: 'Human approvals, questions, credentials, review states, blockers, and diagnostics that need you.',
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
    task.warning?.count
      ? [
          `${task.warning.count} diagnostic${task.warning.count === 1 ? '' : 's'}`,
          task.warning.kinds && Object.keys(task.warning.kinds).length
            ? Object.keys(task.warning.kinds).join(', ')
            : null
        ].filter(Boolean).join(': ')
      : null
  ].filter(Boolean)

  return parts.join(' · ') || 'Operational task'
}

function OperationalTaskRows({
  routes,
  snapshots,
  sources,
  tasks
}: {
  routes: readonly PluginProfileRoute[]
  snapshots: readonly OperationsTaskSnapshot[]
  sources: readonly OperationsTaskSource[]
  tasks: readonly OperationsTask[]
}) {
  const [inspectionKey, setInspectionKey] = useState<null | { sourceId: string; taskId: string }>(null)

  const owner = (task: OperationsTask) =>
    snapshots.find(snapshot => snapshot.tasks.some(candidate => candidate === task)) ?? null

  const inspectionSnapshot = inspectionKey
    ? snapshots.find(snapshot => snapshot.sourceId === inspectionKey.sourceId && snapshot.tasks.some(task => task.id === inspectionKey.taskId))
    : undefined
  const inspectionTask = inspectionSnapshot?.tasks.find(task => task.id === inspectionKey?.taskId)
  const inspectionSource = inspectionSnapshot ? sourceForSnapshot(sources, inspectionSnapshot) : undefined
  const inspection: ExecutionInspectorSelection | null =
    inspectionSnapshot && inspectionTask && inspectionSource
      ? { snapshot: inspectionSnapshot, source: inspectionSource, task: inspectionTask }
      : null

  return (
    <>
      <div className="divide-y divide-(--ui-stroke-tertiary)">
        {tasks.map(task => {
          const snapshot = owner(task)
          const source = snapshot ? sourceForSnapshot(sources, snapshot) : undefined
          const route = exactWorkerRoute(task, snapshot, routes)
          const canInspect = Boolean(snapshot && source?.readTaskExecution)
          const canOpenWorker = Boolean(task.workerSessionId && route)
          const inspectAction =
            canInspect && snapshot && source
              ? () => setInspectionKey({ sourceId: snapshot.sourceId, taskId: task.id })
              : undefined
          const taskAction = source?.openTask ? () => source.openTask?.(task.id) : inspectAction

          if (canInspect || canOpenWorker) {
            return (
              <div
                className="flex min-w-0 items-center gap-3 py-2.5"
                key={`${snapshot?.sourceId ?? 'source'}:${task.id}`}
              >
                <button
                  className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-foreground"
                  onClick={taskAction}
                  type="button"
                >
                  <Codicon
                    className="shrink-0 text-(--ui-text-tertiary)"
                    name={task.status === 'blocked' ? 'error' : task.status === 'review' ? 'eye' : 'pulse'}
                    size="0.9rem"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-(--ui-text-primary)">{task.title}</div>
                    <div className="truncate text-xs text-(--ui-text-tertiary)">{taskDetail(task)}</div>
                  </div>
                  <div className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-secondary)">
                    {(task.warning?.severity || task.status).toUpperCase()}
                  </div>
                </button>
                {canInspect ? (
                  <Button
                    onClick={inspectAction}
                    size="sm"
                    type="button"
                    variant="secondary"
                  >
                    Inspect
                  </Button>
                ) : null}
                {canOpenWorker ? (
                  <Button
                    onClick={() => openHermesSession(task.workerSessionId!, route!)}
                    size="sm"
                    type="button"
                    variant="text"
                  >
                    Worker
                  </Button>
                ) : null}
              </div>
            )
          }

          return (
            <FoundationRow
              action={taskAction}
              detail={taskDetail(task)}
              icon={task.status === 'blocked' ? 'error' : task.status === 'review' ? 'eye' : 'pulse'}
              key={`${snapshot?.sourceId ?? 'source'}:${task.id}`}
              label={task.title}
              state={(task.warning?.severity || task.status).toUpperCase()}
            />
          )
        })}
      </div>
      <ExecutionInspector
        onOpenChange={open => {
          if (!open) {
            setInspectionKey(null)
          }
        }}
        open={inspection !== null}
        routes={routes}
        selection={inspection}
      />
    </>
  )
}

function approvalScopeLabel(gate: HumanGate): string {
  const request = gate.approvalRequest
  const provenance = gate.approvalProvenance

  if (!request || !provenance) {
    return 'Scope unknown'
  }

  const scopes = request.choices?.length
    ? request.choices
    : [
        'once',
        ...(provenance.allowSession ? ['session'] : []),
        ...(provenance.allowPermanent ? ['always'] : []),
        'deny'
      ]

  return scopes.join(' / ')
}

function approvalPolicyDetail(gate: HumanGate): string {
  const provenance = gate.approvalProvenance

  if (!provenance) {
    return 'Policy provenance unavailable'
  }

  const parts = [
    `mode ${provenance.mode}`,
    provenance.toolName ? `tool ${provenance.toolName}` : null,
    provenance.patternKeys.length ? `rule ${provenance.patternKeys.join(', ')}` : null,
    provenance.smartDenied ? 'smart guardian deny override' : null,
    `scope ${approvalScopeLabel(gate)}`
  ].filter(Boolean)

  return parts.join(' · ')
}

function gateTaskCorrelation(
  gate: HumanGate,
  snapshots: readonly OperationsTaskSnapshot[]
): { snapshot: OperationsTaskSnapshot; task: OperationsTask } | null {
  const gateStoredId = storedHermesSessionId(gate.runtimeSessionId)

  for (const snapshot of snapshots) {
    for (const task of snapshot.tasks) {
      const sessionIds = [task.workerSessionId, task.originSessionId].filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )

      if (sessionIds.some(sessionId => storedHermesSessionId(sessionId) === gateStoredId)) {
        return { snapshot, task }
      }
    }
  }

  return null
}

function humanGateIcon(gate: HumanGate): string {
  switch (gate.kind) {
    case 'approval':
      return 'shield'
    case 'clarify':
      return 'question'
    case 'sudo':
      return 'key'
    case 'secret':
      return 'lock'
    case 'vault-unlock':
    case 'vault-save':
      return 'archive'
    case 'vault-code':
      return 'verified'
  }
}

function HumanGateRows({ gates, snapshots = [] }: { gates: readonly HumanGate[]; snapshots?: readonly OperationsTaskSnapshot[] }) {
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set())

  const answer = (gate: HumanGate, choice: 'deny' | 'once') => {
    if (submitting.has(gate.id)) {
      return
    }

    setSubmitting(current => new Set(current).add(gate.id))
    void resolveHumanGateApproval(gate, choice)
      .catch(error => {
        notifyError(error, 'Could not answer approval')
      })
      .finally(() => {
        setSubmitting(current => {
          const next = new Set(current)
          next.delete(gate.id)

          return next
        })
      })
  }

  return (
    <div className="divide-y divide-(--ui-stroke-tertiary)">
      {gates.map(gate =>
        gate.kind === 'approval' ? (
          <div className="flex min-w-0 items-center gap-3 py-2.5" key={gate.id}>
            <button
              className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-foreground"
              onClick={() => openHumanGateSession(gate)}
              type="button"
            >
              <Codicon className="shrink-0 text-(--ui-text-tertiary)" name={humanGateIcon(gate)} size="0.9rem" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-(--ui-text-primary)">{gate.label}</div>
                <div className="truncate text-xs text-(--ui-text-tertiary)">
                  {gate.sessionLabel + ' · ' + gate.detail}
                </div>
                {gate.approvalProvenance ? (
                  <div className="mt-0.5 truncate font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                    {approvalPolicyDetail(gate)}
                    {(() => {
                      const correlation = gateTaskCorrelation(gate, snapshots)
                      return correlation
                        ? ` · task ${correlation.task.id}${correlation.task.runId != null ? ` · run ${correlation.task.runId}` : ''}`
                        : ''
                    })()}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-secondary)">{gate.state}</div>
            </button>
            <Button
              disabled={submitting.has(gate.id)}
              onClick={() => answer(gate, 'deny')}
              size="sm"
              type="button"
              variant="text"
            >
              Deny
            </Button>
            <Button
              disabled={submitting.has(gate.id)}
              loading={submitting.has(gate.id)}
              onClick={() => answer(gate, 'once')}
              size="sm"
              type="button"
              variant="secondary"
            >
              Run once
            </Button>
          </div>
        ) : (
          <FoundationRow
            action={() => openHumanGateSession(gate)}
            detail={gate.sessionLabel + ' · ' + gate.detail}
            icon={humanGateIcon(gate)}
            key={gate.id}
            label={gate.label}
            state={gate.state}
          />
        )
      )}
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
  const humanGates = useHumanGates()
  const projects = uniqueOperationalProjects(snapshot.snapshots)
  const estop = useHermesEstop()
  const [changingEstop, setChangingEstop] = useState(false)

  const setNewWorkPaused = (engaged: boolean) => {
    if (changingEstop) {
      return
    }
    setChangingEstop(true)
    void estop
      .setEngaged(engaged, engaged ? 'Hermes OS operator emergency stop' : undefined)
      .catch(error => notifyError(error, engaged ? 'Could not pause new work' : 'Could not resume new work'))
      .finally(() => setChangingEstop(false))
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="grid grid-cols-2 gap-x-6 border-b border-(--ui-stroke-tertiary) sm:grid-cols-4">
          <Metric label="Tasks running" value={snapshot.sources.length ? String(runningTasks.length) : '—'} />
          <Metric label="Active runs" value={String(snapshot.activeRuns)} />
          <Metric label="Needs attention" value={String(humanGates.length + attention.length)} />
          <Metric label="Projects" value={snapshot.sources.length ? String(projects.length) : '—'} />
        </div>
      </section>

      <section>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-(--ui-text-primary)">Operator control</h2>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
              Backend-global emergency stop for NEW work. It gates new gateway turns, cron fires, and Kanban dispatch;
              work already in flight is intentionally not killed. Individual running sessions are stopped separately.
            </p>
          </div>
          {estop.data?.engaged ? (
            <Button
              disabled={changingEstop}
              loading={changingEstop}
              onClick={() => setNewWorkPaused(false)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Resume new work
            </Button>
          ) : (
            <Button
              disabled={changingEstop || estop.isError}
              loading={changingEstop}
              onClick={() => setNewWorkPaused(true)}
              size="sm"
              type="button"
              variant="secondary"
            >
              Pause new work
            </Button>
          )}
        </div>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          <FoundationRow
            detail={
              estop.data?.engaged
                ? estop.data.reason || 'Hermes native emergency stop is engaged.'
                : 'Hermes native emergency stop is clear.'
            }
            icon={estop.data?.engaged ? 'debug-pause' : 'play'}
            label="New-work gate"
            state={estop.isError ? 'UNAVAILABLE' : estop.data?.engaged ? 'PAUSED' : estop.isLoading ? 'LOADING' : 'OPEN'}
          />
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
          <OperationalTaskRows
            routes={snapshot.routes.data ?? []}
            snapshots={snapshot.snapshots}
            sources={snapshot.sources}
            tasks={runningTasks}
          />
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
  const humanGates = useHumanGates()

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="bell" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">What Needs Me</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Human gates come directly from Hermes' existing per-session prompt stores. Task entries remain producer-authored
          blocked, review, or diagnostic states. Nothing here infers urgency from message text.
        </p>
      </div>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Human gates</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{humanGates.length}</span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Approvals, clarification questions, elevated access, credentials, password-manager prompts, and verification
          codes. Open a row to answer it in the canonical session UI.
        </p>
        {humanGates.length ? (
          <div className="mt-2">
            <HumanGateRows gates={humanGates} snapshots={snapshot.snapshots} />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No Hermes session is currently waiting on human input.</p>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Task attention</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{tasks.length}</span>
        </div>
        {!snapshot.sources.length ? (
          <div className="mt-2">
            <NoTaskSource />
          </div>
        ) : snapshot.query.isError ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">The task source could not be read.</p>
        ) : tasks.length ? (
          <div className="mt-2">
            <OperationalTaskRows
              routes={snapshot.routes.data ?? []}
              snapshots={snapshot.snapshots}
              sources={snapshot.sources}
              tasks={tasks}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">
            No blocked, review, or diagnosed task currently needs inspection.
          </p>
        )}
      </section>
    </div>
  )
}

function ProjectsPage() {
  const snapshot = useHermesOperations()
  const hermesProjects = useHermesProjects()
  const [selectedProjectId, setSelectedProjectId] = useState<null | string>(null)
  const selectedProject = hermesProjects.projects.find(project => project.id === selectedProjectId) ?? null

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="project" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Hermes Projects</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Project identity, repository membership, and session ownership come from Hermes Projects. Operational task
          sources only overlay workload by exact project id.
        </p>
      </div>

      {hermesProjects.loading && hermesProjects.projects.length === 0 ? (
        <p className="text-xs text-(--ui-text-tertiary)">Loading authoritative project tree…</p>
      ) : hermesProjects.projects.length ? (
        <div className="divide-y divide-(--ui-stroke-tertiary)">
          {hermesProjects.projects.map(project => {
            const tasks = snapshot.snapshots.flatMap(source => source.tasks).filter(task => task.projectId === project.id)
            const running = tasks.filter(task => task.status === 'running').length

            return (
              <button
                className="flex w-full min-w-0 items-center gap-3 py-3 text-left hover:bg-(--chrome-action-hover)"
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                type="button"
              >
                <Codicon
                  className="shrink-0 text-(--ui-text-tertiary)"
                  name={project.isNoProject ? 'home' : project.isAuto ? 'repo' : 'project'}
                  size="0.9rem"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-(--ui-text-primary)">{project.label}</div>
                  <div className="truncate text-xs text-(--ui-text-tertiary)">
                    {[
                      project.path,
                      `${project.repos.length} repo${project.repos.length === 1 ? '' : 's'}`,
                      `${project.sessionCount} session${project.sessionCount === 1 ? '' : 's'}`,
                      tasks.length ? `${tasks.length} task${tasks.length === 1 ? '' : 's'}` : null
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="font-mono text-[0.6875rem] text-(--ui-text-secondary)">
                    {running ? `${running} RUNNING` : tasks.length ? `${tasks.length} TASKS` : 'IDLE'}
                  </div>
                  {project.totalTokens ? (
                    <div className="mt-0.5 font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                      {project.totalTokens.toLocaleString()} tokens
                    </div>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-(--ui-text-tertiary)">
          Hermes Projects has no project records for the active profile.
        </p>
      )}

      <ProjectInspector
        onOpenChange={open => {
          if (!open) {
            setSelectedProjectId(null)
          }
        }}
        open={selectedProject !== null}
        project={selectedProject}
        routes={snapshot.routes.data ?? []}
        snapshots={snapshot.snapshots}
        sources={snapshot.sources}
      />
    </div>
  )
}

function FleetPage() {
  const snapshot = useHermesOperations()
  const liveFleet = useLiveFleet()
  const routes = snapshot.routes.data ?? []
  const sessions = liveFleet.data?.sessions ?? []

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Codicon className="text-(--ui-text-secondary)" name="pulse" size="1rem" />
            <h2 className="text-base font-semibold text-(--ui-text-primary)">Live gateway sessions</h2>
          </div>
          <Button onClick={() => host.navigate('/agents')} size="sm" type="button" variant="text">
            Agents details
          </Button>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Sessions currently resident in the active Hermes gateway. Subagent details are projected from Hermes'
          event-driven Agents store; Fleet no longer issues a subagent-list request per session.
        </p>

        {liveFleet.isError ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">Live gateway fleet is unavailable.</p>
        ) : sessions.length === 0 ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">No live gateway sessions are resident right now.</p>
        ) : (
          <div className="mt-3 divide-y divide-(--ui-stroke-tertiary)">
            {sessions.map(session => (
              <div className="py-3" key={session.id}>
                <div className="flex min-w-0 items-center gap-3">
                  <Codicon
                    className="shrink-0 text-(--ui-text-tertiary)"
                    name={session.status === 'working' || session.status === 'streaming' ? 'sync' : 'circle-filled'}
                    size="0.8rem"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-(--ui-text-primary)">
                      {session.title || session.id}
                    </div>
                    <div className="truncate text-xs text-(--ui-text-tertiary)">
                      {session.model || 'model unresolved'} · {session.id}
                    </div>
                  </div>
                  <div className="shrink-0 font-mono text-[0.6875rem] text-(--ui-text-secondary)">
                    {session.status.toUpperCase()}
                  </div>
                </div>

                {session.subagents.length > 0 ? (
                  <div className="ml-7 mt-2 border-l border-(--ui-stroke-tertiary) pl-3">
                    {session.subagents.map(child => (
                      <div className="flex min-w-0 items-center gap-3 py-1.5" key={child.subagent_id}>
                        <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="git-branch" size="0.7rem" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-(--ui-text-primary)">
                            {child.goal || child.subagent_id}
                          </div>
                          <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
                            {[
                              child.model || 'model unresolved',
                              child.last_tool,
                              child.tool_count ? `${child.tool_count} tools` : null,
                              (child.input_tokens ?? 0) + (child.output_tokens ?? 0) > 0
                                ? `${((child.input_tokens ?? 0) + (child.output_tokens ?? 0)).toLocaleString()} tokens`
                                : null,
                              child.files_read.length + child.files_written.length > 0
                                ? `${child.files_read.length + child.files_written.length} files`
                                : null,
                              child.cost_usd ? `${child.cost_usd.toFixed(2)}` : null
                            ].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-secondary)">
                          {(child.status || 'unknown').toUpperCase()}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="server-process" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Kanban worker sessions</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Dispatcher workers are separate Hermes CLI processes, so they do not belong to the gateway live-session list.
          They are shown from Kanban's exact run-to-worker-session binding instead.
        </p>

        {runningOperationalTasks(snapshot.snapshots).filter(task => task.workerSessionId).length === 0 ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">No running Kanban worker has bound a Hermes session yet.</p>
        ) : (
          <div className="mt-3 divide-y divide-(--ui-stroke-tertiary)">
            {runningOperationalTasks(snapshot.snapshots)
              .filter(task => task.workerSessionId)
              .map(task => (
                <FoundationRow
                  detail={[
                    task.assignee ? 'agent ' + task.assignee : null,
                    task.runId != null ? 'run ' + task.runId : null,
                    task.projectName
                  ].filter(Boolean).join(' · ')}
                  icon="terminal"
                  key={'kanban-worker:' + task.id}
                  label={task.title}
                  state={task.workerSessionId || 'UNBOUND'}
                />
              ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="hubot" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Registered execution routes</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Connection-qualified profile routes describe where agents can execute. They are topology, not a guessed online
          state.
        </p>

        {snapshot.routes.isLoading ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">Loading fleet registry…</p>
        ) : snapshot.routes.isError ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">The current desktop connection registry could not be read.</p>
        ) : routes.length === 0 ? (
          <p className="mt-3 text-xs text-(--ui-text-tertiary)">No registered profile routes are available.</p>
        ) : (
          <div className="mt-3 divide-y divide-(--ui-stroke-tertiary)">
            {routes.map(route => (
              <div
                className="grid min-w-0 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_10rem]"
                key={route.connectionId + ':' + route.profile}
              >
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
      </section>
    </div>
  )
}

function TimelinePage() {
  const snapshot = useHermesOperations()
  const audit = useHermesAudit()
  const runtimeRuns = activeRunIds(snapshot.busyBySession)
  const tasks = executionOperationalTasks(snapshot.snapshots)

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold text-(--ui-text-primary)">Execution history</h2>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{tasks.length}</span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Tasks with recorded execution lineage, newest first. Inspect opens producer-owned run history without copying it
          into Hermes OS.
        </p>
        {!snapshot.sources.length ? (
          <div className="mt-2">
            <NoTaskSource />
          </div>
        ) : tasks.length ? (
          <div className="mt-2">
            <OperationalTaskRows
              routes={snapshot.routes.data ?? []}
              snapshots={snapshot.snapshots}
              sources={snapshot.sources}
              tasks={tasks}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No task source reports recorded execution yet.</p>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-sm font-semibold text-(--ui-text-primary)">Operator / security audit</h2>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
            {audit.data?.events.length ?? 0}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Durable metadata-only human-gate history. Prompt bodies, commands, secrets, verification codes and tool
          output are never stored in this ledger.
        </p>
        {audit.isError ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">The selected backend does not expose the durable audit authority.</p>
        ) : audit.data?.events.length ? (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            {audit.data.events.map(event => (
              <FoundationRow
                detail={[
                  event.subject ? `gate ${event.subject}` : null,
                  event.session_id ? `session ${event.session_id}` : null,
                  new Date(event.created_at * 1000).toLocaleString()
                ].filter(Boolean).join(' · ')}
                icon={event.event.endsWith('resolved') ? 'check' : event.event.endsWith('cancelled') ? 'circle-slash' : 'bell'}
                key={event.id}
                label={event.event.replaceAll('_', ' ').replace('human gate.', '')}
                state={(event.outcome || event.category).toUpperCase()}
              />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No durable operator/security events have been recorded yet.</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-(--ui-text-primary)">Live Hermes runtime sessions</h2>
        {runtimeRuns.length === 0 ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No Hermes session is currently mid-turn.</p>
        ) : (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            {runtimeRuns.map(sessionId => (
              <FoundationRow
                detail="Hermes runtime session currently executing a turn."
                icon="pulse"
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

function SecurityPage() {
  const snapshot = useHermesOperations()
  const humanGates = useHumanGates()
  const approvalModes = useStore($approvalModes)
  const computerUse = useComputerUseSecurity()
  const telemetry = useTelemetrySecurity()
  const network = useNetworkSecurity()
  const approvals = humanGates.filter(gate => gate.kind === 'approval')
  const profiles = new Set([
    snapshot.profile || 'default',
    ...approvals.flatMap(gate => (gate.approvalProvenance ? [gate.approvalProvenance.profile] : []))
  ])

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Codicon className="text-(--ui-text-secondary)" name="shield" size="1rem" />
          <h2 className="text-base font-semibold text-(--ui-text-primary)">Security & approval provenance</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-(--ui-text-tertiary)">
          Approval mode and capability provenance are shown separately. Hermes' global approval modes are Manual, Smart,
          and Off; tool-specific capability manifests remain distinct authorities.
        </p>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-(--ui-text-primary)">Execution boundary</h3>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          <FoundationRow detail="Live gateway transport state." icon="radio-tower" label="Gateway" state={snapshot.gateway || 'UNKNOWN'} />
          <FoundationRow detail="Current Hermes presentation profile." icon="account" label="Profile" state={snapshot.profile || 'default'} />
          <FoundationRow detail={snapshot.cwd || 'No workspace attached.'} icon="folder" label="Workspace scope" state={snapshot.cwd ? 'BOUND' : 'NONE'} />
          <FoundationRow detail={`${snapshot.sources.length} registered read-only source(s)`} icon="lock" label="Operations data" state="READ ONLY" />
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Privacy & telemetry boundary</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
            {telemetry.data
              ? telemetry.data.shared_metrics.transmission_enabled
                ? 'TRANSMITTING'
                : 'NO TRANSMISSION'
              : telemetry.isError
                ? 'UNAVAILABLE'
                : 'LOADING'}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Local, profile-scoped Hermes shared-metrics configuration only. Raw telemetry endpoints are not exposed here,
          and this status does not describe model-provider, MCP, browser, update, or other tool network traffic.
        </p>
        {telemetry.isError ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">
            This backend does not expose the narrow telemetry security summary.
          </p>
        ) : telemetry.data ? (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            <FoundationRow
              detail={
                telemetry.data.shared_metrics.collection_enabled
                  ? 'Hermes shared-metrics collection is enabled for this profile.'
                  : 'Hermes shared-metrics collection is disabled for this profile.'
              }
              icon="graph"
              label="Shared metrics collection"
              state={telemetry.data.shared_metrics.collection_enabled ? 'ENABLED' : 'DISABLED'}
            />
            <FoundationRow
              detail={
                telemetry.data.shared_metrics.transmission_enabled
                  ? 'Shared metrics are effectively permitted to leave Hermes under the current configuration.'
                  : telemetry.data.shared_metrics.transmission_requested
                    ? 'Transmission was requested, but current collection or endpoint-safety rules prevent effective sending.'
                    : 'Shared-metrics transmission is not requested.'
              }
              icon="cloud-upload"
              label="Shared metrics transmission"
              state={telemetry.data.shared_metrics.transmission_enabled ? 'ENABLED' : 'DISABLED'}
            />
            <FoundationRow
              detail={
                telemetry.data.shared_metrics.destination === 'nous'
                  ? 'Configured destination is the built-in Nous telemetry endpoint class.'
                  : telemetry.data.shared_metrics.destination === 'loopback'
                    ? 'Configured destination resolves to a loopback-only endpoint.'
                    : telemetry.data.shared_metrics.destination === 'custom_https'
                      ? 'Configured destination is a custom HTTPS endpoint; the raw address stays hidden.'
                      : 'Configured destination is not eligible for transmission under Hermes endpoint-safety rules.'
              }
              icon="globe"
              label="Telemetry destination"
              state={telemetry.data.shared_metrics.destination.toUpperCase()}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">Reading Hermes telemetry configuration…</p>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Outbound network inventory</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
            {network.data ? 'PARTIAL / PROVEN' : network.isError ? 'UNAVAILABLE' : 'LOADING'}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Sanitized profile-scoped classification only. EXTERNAL means a configured route can leave the machine;
          LOOPBACK means a configured HTTP route resolves locally; PROCESS means Hermes starts a subprocess whose own
          network behavior is not proven. UNKNOWN is intentionally not treated as offline.
        </p>
        {network.isError ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">
            This backend does not expose the narrow outbound-network summary.
          </p>
        ) : network.data ? (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            <FoundationRow
              detail={`Effective startup route for provider ${network.data.model_provider.provider}; fallback routes may differ after provider failure.`}
              icon="symbol-method"
              label="Model provider"
              state={network.data.model_provider.class.toUpperCase()}
            />
            <FoundationRow
              detail={`${network.data.mcp.enabled}/${network.data.mcp.configured} MCP server(s) enabled · external ${network.data.mcp.classes.external} · loopback ${network.data.mcp.classes.loopback} · process ${network.data.mcp.classes.process} · unknown ${network.data.mcp.classes.unknown}${network.data.mcp.subprocess_may_egress ? ' · subprocesses may still egress' : ''}`}
              icon="plug"
              label="MCP"
              state={
                network.data.mcp.classes.external > 0
                  ? 'EXTERNAL'
                  : network.data.mcp.classes.unknown > 0 || network.data.mcp.classes.process > 0
                    ? 'MIXED / UNKNOWN'
                    : network.data.mcp.classes.loopback > 0
                      ? 'LOOPBACK'
                      : 'DISABLED'
              }
            />
            <FoundationRow
              detail="User-directed browser destinations are dynamic and are not inferred from configuration."
              icon="browser"
              label="Browser"
              state={network.data.browser.class.toUpperCase()}
            />
            <FoundationRow
              detail="Computer Use can drive applications with independent network behavior; Hermes cannot honestly classify that egress here."
              icon="remote-explorer"
              label="Computer Use applications"
              state={network.data.computer_use.class.toUpperCase()}
            />
            <FoundationRow
              detail="Messaging transport can be supplied by adapters/plugins; no narrow aggregate runtime authority exists yet."
              icon="comment-discussion"
              label="Messaging"
              state={network.data.messaging.class.toUpperCase()}
            />
            <FoundationRow
              detail="Hermes update checks/downloads are an explicit on-demand external network surface."
              icon="cloud-download"
              label="Updates"
              state={network.data.updates.class.toUpperCase()}
            />
            <FoundationRow
              detail="Same shared-metrics authority shown above; included here only to complete the egress inventory."
              icon="broadcast"
              label="Hermes telemetry"
              state={network.data.telemetry.class.toUpperCase()}
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">Classifying configured outbound surfaces…</p>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Computer Use boundary</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">
            {computerUse.data?.permission_mode.toUpperCase() || (computerUse.isError ? 'UNAVAILABLE' : 'LOADING')}
          </span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          Sanitized profile-scoped policy facts only. Manifest paths and contents never leave the backend authority.
        </p>
        {computerUse.isError ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">
            This backend does not expose the narrow Computer Use security summary.
          </p>
        ) : computerUse.data ? (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            <FoundationRow
              detail={
                computerUse.data.permission_mode === 'bounded'
                  ? 'cua-driver is configured with a manifest-backed capability ceiling.'
                  : 'Normal Computer Use approval behavior; unrestricted remains session-only via explicit approval bypass.'
              }
              icon="remote-explorer"
              label="Permission mode"
              state={computerUse.data.permission_mode.toUpperCase()}
            />
            <FoundationRow
              detail={
                computerUse.data.telemetry_enabled
                  ? 'cua-driver anonymous telemetry is explicitly enabled by profile configuration.'
                  : 'Hermes disables cua-driver anonymous telemetry by default.'
              }
              icon="broadcast"
              label="Driver telemetry"
              state={computerUse.data.telemetry_enabled ? 'ENABLED' : 'DISABLED'}
            />
            <FoundationRow
              detail={
                !computerUse.data.manifest.configured
                  ? computerUse.data.manifest.required
                    ? 'Bounded mode requires a capability manifest, but none is configured.'
                    : 'No capability manifest is configured for this profile.'
                  : !computerUse.data.manifest.readable
                    ? 'A capability manifest is configured but cannot be safely read.'
                    : computerUse.data.manifest.version == null
                      ? 'Manifest is readable but has no recognized integer version.'
                      : computerUse.data.manifest.mode_independent
                        ? `Capability manifest v${computerUse.data.manifest.version}; usable as a ceiling across permission modes.`
                        : `Legacy capability manifest v${computerUse.data.manifest.version}; mode-specific semantics apply.`
              }
              icon="shield"
              label="Capability manifest"
              state={
                !computerUse.data.manifest.configured
                  ? computerUse.data.manifest.required
                    ? 'MISSING'
                    : 'NONE'
                  : !computerUse.data.manifest.readable
                    ? 'UNREADABLE'
                    : computerUse.data.manifest.mode_independent
                      ? `V${computerUse.data.manifest.version}`
                      : 'LEGACY'
              }
            />
          </div>
        ) : (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">Reading Computer Use security state…</p>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Approval modes</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{profiles.size}</span>
        </div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-(--ui-text-tertiary)">
          UNKNOWN means this Desktop window has not confirmed that profile's mode; it is not silently treated as Smart.
        </p>
        <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
          {[...profiles].sort().map(profile => (
            <FoundationRow
              detail={
                approvalModes[profile]
                  ? approvalModes[profile] === 'manual'
                    ? 'Flagged operations require a human decision.'
                    : approvalModes[profile] === 'smart'
                      ? 'Hermes may assess flagged terminal operations; requests that reach this inbox still require human input.'
                      : 'Standard terminal approval prompting is disabled for this profile.'
                  : 'No confirmed approval-mode value is cached in this Desktop window.'
              }
              icon="verified"
              key={profile}
              label={profile}
              state={(approvalModes[profile] || 'unknown').toUpperCase()}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-4">
          <h3 className="text-sm font-semibold text-(--ui-text-primary)">Pending approval provenance</h3>
          <span className="font-mono text-[0.6875rem] text-(--ui-text-tertiary)">{approvals.length}</span>
        </div>
        {approvals.length === 0 ? (
          <p className="mt-2 text-xs text-(--ui-text-tertiary)">No command approval is currently waiting.</p>
        ) : (
          <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
            {approvals.map(gate => {
              const provenance = gate.approvalProvenance
              const correlation = gateTaskCorrelation(gate, snapshot.snapshots)

              return (
                <div className="py-3" key={gate.id}>
                  <div className="flex min-w-0 items-start gap-3">
                    <Codicon className="mt-0.5 shrink-0 text-(--ui-text-tertiary)" name="shield" size="0.9rem" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-(--ui-text-primary)">{gate.label}</div>
                      <div className="mt-0.5 truncate text-xs text-(--ui-text-tertiary)">{gate.detail}</div>
                      <div className="mt-2 grid gap-x-5 gap-y-1 text-[0.6875rem] sm:grid-cols-2">
                        <span className="text-(--ui-text-tertiary)">Session: {gate.sessionLabel}</span>
                        <span className="text-(--ui-text-tertiary)">Profile: {provenance?.profile || 'unknown'}</span>
                        <span className="text-(--ui-text-tertiary)">Mode: {(provenance?.mode || 'unknown').toUpperCase()}</span>
                        <span className="text-(--ui-text-tertiary)">Tool: {provenance?.toolName || 'not provided'}</span>
                        <span className="text-(--ui-text-tertiary)">Consent: {approvalScopeLabel(gate)}</span>
                        <span className="text-(--ui-text-tertiary)">
                          Rule: {provenance?.patternKeys.length ? provenance.patternKeys.join(', ') : 'not provided'}
                        </span>
                        <span className="text-(--ui-text-tertiary)">
                          Smart deny: {provenance?.smartDenied ? 'YES — once/deny override only' : 'NO / not signaled'}
                        </span>
                        <span className="text-(--ui-text-tertiary)">
                          Lineage:{' '}
                          {correlation
                            ? `${correlation.task.id}${correlation.task.runId != null ? ` / run ${correlation.task.runId}` : ''}`
                            : 'no visible operations task match'}
                        </span>
                      </div>
                    </div>
                    <Button onClick={() => openHumanGateSession(gate)} size="sm" type="button" variant="text">
                      Session
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
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
