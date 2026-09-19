import {
  Button,
  Codicon,
  host,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  type PluginProfileRoute,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'

import { useState } from 'react'

import type { SessionInfo } from '@/hermes'
import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'
import { goToProject } from '@/store/projects'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

import { ExecutionInspector, type ExecutionInspectorSelection } from './execution-inspector'
import { sourceForSnapshot } from './operations-data'
import { flattenProjectSessions, projectOperationalTasks, readProjectWorkspace } from './project-data'
import { exactOperationsRoute } from './selectors'
import { openHermesSession } from './session-navigation'

function compactNumber(value: null | number | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 2 : 0 }).format(value)
}

function sessionTitle(session: SessionInfo): string {
  return session.title?.trim() || session.preview?.trim() || `Session #${session.id.slice(-6)}`
}

function canOpenProjectSession(
  session: SessionInfo,
  activeConnectionId: null | string,
  activeProfile: string,
  routes: readonly PluginProfileRoute[]
): { allowed: boolean; route?: PluginProfileRoute } {
  const profile = session.profile || activeProfile || 'default'

  if (session.connection_id) {
    if (session.connection_id === activeConnectionId && profile === activeProfile) {
      return { allowed: true }
    }

    const route = exactOperationsRoute(session.connection_id, profile, routes)
    return route ? { allowed: true, route } : { allowed: false }
  }

  if (profile !== activeProfile) {
    return { allowed: false }
  }

  // This row came from projects.project_sessions on the active gateway/profile.
  // No explicit route is required for the primary/current connection.
  return { allowed: true }
}

function ProjectSessionRow({
  session,
  routes
}: {
  session: SessionInfo
  routes: readonly PluginProfileRoute[]
}) {
  const activeConnectionId = useValue(host.state.connectionId)
  const activeProfile = useValue(host.state.profile) || 'default'
  const owner = canOpenProjectSession(session, activeConnectionId, activeProfile, routes)

  return (
    <div className="flex min-w-0 items-center gap-3 py-2.5">
      <Codicon
        className="shrink-0 text-(--ui-text-tertiary)"
        name={session.is_active ? 'pulse' : 'comment-discussion'}
        size="0.85rem"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-(--ui-text-primary)">{sessionTitle(session)}</div>
        <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
          {(session.model || 'model unresolved') +
            ' · ' +
            compactNumber(session.input_tokens + session.output_tokens) +
            ' tokens' +
            (session.git_branch ? ' · ' + session.git_branch : '')}
        </div>
      </div>
      {owner.allowed ? (
        <Button
          onClick={() => openHermesSession(session.id, owner.route)}
          size="sm"
          type="button"
          variant="text"
        >
          Open
        </Button>
      ) : (
        <span className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)">ROUTE UNKNOWN</span>
      )}
    </div>
  )
}

