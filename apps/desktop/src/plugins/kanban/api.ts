/**
 * Kanban data layer. Everything goes through `ctx.rest` — the plugin's own
 * `/api/plugins/kanban/*` FastAPI router (`plugins/kanban/dashboard/plugin_api.py`),
 * reused as-is via the desktop's namespace-scoped REST door. No new backend.
 *
 * Fetching, caching, polling, dedupe, and invalidation are React Query's job
 * (the app's standard, via the SDK). This module owns the query keys, the REST
 * calls, and the selected-board atom — every call passes `?board=<slug>` so the
 * desktop's selection never flips the server-wide current-board pointer.
 */

import {
  atom,
  type PluginOs,
  type PluginRestOptions,
  type OperationsRunInspection,
  type OperationsTaskExecution,
  type OperationsTaskLog,
  type OperationsTaskSnapshot,
  type PluginStorage,
  type PluginTranslate,
  queryClient
} from '@hermes/plugin-sdk'

// Native completion notification.
import { bindCompletionNotify, type CompletionEvent, onKanbanEventsFrame } from './completion-notify'
import type {
  BoardExportResult,
  BoardImportResult,
  BoardMeta,
  BoardsResponse,
  KanbanBoard,
  KanbanProfile,
  KanbanProject,
  KanbanTask,
  KanbanTaskDetail,
  OrchestrationSettings,
  TaskEstimate,
  WorkerLog
} from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>
type Socket = (path: string, onMessage: (data: unknown) => void) => () => void

let rest: null | Rest = null
let os: null | PluginOs = null

/** Selected board slug ('' = the server's current board). Persisted. */
export const $boardSlug = atom<string>('')

/** Whether the "how this board works" intro was dismissed. Persisted. */
export const $introDismissed = atom<boolean>(false)

/** Sub-group the Running lane by assignee (the dashboard's "lanes by
 *  profile"). Persisted. */
export const $lanesByProfile = atom<boolean>(false)

/** Per-lane collapse OVERRIDES (true=collapsed, false=expanded). Absence means
 *  auto: empty lanes collapse to a rail, occupied lanes expand. Persisted. */
export const $collapsedLanes = atom<Record<string, boolean>>({})

const BOARD_SLUG_KEY = 'boardSlug'
const INTRO_KEY = 'introDismissed'
const LANES_KEY = 'lanesByProfile'
const COLLAPSED_KEY = 'collapsedLanes'

/** One live `task_events` frame → precise cache invalidation: the board, plus
 *  each touched task's detail. The polls (8s board / 4s drawer) stay as the
 *  fallback — the socket just makes the board feel instant. */
function onEventsFrame(slug: string, data: unknown): void {
  const events = (data as { events?: CompletionEvent[] })?.events

  if (!events?.length) {
    return
  }

  void queryClient.invalidateQueries({ queryKey: ['kanban', 'board'] })
  // Any event can change a board's card count — keep the switcher badge honest.
  void queryClient.invalidateQueries({ queryKey: BOARDS_KEY })

  for (const taskId of new Set(events.map(event => event.task_id).filter(Boolean))) {
    void queryClient.invalidateQueries({ queryKey: taskKey(slug, taskId!) })
  }

  // Completion notification (after invalidation so notify failure
  // never interferes with cache invalidation).
  void onKanbanEventsFrame(slug, events).catch(() => undefined)
}

// A persisted, subscribable atom (the structural slice we need — avoids
// importing nanostore's type just to describe one).
interface Persisted<T> {
  get(): T
  set(value: T): void
  listen(cb: (value: T) => void): () => void
}

/** Bind the plugin's doors at register time and return a disposer the host
 *  runs on unload/disable — so nothing (store sync, socket) survives a toggle
 *  or duplicates on re-enable. The events socket is pinned to a board at
 *  handshake, so a board switch closes + reopens it. */
