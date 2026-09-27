/**
 * Read-only operational task-source contract.
 *
 * This is intentionally narrow: a producer keeps ownership of persistence,
 * writes, workflow rules, and rich detail UI. Consumers (Mission Control,
 * observability surfaces) get a normalized snapshot only.
 */
export const OPERATIONS_TASK_SOURCES_AREA = 'operations.taskSources'

/**
 * Narrow write capability for Mission Control intake.
 *
 * This is deliberately separate from the read-only task-source contract:
 * the producer remains the sole write authority and decides where/how the
 * captured intent is persisted. Consumers may only ask it to capture an
 * intent into a non-executing intake state.
 */
export const OPERATIONS_CAPTURE_SOURCES_AREA = 'operations.captureSources'

export interface OperationsCaptureInput {
  title: string
  body?: null | string
  /** Exact Hermes Project id. Never infer project membership from path/name. */
  projectId?: null | string
}

export interface OperationsCaptureResult {
  sourceId: string
  taskId: string
  status: string
  /** Producer-owned opaque scope captured with the write (board/queue/etc.). */
  scopeKey?: null | string
  warning?: null | string
}

export interface OperationsShapeResult {
  taskId: string
  ok: boolean
  reason?: null | string
  fanout: boolean
  childIds: string[]
  title?: null | string
}

export interface OperationsPlanApprovalResult {
  taskId: string
  ok: boolean
  promotedIds: string[]
  heldIds: string[]
}

export interface OperationsCaptureSource {
  id: string
  label: string
  capture: (input: OperationsCaptureInput) => Promise<OperationsCaptureResult>
  /**
   * Optional source-owned shaping step. It must remain non-executing: producing
   * a plan may persist tasks, but may not promote them into executable lanes.
   */
  shapeCaptured?: (captured: OperationsCaptureResult) => Promise<OperationsShapeResult>
  /** Approve a shaped plan through the producer's own dependency/policy rules. */
  approveCapturedPlan?: (captured: OperationsCaptureResult) => Promise<OperationsPlanApprovalResult>
  /** Optional producer-owned navigation to the captured item. */
  openCapturedTask?: (taskId: string) => void
}

export interface OperationsTaskWarning {
  count: number
  severity?: null | string
  /** Producer-authored diagnostic kinds with occurrence counts. */
  kinds?: Readonly<Record<string, number>>
  latestAt?: null | number
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
