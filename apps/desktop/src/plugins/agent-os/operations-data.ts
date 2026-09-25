import {
  $liveSessionSnapshots,
  $subagentsBySession,
  host,
  liveSessionScopeKey,
  type LiveSessionSnapshotItem,
  OPERATIONS_TASK_SOURCES_AREA,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  type SubagentProgress,
  useContributions,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useStore } from '@nanostores/react'

import { activeRunCount } from './selectors'

export function useHermesOperations() {
  const busyBySession = useValue(host.state.busyBySession)
  const gateway = useValue(host.state.gateway)
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const model = useValue(host.state.model)
  const cwd = useValue(host.state.cwd)

  const contributions = useContributions(OPERATIONS_TASK_SOURCES_AREA)

  const sources = contributions
    .map(contribution => contribution.data as OperationsTaskSource | undefined)
    .filter((source): source is OperationsTaskSource => Boolean(source?.id && source.readSnapshot))

  const taskQuery = useQuery({
    enabled: sources.length > 0,
    queryFn: () => Promise.all(sources.map(source => source.readSnapshot())),
    queryKey: ['agent-os', 'task-sources', connectionId, profile, ...sources.map(source => source.id).sort()],
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000
  })

  const routes = useQuery({
    queryKey: ['agent-os', 'profile-routes'],
    queryFn: () => host.profileRoutes(),
    staleTime: 30_000,
    refetchOnWindowFocus: true
  })

  return {
    activeRuns: activeRunCount(busyBySession),
    busyBySession,
    connectionId,
    cwd,
    gateway,
    model,
    profile,
    query: taskQuery,
    routes,
    snapshots: taskQuery.data ?? ([] as OperationsTaskSnapshot[]),
    sources
  }
}

export function sourceForSnapshot(
  sources: readonly OperationsTaskSource[],
  snapshot: OperationsTaskSnapshot
): OperationsTaskSource | undefined {
  return sources.find(source => source.id === snapshot.sourceId)
}


export interface LiveFleetSession {
  current: boolean
  id: string
  last_active: number
  message_count: number
  model: string
  preview: string
  session_key: string
  started_at: number
  status: string
  title: string
}

export interface LiveFleetSubagent {
  accepting_steer?: null | boolean
  cost_usd?: number
  delegation_id?: null | string
  depth?: null | number
  files_read: string[]
  files_written: string[]
  goal?: null | string
  input_tokens?: number
  last_tool?: null | string
  model?: null | string
  output_tokens?: number
  parent_id?: null | string
  session_id?: string
  started_at?: null | number
  status?: null | string
  subagent_id: string
  tool_count?: null | number
  updated_at?: null | number
}

export interface LiveFleetSnapshot {
  sessions: Array<LiveFleetSession & { subagents: LiveFleetSubagent[] }>
}

export function projectLiveSubagent(item: SubagentProgress): LiveFleetSubagent {
  return {
    cost_usd: item.costUsd,
    delegation_id: item.delegationId,
    files_read: item.filesRead,
    files_written: item.filesWritten,
    goal: item.goal,
    input_tokens: item.inputTokens,
    last_tool: item.currentTool,
    model: item.model,
    output_tokens: item.outputTokens,
    parent_id: item.parentId,
    session_id: item.sessionId,
    started_at: item.startedAt / 1000,
    status: item.status,
    subagent_id: item.id,
    tool_count: item.toolCount,
    updated_at: item.updatedAt / 1000
  }
}

export function projectLiveFleetSession(item: LiveSessionSnapshotItem): LiveFleetSession {
  return {
    current: Boolean(item.current),
    id: item.id,
    last_active: item.last_active ?? 0,
    message_count: item.message_count ?? 0,
    model: item.model ?? '',
    preview: item.preview ?? '',
    session_key: item.session_key,
    started_at: item.started_at ?? 0,
    status: item.status ?? 'idle',
    title: item.title ?? ''
  }
}

export function useLiveFleet() {
  const liveSessionSnapshots = useStore($liveSessionSnapshots)
  const subagentsBySession = useStore($subagentsBySession)
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const scopeKey = liveSessionScopeKey(connectionId, profile)
  const snapshot = liveSessionSnapshots[scopeKey]
  const sessions = gateway ? (snapshot?.sessions ?? []) : []

  return {
    data: {
      sessions: sessions.map(item => {
        const session = projectLiveFleetSession(item)

        return {
          ...session,
          subagents: (subagentsBySession[session.id] ?? []).map(projectLiveSubagent)
        }
      })
    } satisfies LiveFleetSnapshot,
    isError: false,
    isLoading: false,
    updatedAt: snapshot?.updatedAt ?? 0
  }
}
