import {
  Button,
  Codicon,
  type OperationsRun,
  type OperationsTask,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  host,
  type PluginProfileRoute,
  useQuery
} from '@hermes/plugin-sdk'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'

import { exactOperationsRoute } from './selectors'
import { openHermesSession } from './session-navigation'

export interface ExecutionInspectorSelection {
  snapshot: OperationsTaskSnapshot
  source: OperationsTaskSource
  task: OperationsTask
}


interface VerificationEvidence {
  canonical_command?: null | string
  command?: null | string
  created_at?: null | string
  exit_code?: null | number
  kind?: null | string
  output_summary?: null | string
  scope?: null | string
  status?: null | string
}

interface VerificationStatusResult {
  verification: {
    status: string
    evidence?: null | VerificationEvidence
    changed_paths?: null | string[]
    root?: null | string
    session_id?: null | string
  }
}

export function formatRunDuration(
  startedAt: null | number | undefined,
  endedAt: null | number | undefined,
  nowSeconds = Date.now() / 1000
): string {
  if (!startedAt) {
    return '—'
  }

  const seconds = Math.max(0, Math.floor((endedAt ?? nowSeconds) - startedAt))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${rest}s`
  }

  return `${rest}s`
}

function formatTimestamp(value: null | number | undefined): string {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium'
  }).format(new Date(value * 1000))
}

function formatBytes(value: null | number | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return '—'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let amount = Math.max(0, value)
  let unit = 0

  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }

  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

function Meta({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">{label}</div>
      <div className="mt-0.5 truncate text-xs text-(--ui-text-secondary)">{value}</div>
    </div>
  )
}

function RunCard({
  routes,
  run,
  snapshot,
  source
}: {
  routes: readonly PluginProfileRoute[]
  run: OperationsRun
  snapshot: OperationsTaskSnapshot
  source: OperationsTaskSource
}) {
  const inspection = useQuery({
    enabled: Boolean(!run.endedAt && source.readRunInspection),
    queryFn: () => source.readRunInspection!(run.id, snapshot),
    queryKey: ['hermes-os', 'run-inspection', source.id, snapshot.scopeKey, String(run.id)],
    refetchInterval: 2_500,
    retry: false,
    staleTime: 1_000
  })

  const workerRoute = exactOperationsRoute(snapshot.connectionId, run.profile, routes)
  const canOpenWorker = Boolean(run.workerSessionId && workerRoute)

  return (
    <article className="border-t border-(--ui-stroke-tertiary) py-3 first:border-t-0">
      <div className="flex min-w-0 items-start gap-3">
        <Codicon
          className="mt-0.5 shrink-0 text-(--ui-text-tertiary)"
          name={run.endedAt ? (run.outcome === 'completed' ? 'pass' : 'history') : 'sync'}
          size="0.85rem"
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-(--ui-text-primary)">Run {String(run.id)}</span>
            <span className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-tertiary)">
              {(run.outcome || run.status || 'unknown').toUpperCase()}
            </span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <Meta label="Profile" value={run.profile || 'unresolved'} />
            <Meta label="Duration" value={formatRunDuration(run.startedAt, run.endedAt)} />
            <Meta label="Started" value={formatTimestamp(run.startedAt)} />
            <Meta label="Ended" value={formatTimestamp(run.endedAt)} />
          </div>

          {!run.endedAt && source.readRunInspection ? (
            <div className="mt-3 rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-secondary) p-2">
              {inspection.isError ? (
                <div className="text-xs text-(--ui-text-tertiary)">Live worker inspection unavailable.</div>
              ) : inspection.data ? (
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                  <Meta label="Process" value={inspection.data.alive ? 'ALIVE' : inspection.data.reason || 'NOT ALIVE'} />
                  <Meta label="CPU" value={inspection.data.cpuPercent == null ? '—' : `${inspection.data.cpuPercent}%`} />
                  <Meta label="RAM" value={formatBytes(inspection.data.memoryRssBytes)} />
                  <Meta
                    label="Threads"
                    value={inspection.data.numThreads == null ? '—' : String(inspection.data.numThreads)}
                  />
                </div>
              ) : (
                <div className="text-xs text-(--ui-text-tertiary)">Reading live worker state…</div>
              )}
            </div>
          ) : null}

          {run.summary ? (
            <div className="mt-3">
              <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Summary</div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-(--ui-text-secondary)">{run.summary}</p>
            </div>
          ) : null}

          {run.error ? (
            <div className="mt-3">
              <div className="text-[0.625rem] uppercase tracking-wide text-(--ui-text-quaternary)">Error</div>
              <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-(--ui-bg-secondary) p-2 text-[0.6875rem] text-(--ui-text-secondary)">
                {run.error}
              </pre>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canOpenWorker ? (
              <Button
                onClick={() => openHermesSession(run.workerSessionId!, workerRoute!)}
                size="sm"
                type="button"
                variant="secondary"
              >
                Open worker session
              </Button>
            ) : null}
            {run.workerPid ? (
              <span className="font-mono text-[0.625rem] text-(--ui-text-quaternary)">pid {run.workerPid}</span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  )
}

function InspectorBody({
  routes,
  selection
}: {
  routes: readonly PluginProfileRoute[]
  selection: ExecutionInspectorSelection
}) {
  const { snapshot, source, task } = selection
  const execution = useQuery({
    enabled: Boolean(source.readTaskExecution),
    queryFn: () => source.readTaskExecution!(task.id, snapshot),
    queryKey: [
      'hermes-os',
      'task-execution',
      source.id,
      task.id,
      snapshot.connectionId,
      snapshot.profile,
      snapshot.scopeKey
    ],
    refetchInterval: task.status === 'running' ? 4_000 : false,
    retry: false,
    staleTime: 1_500
  })

  const log = useQuery({
    enabled: Boolean(source.readTaskLog),
    queryFn: () => source.readTaskLog!(task.id, snapshot),
    queryKey: ['hermes-os', 'task-log', source.id, task.id, snapshot.scopeKey],
    refetchInterval: task.status === 'running' ? 4_000 : false,
    retry: false,
    staleTime: 1_500
  })

  const latestRun = execution.data?.runs.length
    ? execution.data.runs[execution.data.runs.length - 1]
    : undefined
  const verificationProfile = latestRun?.profile || task.assignee || snapshot.profile
  const verificationRoute = exactOperationsRoute(snapshot.connectionId, verificationProfile, routes)
  const verificationSessionId = latestRun?.workerSessionId || task.workerSessionId || task.originSessionId
  const verificationCwd = execution.data?.workspacePath

  const verification = useQuery({
    enabled: Boolean(execution.data && verificationRoute && (verificationSessionId || verificationCwd)),
    queryFn: () =>
      host.requestProfile<VerificationStatusResult>(verificationRoute!, 'verification.status', {
        ...(verificationSessionId ? { session_id: verificationSessionId } : {}),
        ...(verificationCwd ? { cwd: verificationCwd } : {})
      }),
    queryKey: [
      'hermes-os',
      'verification',
      snapshot.connectionId,
      verificationProfile,
      verificationSessionId,
      verificationCwd
    ],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 5_000
  })

  return (
    <>
      <SheetHeader className="border-b border-(--ui-stroke-tertiary) pr-10">
        <SheetTitle>{task.title}</SheetTitle>
        <SheetDescription>
          {source.label} · {task.projectName || snapshot.scopeLabel || 'Unscoped task'} · {task.status.toUpperCase()}
        </SheetDescription>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <section className="grid grid-cols-2 gap-x-4 gap-y-3 py-3">
          <Meta label="Task" value={task.id} />
          <Meta label="Assignee" value={task.assignee || 'unassigned'} />
          <Meta label="Run" value={task.runId == null ? '—' : String(task.runId)} />
          <Meta label="Worker session" value={task.workerSessionId || '—'} />
        </section>

        {source.openTask ? (
          <div className="border-t border-(--ui-stroke-tertiary) py-3">
            <Button onClick={() => source.openTask?.(task.id)} size="sm" type="button" variant="text">
              Open source task
            </Button>
          </div>
        ) : null}

        {execution.isError ? (
          <div className="border-t border-(--ui-stroke-tertiary) py-4 text-xs text-(--ui-text-tertiary)">
            Execution history could not be read from {source.label}.
          </div>
        ) : !execution.data ? (
          <div className="border-t border-(--ui-stroke-tertiary) py-4 text-xs text-(--ui-text-tertiary)">
            Loading execution history…
          </div>
        ) : (
          <>
            {(execution.data.workspacePath || execution.data.branchName) && (
              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Workspace</h3>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  {execution.data.workspacePath ? <Meta label="Path" value={execution.data.workspacePath} /> : null}
                  {execution.data.branchName ? <Meta label="Branch" value={execution.data.branchName} /> : null}
                </div>
              </section>
            )}

            {(execution.data.result || execution.data.lastFailureError) && (
              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Result</h3>
                {execution.data.result ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-(--ui-text-secondary)">
                    {execution.data.result}
                  </p>
                ) : null}
                {execution.data.lastFailureError ? (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-(--ui-bg-secondary) p-2 text-[0.6875rem] text-(--ui-text-secondary)">
                    {execution.data.lastFailureError}
                  </pre>
                ) : null}
              </section>
            )}

            <section className="border-t border-(--ui-stroke-tertiary) py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Verification evidence</h3>
                <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">
                  {!verificationRoute
                    ? 'ROUTE UNKNOWN'
                    : verification.isError
                      ? 'UNAVAILABLE'
                      : verification.data?.verification.status?.toUpperCase() || 'READING'}
                </span>
              </div>
              <p className="mt-1 text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)">
                Hermes verification evidence, not a synthetic quality score. A completed task can still be unverified or
                stale.
              </p>
              {!verificationRoute ? (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">
                  Verification is omitted because no unique owner route can be proven for this task/run.
                </p>
              ) : verification.isError ? (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">
                  This backend could not provide verification evidence for the resolved session/workspace.
                </p>
              ) : verification.data ? (
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  <Meta label="Status" value={verification.data.verification.status.toUpperCase()} />
                  <Meta
                    label="Evidence type"
                    value={verification.data.verification.evidence?.kind || 'no recorded verification command'}
                  />
                  <Meta
                    label="Command"
                    value={
                      verification.data.verification.evidence?.canonical_command ||
                      verification.data.verification.evidence?.command ||
                      '—'
                    }
                  />
                  <Meta
                    label="Exit"
                    value={
                      verification.data.verification.evidence?.exit_code == null
                        ? '—'
                        : String(verification.data.verification.evidence.exit_code)
                    }
                  />
                  {verification.data.verification.changed_paths?.length ? (
                    <Meta
                      label="Changed since verification"
                      value={String(verification.data.verification.changed_paths.length)}
                    />
                  ) : null}
                  {verification.data.verification.evidence?.created_at ? (
                    <Meta label="Recorded" value={verification.data.verification.evidence.created_at} />
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">Reading verification evidence…</p>
              )}
              {verification.data?.verification.evidence?.output_summary ? (
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-(--ui-bg-secondary) p-2 text-[0.6875rem] text-(--ui-text-secondary)">
                  {verification.data.verification.evidence.output_summary}
                </pre>
              ) : null}
            </section>

            <section className="border-t border-(--ui-stroke-tertiary) py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Run history</h3>
                <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">
                  {execution.data.runs.length}
                </span>
              </div>
              {execution.data.runs.length ? (
                <div className="mt-2">
                  {[...execution.data.runs].reverse().map(run => (
                    <RunCard
                      key={String(run.id)}
                      routes={routes}
                      run={run}
                      snapshot={snapshot}
                      source={source}
                    />
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">No run attempts recorded yet.</p>
              )}
            </section>

            <section className="border-t border-(--ui-stroke-tertiary) py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Event chronology</h3>
                <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">
                  {execution.data.events.length}
                </span>
              </div>
              {execution.data.events.length ? (
                <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
                  {[...execution.data.events].reverse().map(event => (
                    <div className="py-2" key={String(event.id)}>
                      <div className="flex min-w-0 items-center gap-3">
                        <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="circle-small-filled" size="0.7rem" />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium text-(--ui-text-secondary)">
                          {event.kind}
                        </span>
                        <span className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                          {formatTimestamp(event.createdAt)}
                        </span>
                      </div>
                      {event.detail ? (
                        <div className="ml-5 mt-1 max-h-24 overflow-auto whitespace-pre-wrap text-[0.6875rem] leading-relaxed text-(--ui-text-tertiary)">
                          {event.detail}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">No task events recorded.</p>
              )}
            </section>

            <section className="border-t border-(--ui-stroke-tertiary) py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-xs font-semibold text-(--ui-text-primary)">Artifacts</h3>
                <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">
                  {execution.data.artifacts.length}
                </span>
              </div>
              {execution.data.artifacts.length ? (
                <div className="mt-2 divide-y divide-(--ui-stroke-tertiary)">
                  {execution.data.artifacts.map(artifact => (
                    <div className="flex min-w-0 items-center gap-3 py-2" key={String(artifact.id)}>
                      <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="file" size="0.8rem" />
                      <span className="min-w-0 flex-1 truncate text-xs text-(--ui-text-secondary)">{artifact.name}</span>
                      <span className="shrink-0 font-mono text-[0.625rem] text-(--ui-text-quaternary)">
                        {formatBytes(artifact.sizeBytes)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-(--ui-text-tertiary)">No task artifacts recorded.</p>
              )}
            </section>

            {source.readTaskLog ? (
              <section className="border-t border-(--ui-stroke-tertiary) py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xs font-semibold text-(--ui-text-primary)">Worker log</h3>
                  {log.data ? (
                    <span className="font-mono text-[0.625rem] text-(--ui-text-tertiary)">
                      {formatBytes(log.data.sizeBytes)}
                      {log.data.truncated ? ' · tail' : ''}
                    </span>
                  ) : null}
                </div>
                {log.isError ? (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">Worker log is unavailable.</p>
                ) : log.data?.exists ? (
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-(--ui-bg-secondary) p-2 font-mono text-[0.6875rem] leading-relaxed text-(--ui-text-secondary)">
                    {log.data.content || '(empty log)'}
                  </pre>
                ) : log.data ? (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">No worker log file recorded.</p>
                ) : (
                  <p className="mt-2 text-xs text-(--ui-text-tertiary)">Loading worker log…</p>
                )}
              </section>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

export function ExecutionInspector({
  onOpenChange,
  open,
  routes,
  selection
}: {
  onOpenChange: (open: boolean) => void
  open: boolean
  routes: readonly PluginProfileRoute[]
  selection: ExecutionInspectorSelection | null
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetContent className="sm:max-w-xl" side="right">
        {selection ? <InspectorBody routes={routes} selection={selection} /> : null}
      </SheetContent>
    </Sheet>
  )
}
