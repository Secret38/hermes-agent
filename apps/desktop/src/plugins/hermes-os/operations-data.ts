import {
  host,
  OPERATIONS_TASK_SOURCES_AREA,
  type OperationsTaskSnapshot,
  type OperationsTaskSource,
  useContributions,
  useQuery,
  useValue
} from '@hermes/plugin-sdk'

import { activeRunCount } from './selectors'

export function useHermesOperations() {
  const busyBySession = useValue(host.state.busyBySession)
  const gateway = useValue(host.state.gateway)
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
    queryKey: ['hermes-os', 'task-sources', ...sources.map(source => source.id).sort()],
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
  subagent_id: string
  parent_id?: null | string
  depth?: null | number
  goal?: null | string
  delegation_id?: null | string
  model?: null | string
  started_at?: null | number
  status?: null | string
  tool_count?: null | number
  last_tool?: null | string
  accepting_steer?: null | boolean
}

export interface LiveFleetSnapshot {
  sessions: Array<LiveFleetSession & { subagents: LiveFleetSubagent[] }>
}

async function readLiveFleet(): Promise<LiveFleetSnapshot> {
  if (!host.getGateway()) {
    return { sessions: [] }
  }

  const active = await host.request<{ sessions: LiveFleetSession[] }>('session.active_list', {})
  const sessions = await Promise.all(
    (active.sessions ?? []).map(async session => {
      try {
        const children = await host.request<{ subagents?: LiveFleetSubagent[] }>('subagent.list', {
          session_id: session.id
        })

        return { ...session, subagents: children.subagents ?? [] }
      } catch {
        return { ...session, subagents: [] }
      }
    })
  )

  return { sessions }
}

export function useLiveFleet() {
  return useQuery({
    queryFn: readLiveFleet,
    queryKey: ['hermes-os', 'live-fleet'],
    refetchInterval: 4_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 1_000
  })
}
