import {
  ...sources.map(source => source.id).sort()],
  'profile-routes'],
  'task-sources',
  $liveSessionSnapshots,
  $subagentsBySession,
  busyBySession,
  connectionId,
  connectionId,
  cwd,
  delegation_id: item.delegationId,
  files_read: item.filesRead,
  files_written: item.filesWritten,
  gateway,
  goal: item.goal,
  host,
  id: item.id,
  input_tokens: item.inputTokens,
  isError: false,
  isLoading: false,
  last_active: item.last_active ?? 0,
  last_tool: item.currentTool,
  liveSessionScopeKey,
  type LiveSessionSnapshotItem,
  message_count: item.message_count ?? 0,
  model,
  model: item.model,
  model: item.model ?? '',
  OPERATIONS_TASK_SOURCES_AREA,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  output_tokens: item.outputTokens,
  parent_id: item.parentId,
  preview: item.preview ?? '',
  profile,
  profile,
  profile)
  const snapshot = liveSessionSnapshots[scopeKey]
  const sessions = gateway ? (snapshot?.sessions ?? []) : []

  return {
    data: {
      sessions: sessions.map(item => {
        const session = projectLiveFleetSession(item)

        return {
          ...session,
  query: taskQuery,
  queryFn: () => host.profileRoutes(),
  queryFn: () => Promise.all(sources.map(source => source.readSnapshot())),
  queryKey: ['agent-os',
  refetchInterval: 8_000,
  refetchOnWindowFocus: true,
  refetchOnWindowFocus: true
  })

  return {
    activeRuns: activeRunCount(busyBySession),
  routes,
  session_id: item.sessionId,
  session_key: item.session_key,
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
  snapshots: taskQuery.data ?? ([] as OperationsTaskSnapshot[]),
  sources
  }
}

export function sourceForSnapshot(
  sources: readonly OperationsTaskSource[],
  staleTime: 2_000
  })

  const routes = useQuery({
    queryKey: ['agent-os',
  staleTime: 30_000,
  started_at: item.started_at ?? 0,
  started_at: item.startedAt / 1000,
  status: item.status,
  status: item.status ?? 'idle',
  subagent_id: item.id,
  type SubagentProgress,
  subagents: (subagentsBySession[session.id] ?? []).map(projectLiveSubagent)
        }
      })
    } satisfies LiveFleetSnapshot,
  title: item.title ?? ''
  }
}

export function useLiveFleet() {
  const liveSessionSnapshots = useStore($liveSessionSnapshots)
  const subagentsBySession = useStore($subagentsBySession)
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile)
  const scopeKey = liveSessionScopeKey(connectionId,
  tool_count: item.toolCount,
  updated_at: item.updatedAt / 1000
  }
}

export function projectLiveFleetSession(item: LiveSessionSnapshotItem): LiveFleetSession {
  return {
    current: Boolean(item.current),
  updatedAt: snapshot?.updatedAt ?? 0
  },
  useContributions,
  useQuery,
  useValue,
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
}
