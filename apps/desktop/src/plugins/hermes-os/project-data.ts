import { useStore } from '@nanostores/react'
import { useEffect } from 'react'

import type { OperationsTask, OperationsTaskSnapshot } from '@hermes/plugin-sdk'
import type { SessionInfo } from '@/hermes'
import {
  $projectTree,
  $projectTreeLoading,
  fetchProjectSessions,
  refreshProjectTree
} from '@/store/projects'
import type { SidebarProjectTree } from '@/app/chat/sidebar/projects/workspace-groups'

export function projectOperationalTasks(
  snapshots: readonly OperationsTaskSnapshot[],
  projectId: string
): OperationsTask[] {
  return snapshots.flatMap(snapshot => snapshot.tasks).filter(task => task.projectId === projectId)
}

export function flattenProjectSessions(project: SidebarProjectTree | null | undefined): SessionInfo[] {
  if (!project) {
    return []
  }

  const seen = new Set<string>()
  const sessions: SessionInfo[] = []

  for (const repo of project.repos) {
    for (const group of repo.groups) {
      for (const session of group.sessions) {
        const key = session._lineage_root_id || session.id

        if (!seen.has(key)) {
          seen.add(key)
          sessions.push(session)
        }
      }
    }
  }

  return sessions.sort((a, b) => (b.last_active || b.started_at || 0) - (a.last_active || a.started_at || 0))
}

export function useHermesProjects() {
  const projects = useStore($projectTree)
  const loading = useStore($projectTreeLoading)

  useEffect(() => {
    void refreshProjectTree()
  }, [])

  return { loading, projects }
}

export async function readProjectWorkspace(projectId: string): Promise<SidebarProjectTree | null> {
  return fetchProjectSessions(projectId, { supersedable: false })
}
