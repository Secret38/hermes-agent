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

export interface OperationsRun {
  id: number | string
  status: string
  outcome?: null | string
  profile?: null | string
  workerSessionId?: null | string
  workerPid?: null | number
  startedAt?: null | number
  endedAt?: null | number
  summary?: null | string
  error?: null | string
}

export interface OperationsArtifact {
  id: number | string
  name: string
  sizeBytes?: null | number
}

export interface OperationsEvent {
  id: number | string
  kind: string
  createdAt: number
  detail?: null | string
}

export interface OperationsTaskLog {
  exists: boolean
  sizeBytes: number
  content: string
  truncated: boolean
}


export interface OperationsTaskExecution {
  taskId: string
  result?: null | string
  lastFailureError?: null | string
  workspacePath?: null | string
  branchName?: null | string
  runs: OperationsRun[]
  artifacts: OperationsArtifact[]
  events: OperationsEvent[]
}

export interface OperationsRunInspection {
  runId: number | string
  alive: boolean
  reason?: null | string
  pid?: null | number
  status?: null | string
  cpuPercent?: null | number
  memoryRssBytes?: null | number
  numThreads?: null | number
}


export interface OperationsTaskSnapshot {
  sourceId: string
  sourceLabel: string
  /** Registry connection that produced this snapshot, when known. */
  connectionId?: null | string
  /** Active/source profile when the producer was read. */
  profile?: null | string
  /** Producer-defined scope key captured with this snapshot (board, workspace, queue, etc.). */
  scopeKey?: null | string
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
  /** Optional read-only execution history. The producer remains authoritative. */
  readTaskExecution?: (
    taskId: string,
    snapshot: OperationsTaskSnapshot
  ) => Promise<OperationsTaskExecution>
  /** Optional live process inspection for an individual run. */
  readRunInspection?: (
    runId: number | string,
    snapshot: OperationsTaskSnapshot
  ) => Promise<OperationsRunInspection>
  /** Optional worker/task log tail. */
  readTaskLog?: (
    taskId: string,
    snapshot: OperationsTaskSnapshot
  ) => Promise<OperationsTaskLog>
  /** Optional deep link into the producer's native UI. */
  openTask?: (taskId: string) => void
}
