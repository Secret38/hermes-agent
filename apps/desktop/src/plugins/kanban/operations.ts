// Restored from agent-os-v1-security-convergence; projections preserve producer authority.
import type {
  OperationsCaptureInput, OperationsRunInspection, OperationsTaskExecution,
  OperationsTaskLog, OperationsTaskSnapshot
} from '@hermes/plugin-sdk'

import type { BoardsResponse, KanbanBoard, KanbanProject, KanbanTaskDetail, WorkerLog } from './types'

export function toOperationsTaskExecution(detail: KanbanTaskDetail): OperationsTaskExecution {
  return {
    taskId: detail.task.id,
    result: detail.task.result,
    lastFailureError: detail.task.last_failure_error,
    workspacePath: detail.task.workspace_path,
    branchName: detail.task.branch_name,
    artifacts: (detail.attachments ?? []).map(attachment => ({
      id: attachment.id,
      name: attachment.filename,
      sizeBytes: attachment.size
    })),
    events: detail.events.map(event => ({
      id: event.id,
      kind: event.kind,
      createdAt: event.created_at,
      detail:
        typeof event.payload === 'string'
          ? event.payload
          : event.payload == null
            ? null
            : JSON.stringify(event.payload)
    })),
    runs: detail.runs.map(run => ({
      id: run.id,
      status: run.status,
      outcome: run.outcome,
      profile: run.profile,
      workerSessionId: run.worker_session_id,
      workerPid: run.worker_pid,
      startedAt: run.started_at,
      endedAt: run.ended_at,
      summary: run.summary,
      error: run.error
    }))
  }
}

export function toOperationsRunInspection(inspection: {
  run_id: number | string
  alive: boolean
  reason?: null | string
  pid?: null | number
  status?: null | string
  cpu_percent?: null | number
  memory_rss_bytes?: null | number
  num_threads?: null | number
}): OperationsRunInspection {
  return {
    runId: inspection.run_id,
    alive: inspection.alive,
    reason: inspection.reason,
    pid: inspection.pid,
    status: inspection.status,
    cpuPercent: inspection.cpu_percent,
    memoryRssBytes: inspection.memory_rss_bytes,
    numThreads: inspection.num_threads
  }
}

export function toOperationsTaskLog(log: WorkerLog): OperationsTaskLog {
  return {
    exists: log.exists,
    sizeBytes: log.size_bytes,
    content: log.content,
    truncated: log.truncated
  }
}

export function toOperationsSnapshot(
  board: KanbanBoard,
  boards: BoardsResponse,
  projects: readonly KanbanProject[],
  scopeKey?: null | string
): OperationsTaskSnapshot {
  const current = boards.boards.find(item => item.slug === (scopeKey || boards.current))
  const projectById = new Map(projects.map(project => [project.id, project]))
  const boardProject = current?.project_id ? projectById.get(current.project_id) : undefined

  return {
    sourceId: 'kanban',
    sourceLabel: 'Kanban',
    scopeKey: scopeKey || boards.current || null,
    scopeLabel: current?.name || current?.slug || boards.current || 'Current board',
    observedAt: board.now * 1000,
    projects: projects.map(project => ({
      id: project.id,
      name: project.name,
      slug: project.slug,
      path: project.primary_path
    })),
    tasks: board.columns.flatMap(column =>
      column.tasks.map(task => {
        const project = task.project_id ? projectById.get(task.project_id) : boardProject

        return {
          id: task.id,
          title: task.title,
          status: task.status || column.name,
          assignee: task.assignee,
          priority: task.priority,
          projectId: task.project_id || current?.project_id,
          projectName: project?.name || current?.project_name,
          originSessionId: task.session_id,
          runId: task.current_run_id,
          workerSessionId: task.worker_session_id,
          startedAt: task.current_run_started_at ?? task.started_at,
          lastHeartbeatAt: task.last_heartbeat_at,
          warning: task.warnings
            ? {
                count: task.warnings.count,
                severity: task.warnings.highest_severity,
                kinds: task.warnings.kinds,
                latestAt: task.warnings.latest_at
              }
            : null
        }
      })
    )
  }
}

export function toMissionCaptureTaskBody(input: OperationsCaptureInput): Record<string, unknown> {
  const title = input.title.trim()

  if (!title) {
    throw new Error('A title is required.')
  }

  return {
    title,
    body: input.body?.trim() || undefined,
    triage: true,
    ...(input.projectId ? { project_id: input.projectId } : {})
  }
}
