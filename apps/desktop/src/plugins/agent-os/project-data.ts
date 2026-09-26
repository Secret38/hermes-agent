import {
  $projectTree,
  $projectTreeLoading,
  fetchProjectSessions,
  host,
  type OperationsTask,
  type OperationsTaskSnapshot,
  refreshProjectTree,
  type SessionInfo,
  type SidebarProjectTree,
  useValue
} from '@hermes/plugin-sdk'
import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

export function projectOperationalTasks(
  snapshots: readonly OperationsTaskSnapshot[],
  projectId: string
): OperationsTask[] {
  return snapshots.flatMap(snapshot => snapshot.tasks).filter(task => task.projectId === projectId)
}

export function flattenProjectSessions(project: SidebarProjectTree | null | undefined): SessionInfo[] {
  if (!project) {return []}

  const newestByLineage = new Map<string, SessionInfo>()

  const consider = (session: SessionInfo) => {
    const key = session._lineage_root_id || session.id
    const current = newestByLineage.get(key)
    const activity = session.last_active || session.started_at || 0
    const currentActivity = current ? current.last_active || current.started_at || 0 : -1

    if (!current || activity > currentActivity) {newestByLineage.set(key, session)}
  }

  for (const repo of project.repos) {
    for (const group of repo.groups) {group.sessions.forEach(consider)}
  }

  project.previewSessions?.forEach(consider)

  return [...newestByLineage.values()].sort(
    (a, b) => (b.last_active || b.started_at || 0) - (a.last_active || a.started_at || 0)
  )
}

export function useHermesProjects() {
  const projects = useStore($projectTree)
  const loading = useStore($projectTreeLoading)
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)

  useEffect(() => {
    void refreshProjectTree()
  }, [connectionId, profile])

  return { loading, projects }
}

export async function readProjectWorkspace(projectId: string): Promise<SidebarProjectTree | null> {
  return fetchProjectSessions(projectId, { supersedable: false })
}