export function bindApi(
  r: Rest,
  storage: PluginStorage,
  socket: Socket,
  notifyDoors?: { os?: PluginOs; t?: PluginTranslate }
): () => void {
  rest = r
  os = notifyDoors?.os ?? null
  bindCompletionNotify(r, notifyDoors?.t, notifyDoors?.os)
  const unsubs: Array<() => void> = []

  // Hydrate an atom from storage and keep storage in sync with it.
  const persist = <T>(atom: Persisted<T>, key: string, fallback: T) => {
    atom.set(storage.get(key, fallback))
    unsubs.push(atom.listen(value => storage.set(key, value)))
  }

  persist($boardSlug, BOARD_SLUG_KEY, '')
  persist($introDismissed, INTRO_KEY, false)
  persist($lanesByProfile, LANES_KEY, false)
  persist($collapsedLanes, COLLAPSED_KEY, {})

  let close: (() => void) | null = null

  const open = (slug: string) => {
    close?.()
    close = socket(slug ? `/events?board=${encodeURIComponent(slug)}` : '/events', data => onEventsFrame(slug, data))
  }

  open($boardSlug.get())
  unsubs.push($boardSlug.listen(open))

  return () => {
    unsubs.forEach(unsub => unsub())
    close?.()
    rest = null
    os = null
  }
}

/** The plugin's OS door, for components too deep to be handed `ctx`. Null
 *  before `bindApi` and after unload. */
export const pluginOs = (): null | PluginOs => os

function call<T>(path: string, opts?: PluginRestOptions): Promise<T> {
  return rest ? rest<T>(path, opts) : Promise.reject(new Error('kanban api not ready'))
}

/** Append the selected board (and other params) to a path. */
function withBoardScope(path: string, slug: null | string | undefined, params: Record<string, string> = {}): string {
  const search = new URLSearchParams(params)

  if (slug) {
    search.set('board', slug)
  }

  const qs = search.toString()

  return qs ? `${path}?${qs}` : path
}

function withBoard(path: string, params: Record<string, string> = {}): string {
  return withBoardScope(path, $boardSlug.get(), params)
}

// ── query keys (all board-scoped so switching boards is a clean cache miss) ──

export const boardKey = (slug: string, archived: boolean) => ['kanban', 'board', slug, archived] as const
export const taskKey = (slug: string, id: string) => ['kanban', 'task', slug, id] as const
export const logKey = (slug: string, id: string) => ['kanban', 'log', slug, id] as const
export const BOARDS_KEY = ['kanban', 'boards'] as const
export const PROFILES_KEY = ['kanban', 'profiles'] as const
export const PROJECTS_KEY = ['kanban', 'projects'] as const
export const ORCHESTRATION_KEY = ['kanban', 'orchestration'] as const

// ── reads ─────────────────────────────────────────────────────────────────────

export const fetchBoard = (archived: boolean) =>
  call<KanbanBoard>(withBoard('/board', archived ? { include_archived: 'true' } : {}))

export const fetchTask = (id: string) => call<KanbanTaskDetail>(withBoard(`/tasks/${id}`))
const fetchTaskInScope = (id: string, scopeKey?: null | string) =>
  call<KanbanTaskDetail>(withBoardScope(`/tasks/${id}`, scopeKey))

export const fetchRunInspection = (id: number | string) =>
  call<{
    run_id: number | string
    alive: boolean
    reason?: null | string
    pid?: null | number
    status?: null | string
    cpu_percent?: null | number
    memory_rss_bytes?: null | number
    num_threads?: null | number
  }>(withBoard(`/runs/${id}/inspect`))

const fetchRunInspectionInScope = (id: number | string, scopeKey?: null | string) =>
  call<{
    run_id: number | string
    alive: boolean
    reason?: null | string
    pid?: null | number
    status?: null | string
    cpu_percent?: null | number
    memory_rss_bytes?: null | number
    num_threads?: null | number
  }>(withBoardScope(`/runs/${id}/inspect`, scopeKey))

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

