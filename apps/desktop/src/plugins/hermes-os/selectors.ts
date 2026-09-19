import type { OperationsTask, OperationsTaskSnapshot, PluginProfileRoute } from '@hermes/plugin-sdk'

export function activeRunIds(busyBySession: Readonly<Record<string, boolean>>): string[] {
  return Object.entries(busyBySession)
    .filter(([, busy]) => busy)
    .map(([sessionId]) => sessionId)
}

export function activeRunCount(busyBySession: Readonly<Record<string, boolean>>): number {
  return activeRunIds(busyBySession).length
}

export function allOperationalTasks(snapshots: readonly OperationsTaskSnapshot[]): OperationsTask[] {
  return snapshots.flatMap(snapshot => snapshot.tasks)
}

export function runningOperationalTasks(snapshots: readonly OperationsTaskSnapshot[]): OperationsTask[] {
  return allOperationalTasks(snapshots).filter(task => task.status === 'running')
}

/** Mechanical attention candidates only — no inference about user intent.
 * Blocked/review states and explicit diagnostics are all producer-authored. */
export function attentionOperationalTasks(snapshots: readonly OperationsTaskSnapshot[]): OperationsTask[] {
  return allOperationalTasks(snapshots).filter(
    task => task.status === 'blocked' || task.status === 'review' || Boolean(task.warning?.count)
  )
}

export function uniqueOperationalProjects(snapshots: readonly OperationsTaskSnapshot[]) {
  const projects = new Map<string, OperationsTaskSnapshot['projects'][number]>()

  for (const snapshot of snapshots) {
    for (const project of snapshot.projects) {
      projects.set(project.id, project)
    }
  }

  return [...projects.values()]
}

export function taskCountForProject(snapshots: readonly OperationsTaskSnapshot[], projectId: string): number {
  return allOperationalTasks(snapshots).filter(task => task.projectId === projectId && task.status !== 'done').length
}


/** Exact route for a standalone worker session. Fail closed when the producer
 * cannot prove its source connection or when more than one route could own the
 * assignee profile on that connection. */
export function exactWorkerRoute(
  task: OperationsTask,
  snapshot: OperationsTaskSnapshot | null,
  routes: readonly PluginProfileRoute[]
): PluginProfileRoute | null {
  if (!task.workerSessionId || !task.assignee || !snapshot?.connectionId) {
    return null
  }

  const matches = routes.filter(
    route => route.connectionId === snapshot.connectionId && route.targetProfile === task.assignee
  )

  return matches.length === 1 ? matches[0] : null
}
