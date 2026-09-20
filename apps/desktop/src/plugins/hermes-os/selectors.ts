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

export interface OperationalWorkflowCounts {
  triage: number
  todo: number
  scheduled: number
  ready: number
  running: number
  blocked: number
  review: number
  done: number
  other: number
}

/** Exact producer-authored task-state counts. No semantic stage is inferred. */
export function operationalWorkflowCounts(
  snapshots: readonly OperationsTaskSnapshot[]
): OperationalWorkflowCounts {
  const counts: OperationalWorkflowCounts = {
    triage: 0,
    todo: 0,
    scheduled: 0,
    ready: 0,
    running: 0,
    blocked: 0,
    review: 0,
    done: 0,
    other: 0
  }

  for (const task of allOperationalTasks(snapshots)) {
    if (task.status in counts && task.status !== 'other') {
      counts[task.status as keyof Omit<OperationalWorkflowCounts, 'other'>] += 1
    } else {
      counts.other += 1
    }
  }

  return counts
}

export function executionOperationalTasks(snapshots: readonly OperationsTaskSnapshot[]): OperationsTask[] {
  return allOperationalTasks(snapshots)
    .filter(task => task.runId != null || Boolean(task.workerSessionId) || task.startedAt != null)
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
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


export function exactOperationsRoute(
  connectionId: null | string | undefined,
  targetProfile: null | string | undefined,
  routes: readonly PluginProfileRoute[]
): PluginProfileRoute | null {
  if (!connectionId || !targetProfile) {
    return null
  }

  const matches = routes.filter(
    route => route.connectionId === connectionId && route.targetProfile === targetProfile
  )

  return matches.length === 1 ? matches[0] : null
}

/** Exact route for a standalone worker session. Fail closed when the producer
 * cannot prove its source connection or when more than one route could own the
 * assignee profile on that connection. */
export function exactWorkerRoute(
  task: OperationsTask,
  snapshot: OperationsTaskSnapshot | null,
  routes: readonly PluginProfileRoute[]
): PluginProfileRoute | null {
  if (!task.workerSessionId) {
    return null
  }

  return exactOperationsRoute(snapshot?.connectionId, task.assignee, routes)
}
