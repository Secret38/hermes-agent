/**
 * Read-only operational task-source contract.
 *
 * This is intentionally narrow: a producer keeps ownership of persistence,
 * writes, workflow rules, and rich detail UI. Consumers (Mission Control,
 * observability surfaces) get a normalized snapshot only.
 */
export const OPERATIONS_TASK_SOURCES_AREA = 'operations.taskSources'

export interface OperationsTaskWarning {
  count: number
  severity?: null | string
}

export interface OperationsTask {
  id: string
  title: string
  status: string
  assignee?: null | string
  priority?: number
  projectId?: null | string
  projectName?: null | string
  /** Durable originating Hermes session when the producer has one. Not a worker runtime id. */
  originSessionId?: null | string
  runId?: null | number | string
  workerSessionId?: null | string
  startedAt?: null | number
  lastHeartbeatAt?: null | number
  warning?: null | OperationsTaskWarning
}

export interface OperationsProject {
  id: string
  name: string
  slug?: string
  path?: null | string
}

export interface OperationsTaskSnapshot {
  sourceId: string
  sourceLabel: string
  /** Registry connection that produced this snapshot, when known. */
  connectionId?: null | string
  /** Active/source profile when the producer was read. */
  profile?: null | string
  tasks: OperationsTask[]
  projects: OperationsProject[]
  scopeLabel?: null | string
  observedAt: number
}

export interface OperationsTaskSource {
  id: string
  label: string
  queryKey: readonly unknown[]
  readSnapshot: () => Promise<OperationsTaskSnapshot>
  /** Optional deep link into the producer's native UI. */
  openTask?: (taskId: string) => void
}