export function ProjectInspector({
  onOpenChange,
  open,
  project,
  routes,
  snapshots,
  sources
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  project: SidebarProjectTree | null
  routes: readonly PluginProfileRoute[]
  snapshots: readonly OperationsTaskSnapshot[]
  sources: readonly OperationsTaskSource[]
}) {
  const activeConnectionId = useValue(host.state.connectionId)
  const activeProfile = useValue(host.state.profile) || 'default'
  const [executionSelection, setExecutionSelection] = useState<ExecutionInspectorSelection | null>(null)

  const workspace = useQuery({
    enabled: Boolean(project?.id),
    queryFn: () => readProjectWorkspace(project!.id),
    queryKey: ['hermes-os', 'project-workspace', activeConnectionId, activeProfile, project?.id],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5_000
  })

  const hydrated = workspace.data ?? project
  const sessions = flattenProjectSessions(hydrated)
  const tasks = project ? projectOperationalTasks(snapshots, project.id) : []

  return (
    <Sheet
      onOpenChange={nextOpen => {
        if (!nextOpen) {
          setExecutionSelection(null)
        }

        onOpenChange(nextOpen)
      }}
      open={open}
    >
      <SheetContent className="sm:max-w-2xl" side="right">
        {project ? (
          <>
            <SheetHeader className="border-b border-(--ui-stroke-tertiary) pr-10">
              <SheetTitle>{project.label}</SheetTitle>
              <SheetDescription>
                Hermes Project authority · {project.sessionCount} session{project.sessionCount === 1 ? '' : 's'} ·{' '}
                {tasks.length} task{tasks.length === 1 ? '' : 's'}
              </SheetDescription>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button onClick={() => goToProject(project.id)} size="sm" type="button" variant="text">
                  Open project
                </Button>
                <Button
                  onClick={() => goToProject(project.id, { newSession: true })}
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  New session
                </Button>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
              <section className="grid grid-cols-2 gap-x-5 gap-y-3 py-3 sm:grid-cols-4">
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Sessions</div>
                  <div className="mt-0.5 text-sm text-(--ui-text-primary)">{project.sessionCount}</div>
                </div>
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Tasks</div>
                  <div className="mt-0.5 text-sm text-(--ui-text-primary)">{tasks.length}</div>
                </div>
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Tokens</div>
                  <div className="mt-0.5 text-sm text-(--ui-text-primary)">{compactNumber(project.totalTokens)}</div>
                </div>
                <div>
                  <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Cost</div>
                  <div className="mt-0.5 text-sm text-(--ui-text-primary)">
                    {project.totalCostUsd == null ? '—' : `$${project.totalCostUsd.toFixed(2)}`}
                  </div>
                </div>
              </section>

              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Workspace roots</h3>
                {hydrated?.repos.length ? (
                  <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
                    {hydrated.repos.map(repo => (
                      <div className="py-2" key={repo.id}>
                        <div className="flex min-w-0 items-center gap-2">
                          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="repo" size="0.8rem" />
                          <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--ui-text-secondary)">
                            {repo.label}
                          </span>
                          <span className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                            {repo.sessionCount} sessions
                          </span>
                        </div>
                        {repo.path ? (
                          <div className="ml-5 mt-0.5 truncate font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                            {repo.path}
                          </div>
                        ) : null}
                        {repo.groups.length ? (
                          <div className="ml-5 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                            {repo.groups.map(group => (
                              <span className="text-[0.625rem] text-(--ui-text-tertiary)" key={group.id}>
                                {group.label} · {group.sessions.length}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">No repository/worktree roots are published.</p>
                )}
              </section>

              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xs font-semibold text-(--ui-text-primary)">Sessions</h3>
                  <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">{sessions.length}</span>
                </div>
                {workspace.isError ? (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">
                    Full project session hydration is unavailable; showing the authoritative overview preview only.
                  </p>
                ) : workspace.isLoading && !workspace.data ? (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">Loading project sessions…</p>
                ) : sessions.length ? (
                  <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
                    {sessions.map(session => (
                      <ProjectSessionRow key={session._lineage_root_id || session.id} routes={routes} session={session} />
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">No sessions are currently assigned to this project.</p>
                )}
              </section>

              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xs font-semibold text-(--ui-text-primary)">Operational tasks</h3>
                  <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">{tasks.length}</span>
                </div>
                {tasks.length ? (
                  <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
                    {tasks.map(task => {
                      const snapshot = snapshots.find(candidate =>
                        candidate.tasks.some(candidateTask => candidateTask === task)
                      )
                      const source = snapshot ? sourceForSnapshot(sources, snapshot) : undefined

                      return (
                        <div className="flex min-w-0 items-center gap-3 py-2.5" key={task.id}>
                          <Codicon
                            className="shrink-0 text-(--ui-text-tertiary)"
                            name={task.status === 'running' ? 'sync' : task.status === 'done' ? 'pass' : 'circle-outline'}
                            size="0.85rem"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-(--ui-text-primary)">{task.title}</div>
                            <div className="truncate text-[0.6875rem] text-(--ui-text-tertiary)">
                              {task.status.toUpperCase()}
                              {task.assignee ? ' · ' + task.assignee : ''}
                              {task.runId != null ? ' · run ' + task.runId : ''}
                            </div>
                          </div>
                          {source?.readTaskExecution && snapshot ? (
                            <Button
                              onClick={() => setExecutionSelection({ snapshot, source, task })}
                              size="sm"
                              type="button"
                              variant="secondary"
                            >
                              Inspect
                            </Button>
                          ) : null}
                          {source?.openTask ? (
                            <Button onClick={() => source.openTask?.(task.id)} size="sm" type="button" variant="text">
                              Task
                            </Button>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">No operational task source links work to this project.</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
      <ExecutionInspector
        onOpenChange={nextOpen => {
          if (!nextOpen) {
            setExecutionSelection(null)
          }
        }}
        open={executionSelection !== null}
        routes={routes}
        selection={executionSelection}
      />
    </Sheet>
  )
}