export async function fetchOperationsTaskExecution(
  id: string,
  snapshot: OperationsTaskSnapshot
): Promise<OperationsTaskExecution> {
  return toOperationsTaskExecution(await fetchTaskInScope(id, snapshot.scopeKey))
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

export async function fetchOperationsRunInspection(
  id: number | string,
  snapshot: OperationsTaskSnapshot
): Promise<OperationsRunInspection> {
  return toOperationsRunInspection(await fetchRunInspectionInScope(id, snapshot.scopeKey))
}

export function toOperationsTaskLog(log: WorkerLog): OperationsTaskLog {
  return {
    exists: log.exists,
    sizeBytes: log.size_bytes,
    content: log.content,
    truncated: log.truncated
  }
}

export async function fetchOperationsTaskLog(
  id: string,
  snapshot: OperationsTaskSnapshot
): Promise<OperationsTaskLog> {
  return toOperationsTaskLog(await fetchLogInScope(id, snapshot.scopeKey))
}

/** Worker stdout/stderr tail (last 16 KiB — plenty for the drawer). */
export const fetchLog = (id: string) => call<WorkerLog>(withBoard(`/tasks/${id}/log`, { tail: '16384' }))
const fetchLogInScope = (id: string, scopeKey?: null | string) =>
  call<WorkerLog>(withBoardScope(`/tasks/${id}/log`, scopeKey, { tail: '16384' }))

export const fetchBoards = () => call<BoardsResponse>('/boards')

export const fetchProfiles = () => call<{ profiles: KanbanProfile[] }>('/profiles')

/** First-class Hermes projects, for scoping a board's default workspace. */
export const fetchProjects = () => call<{ projects: KanbanProject[] }>('/projects')

export const fetchOrchestration = () => call<OrchestrationSettings>('/orchestration')

/** Read-only normalized projection for Mission Control and other operations
 * surfaces. Kanban remains authoritative for persistence and workflow rules. */
export function toOperationsSnapshot(
  board: KanbanBoard,
  boards: BoardsResponse,
  projects: readonly KanbanProject[],
  scopeKey?: null | string
): OperationsTaskSnapshot {
  const current = boards.boards.find(item => item.slug === boards.current)
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
          startedAt: task.started_at,
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

export async function fetchOperationsSnapshot(): Promise<OperationsTaskSnapshot> {
  const scopeKey = $boardSlug.get()
  const [board, boards, projects] = await Promise.all([fetchBoard(false), fetchBoards(), fetchProjects()])

  return toOperationsSnapshot(board, boards, projects.projects, scopeKey || boards.current)
}

// ── writes ────────────────────────────────────────────────────────────────────

// Every board edit nudges the dispatcher (debounced, fire-and-forget) so the
// change takes effect NOW instead of on the next 60s tick — create a ready
// task and the worker spawns immediately, no manual "nudge" ritual. The tick
// is lock-guarded and ~1ms when there's nothing to do, so over-nudging is
// free; failures are non-events (the periodic tick still exists).
let nudgeTimer: null | ReturnType<typeof setTimeout> = null

function autoNudge(): void {
  if (nudgeTimer != null) {
    clearTimeout(nudgeTimer)
  }

  nudgeTimer = setTimeout(() => {
    nudgeTimer = null
    nudgeDispatcher().catch(() => undefined)
  }, 400)
}

/** Resolve the write, then kick the dispatcher. Rejections pass through. */
function nudged<T>(write: Promise<T>): Promise<T> {
  return write.then(value => {
    autoNudge()

    return value
  })
}

export const patchTask = (id: string, patch: Record<string, unknown>) =>
  nudged(call(withBoard(`/tasks/${id}`), { method: 'PATCH', body: patch }))

export const createTask = (body: Record<string, unknown>) =>
  nudged(call<{ task: KanbanTask | null; warning?: string }>(withBoard('/tasks'), { method: 'POST', body }))

// Deleting can unblock dependants (a gone parent no longer gates), so it
// nudges too.
export const deleteTask = (id: string) => nudged(call(withBoard(`/tasks/${id}`), { method: 'DELETE' }))

/** One patch, many ids — independent per-id application; returns per-id
 *  outcomes so the UI can toast partial failures. */
export const bulkTasks = (ids: string[], patch: Record<string, unknown>) =>
  nudged(
    call<{ results: Array<{ id: string; ok: boolean; error?: string }> }>(withBoard('/tasks/bulk'), {
      method: 'POST',
      body: { ids, ...patch }
    })
  )

export const addComment = (id: string, body: string) =>
  call(withBoard(`/tasks/${id}/comments`), { method: 'POST', body: { author: 'desktop', body } })

export const reassignTask = (id: string, profile: string) =>
  nudged(call(withBoard(`/tasks/${id}/reassign`), { method: 'POST', body: { profile, reclaim_first: true } }))

export const reclaimTask = (id: string) => nudged(call(withBoard(`/tasks/${id}/reclaim`), { method: 'POST', body: {} }))

export const uploadAttachment = (id: string, upload: { filename: string; contentType?: string; bytes: ArrayBuffer }) =>
  call(withBoard(`/tasks/${id}/attachments`), { method: 'POST', upload })

export const createBoard = (slug: string, name: string, projectId?: string) =>
  call<{ board: { slug: string } }>('/boards', {
    method: 'POST',
    body: { slug, name, ...(projectId ? { project_id: projectId } : {}) }
  })

/** Rough auxiliary-model estimate for a task (tokens + complexity). Makes a
 *  model call — gate behind an explicit user action + disclaimer. */
export const estimateTask = (id: string) =>
  call<TaskEstimate>(withBoard(`/tasks/${id}/estimate`), { method: 'POST', body: {} })

/** Estimate from typed title/body before a task exists (create dialog). */
export const estimateNew = (title: string, body: string) =>
  call<TaskEstimate>('/estimate', { method: 'POST', body: { title, body: body || undefined } })

/** Edit a board's display metadata + default project directory. Pass
 *  `default_workdir: ''` to clear it. Slug is immutable. */
export const updateBoard = (slug: string, patch: Record<string, unknown>) =>
  call<{ board: BoardMeta }>(`/boards/${encodeURIComponent(slug)}`, { method: 'PATCH', body: patch })

/** Archive a board to `boards/_archived/` — recoverable, and the backend
 *  refuses to touch `default`. (`?delete=true` hard-deletes; no caller yet.) */
export const deleteBoard = (slug: string) =>
  call<{ result: { action: string; new_path: string }; current: string }>(`/boards/${encodeURIComponent(slug)}`, {
    method: 'DELETE'
  })

// Board transfer exchanges filesystem paths, not bytes — the picker runs on
// the machine hosting the backend, so the backend reads and writes the file.

export const exportBoard = (slug: string, output: string) =>
  call<BoardExportResult>(`/boards/${encodeURIComponent(slug)}/export`, { method: 'POST', body: { output } })

export const importBoard = (archive: string) =>
  call<BoardImportResult>('/boards/import', { method: 'POST', body: { archive } })

export const nudgeDispatcher = () => call<{ spawned?: unknown[] }>(withBoard('/dispatch'), { method: 'POST', body: {} })

export const saveOrchestration = (patch: Record<string, unknown>) =>
  call<OrchestrationSettings>('/orchestration', { method: 'PUT', body: patch })

export const saveProfileDescription = (name: string, description: string) =>
  call(`/profiles/${encodeURIComponent(name)}`, { method: 'PATCH', body: { description } })

export const autoDescribeProfile = (name: string) =>
  call<{ ok: boolean; reason?: null | string; description?: null | string }>(
    `/profiles/${encodeURIComponent(name)}/describe-auto`,
    { method: 'POST', body: { overwrite: true } }
  )
