import {
  host,
  OPERATIONS_TASK_SOURCES_AREA,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  useContributions,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'
import { useStore } from '@nanostores/react'

import { $subagentsBySession, type SubagentProgress } from '@/store/subagents'

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
    queryKey: ['hermes-os', 'task-sources', connectionId, profile, ...sources.map(source => source.id).sort()],
    refetchInterval: 8_000,
    refetchOnWindowFocus: true,
    staleTime: 2_000
  })

  const routes = useQuery({
    queryKey: ['hermes-os', 'profile-routes'],
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

async function readLiveFleetSessions(): Promise<LiveFleetSession[]> {
  if (!host.getGateway()) {
    return []
  }

  const active = await host.request<{ sessions: LiveFleetSession[] }>('session.active_list', {})

  return active.sessions ?? []
}

export function useLiveFleet() {
  const subagentsBySession = useStore($subagentsBySession)
  const connectionId = useValue(host.state.connectionId)
  const profile = useValue(host.state.profile)
  const query = useQuery({
    queryFn: readLiveFleetSessions,
    queryKey: ['hermes-os', 'live-fleet', connectionId, profile],
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 1_000
  })

  return {
    ...query,
    data: {
      sessions: (query.data ?? []).map(session => ({
        ...session,
        subagents: (subagentsBySession[session.id] ?? []).map(projectLiveSubagent)
      }))
    } satisfies LiveFleetSnapshot
  }
}
