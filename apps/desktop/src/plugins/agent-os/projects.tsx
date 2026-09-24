import {
  Codicon,
  goToProject,
  host,
  type PluginProfileRoute,
  type SessionInfo,
  type SidebarProjectTree,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import { useHermesOperations } from './operations-data'
import {
  flattenProjectSessions,
  projectOperationalTasks,
  readProjectWorkspace,
  useHermesProjects
} from './project-data'
import { launchProjectWorkspaceSurface, type ProjectWorkspaceSurface } from './project-workspace'
import { exactOperationsRoute } from './selectors'
import { openHermesSession } from './session-navigation'

function compactNumber(value: null | number | undefined): string {
  if (value == null || !Number.isFinite(value)) {return '—'}

  return new Intl.NumberFormat(undefined, { maximumFractionDigits: value < 10 ? 2 : 0 }).format(value)
}

function sessionTitle(session: SessionInfo): string {
  return session.title?.trim() || session.preview?.trim() || `Session #${session.id.slice(-6)}`
}

function sessionOwner(
  session: SessionInfo,
  activeConnectionId: null | string,
  activeProfile: string,
  routes: readonly PluginProfileRoute[]
): { allowed: boolean; route?: PluginProfileRoute } {
  const profile = session.profile || activeProfile || 'default'

  if (session.connection_id) {
    if (session.connection_id === activeConnectionId && profile === activeProfile) {return { allowed: true }}
    const route = exactOperationsRoute(session.connection_id, profile, routes)

    return route ? { allowed: true, route } : { allowed: false }
  }

  return { allowed: profile === activeProfile }
}

function ProjectCard({
  active,
  onClick,
  project,
  taskCount
}: {
  active: boolean
  onClick: () => void
  project: SidebarProjectTree
  taskCount: number
}) {
  return (
    <button
      className="w-full rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-3 text-left hover:bg-(--ui-control-hover-background)"
      data-selected={active}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-foreground">{project.label}</div>
          <div className="mt-1 text-[0.6rem] text-(--ui-text-tertiary)">
            {project.sessionCount} sessions · {taskCount} tasks
          </div>
        </div>
        <Codicon name="project" size="0.78rem" />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[0.58rem] text-(--ui-text-tertiary)">
        <span>{compactNumber(project.totalTokens)} tokens</span>
        <span>{project.totalCostUsd == null ? 'cost —' : `$${project.totalCostUsd.toFixed(2)}`}</span>
        <span>{project.repos.length} roots</span>
      </div>
    </button>
  )
}

export function ProjectsView() {
  const projectsState = useHermesProjects()
  const operations = useHermesOperations()
  const activeConnectionId = useValue(host.state.connectionId)
  const activeProfile = useValue(host.state.profile) || 'default'
  const routes = operations.routes.data ?? []
  const projects = projectsState.projects.filter(project => !project.isNoProject)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspaceSessionId, setWorkspaceSessionId] = useState<string | null>(null)
  const [openingSurface, setOpeningSurface] = useState<ProjectWorkspaceSurface | null>(null)

  const selected = projects.find(project => project.id === selectedId) ?? projects[0] ?? null

  const workspace = useQuery({
    enabled: Boolean(selected?.id),
    queryFn: () => readProjectWorkspace(selected!.id),
    queryKey: ['agent-os', 'project-workspace', activeConnectionId, activeProfile, selected?.id],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5_000
  })

  const hydrated = workspace.data ?? selected
  const sessions = useMemo(() => flattenProjectSessions(hydrated), [hydrated])
  const tasks = selected ? projectOperationalTasks(operations.snapshots, selected.id) : []

  const effectiveWorkspaceSessionId =
    workspaceSessionId && sessions.some(session => session.id === workspaceSessionId)
      ? workspaceSessionId
      : sessions[0]?.id ?? null

  const workspaceSession = sessions.find(session => session.id === effectiveWorkspaceSessionId) ?? null

  const workspaceOwner = workspaceSession
    ? sessionOwner(workspaceSession, activeConnectionId, activeProfile, routes)
    : { allowed: false as const }

  const launch = async (surface: ProjectWorkspaceSurface) => {
    if (!workspaceSession || !workspaceOwner.allowed || openingSurface) {return}
    setOpeningSurface(surface)

    try {
      await launchProjectWorkspaceSurface(workspaceSession.id, workspaceOwner.route, surface)
    } catch (error) {
      host.notifyError(error, 'Project workspace unavailable')
    } finally {
      setOpeningSurface(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="aos-panel p-3"><div className="aos-kicker">Projects</div><div className="mt-1 text-lg font-semibold">{projects.length}</div></div>
        <div className="aos-panel p-3"><div className="aos-kicker">Sessions</div><div className="mt-1 text-lg font-semibold">{projects.reduce((n, p) => n + p.sessionCount, 0)}</div></div>
        <div className="aos-panel p-3"><div className="aos-kicker">Operational tasks</div><div className="mt-1 text-lg font-semibold">{operations.snapshots.flatMap(s => s.tasks).filter(t => t.projectId).length}</div></div>
        <div className="aos-panel p-3"><div className="aos-kicker">Authority</div><div className="mt-1 text-xs font-semibold">Hermes Projects</div></div>
      </div>

      <div className="grid min-h-0 gap-3 xl:grid-cols-[19rem_minmax(0,1fr)]">
        <section className="aos-panel overflow-hidden">
          <div className="border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
            <div className="text-xs font-semibold">Authoritative projects</div>
            <div className="mt-0.5 text-[0.6rem] text-(--ui-text-tertiary)">No path/name inference · Kanban is workload overlay only</div>
          </div>
          <div className="aos-scrollbar max-h-[42rem] space-y-1.5 overflow-y-auto p-2.5">
            {projectsState.loading && !projects.length ? <div className="p-3 text-xs text-(--ui-text-tertiary)">Loading projects…</div> : null}
            {!projectsState.loading && !projects.length ? <div className="p-3 text-xs text-(--ui-text-tertiary)">No Hermes Projects configured.</div> : null}
            {projects.map(project => (
              <ProjectCard
                active={project.id === selected?.id}
                key={project.id}
                onClick={() => {
                  setSelectedId(project.id)
                  setWorkspaceSessionId(null)
                }}
                project={project}
                taskCount={projectOperationalTasks(operations.snapshots, project.id).length}
              />
            ))}
          </div>
        </section>

        {selected ? (
          <div className="space-y-3">
            <section className="aos-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="aos-kicker">Project</div>
                  <div className="mt-1 truncate text-lg font-semibold">{selected.label}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.62rem] text-(--ui-text-tertiary)">
                    <span>{selected.sessionCount} sessions</span>
                    <span>{compactNumber(selected.totalTokens)} tokens</span>
                    <span>{selected.totalCostUsd == null ? 'cost —' : `$${selected.totalCostUsd.toFixed(2)}`}</span>
                    <span>{tasks.length} operational tasks</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.62rem]" onClick={() => goToProject(selected.id)} type="button">Open project</button>
                  <button className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.62rem]" onClick={() => goToProject(selected.id, { newSession: true })} type="button">New session</button>
                </div>
              </div>
            </section>

            <section className="aos-panel overflow-hidden">
              <div className="border-b border-(--ui-stroke-tertiary) px-3.5 py-3 text-xs font-semibold">Workspace roots</div>
              <div className="grid gap-2 p-3 md:grid-cols-2">
                {(hydrated?.repos ?? []).map(repo => (
                  <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2.5" key={repo.id}>
                    <div className="truncate text-xs font-medium">{repo.label}</div>
                    {repo.path ? <div className="mt-1 truncate font-mono text-[0.58rem] text-(--ui-text-tertiary)">{repo.path}</div> : null}
                    <div className="mt-1 text-[0.58rem] text-(--ui-text-tertiary)">{repo.sessionCount} sessions · {repo.groups.length} lanes</div>
                  </div>
                ))}
              </div>
            </section>

            <section className="aos-panel overflow-hidden">
              <div className="border-b border-(--ui-stroke-tertiary) px-3.5 py-3 text-xs font-semibold">Project workspace</div>
              <div className="p-3">
                {workspaceSession && workspaceOwner.allowed ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{sessionTitle(workspaceSession)}</div>
                        <div className="mt-1 truncate text-[0.6rem] text-(--ui-text-tertiary)">
                          {[workspaceSession.model, workspaceSession.git_branch, workspaceSession.cwd].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <select
                        className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) px-2 py-1 text-[0.62rem]"
                        onChange={event => setWorkspaceSessionId(event.target.value)}
                        value={effectiveWorkspaceSessionId ?? ''}
                      >
                        {sessions.map(session => <option key={session.id} value={session.id}>{sessionTitle(session)}</option>)}
                      </select>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(['chat', 'files', 'changes', 'browser', 'terminal'] as const).map(surface => (
                        <button
                          className="rounded border border-(--ui-stroke-tertiary) px-2 py-1 text-[0.62rem] hover:bg-(--ui-control-hover-background) disabled:opacity-50"
                          disabled={Boolean(openingSurface) || ((surface === 'files' || surface === 'changes' || surface === 'terminal') && !workspaceSession.cwd)}
                          key={surface}
                          onClick={() => void launch(surface)}
                          type="button"
                        >
                          {openingSurface === surface ? 'Opening…' : surface[0].toUpperCase() + surface.slice(1)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : workspaceSession ? (
                  <div className="text-xs text-(--ui-text-tertiary)">Session owner route cannot be resolved safely.</div>
                ) : (
                  <div className="text-xs text-(--ui-text-tertiary)">No project session is available yet.</div>
                )}
              </div>
            </section>

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="aos-panel overflow-hidden">
                <div className="border-b border-(--ui-stroke-tertiary) px-3.5 py-3 text-xs font-semibold">Sessions</div>
                <div className="aos-scrollbar max-h-80 overflow-y-auto p-2.5">
                  {sessions.map(session => {
                    const owner = sessionOwner(session, activeConnectionId, activeProfile, routes)

                    return (
                      <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) py-2 last:border-0" key={session._lineage_root_id || session.id}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[0.68rem] font-medium">{sessionTitle(session)}</div>
                          <div className="mt-0.5 truncate text-[0.56rem] text-(--ui-text-tertiary)">{session.model || 'model unresolved'} · {compactNumber(session.input_tokens + session.output_tokens)} tokens</div>
                        </div>
                        {owner.allowed ? <button className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-1 text-[0.56rem]" onClick={() => openHermesSession(session.id, owner.route)} type="button">Open</button> : <span className="text-[0.52rem] text-(--ui-text-quaternary)">ROUTE UNKNOWN</span>}
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="aos-panel overflow-hidden">
                <div className="border-b border-(--ui-stroke-tertiary) px-3.5 py-3 text-xs font-semibold">Operational tasks</div>
                <div className="aos-scrollbar max-h-80 overflow-y-auto p-2.5">
                  {tasks.length ? tasks.map(task => {
                    const snapshot = operations.snapshots.find(candidate => candidate.tasks.some(item => item === task))
                    const source = snapshot ? operations.sources.find(item => item.id === snapshot.sourceId) : undefined

                    return (
                      <div className="flex items-center gap-2 border-b border-(--ui-stroke-tertiary) py-2 last:border-0" key={task.id}>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[0.68rem] font-medium">{task.title}</div>
                          <div className="mt-0.5 text-[0.56rem] text-(--ui-text-tertiary)">{task.status.toUpperCase()}{task.runId != null ? ` · run ${task.runId}` : ''}</div>
                        </div>
                        {source?.openTask ? <button className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-1 text-[0.56rem]" onClick={() => source.openTask?.(task.id)} type="button">Task</button> : null}
                      </div>
                    )
                  }) : <div className="p-2 text-xs text-(--ui-text-tertiary)">No operational tasks linked by exact project id.</div>}
                </div>
              </section>
            </div>
          </div>
        ) : (
          <section className="aos-panel grid min-h-72 place-items-center text-xs text-(--ui-text-tertiary)">No project selected.</section>
        )}
      </div>
    </div>
  )
}
