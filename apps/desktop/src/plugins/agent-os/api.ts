import { type PluginRestOptions, queryClient } from '@hermes/plugin-sdk'

import type {
  AgentOSContextSnapshot,
  AgentOSLiveFrame,
  AgentOSMissionJob,
  AgentOSPendingApproval,
  AgentOSSnapshot
} from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>
type Socket = (path: string, onMessage: (data: unknown) => void) => () => void

let rest: null | Rest = null
let socketClient: null | Socket = null

export const AGENT_OS_SNAPSHOT_KEY = ['agent-os', 'mission-control'] as const
export const AGENT_OS_CONTEXT_KEY = ['agent-os', 'mission-context'] as const
export const AGENT_OS_MISSIONS_KEY = ['agent-os', 'missions'] as const
export const AGENT_OS_APPROVALS_KEY = ['agent-os', 'approvals'] as const

export function bindAgentOSApi(nextRest: Rest, socket: Socket): () => void {
  rest = nextRest
  socketClient = socket

  const close = socket('/events', data => {
    const frame = data as { type?: string } | null

    if (frame?.type === 'ledger.changed') {
      void queryClient.invalidateQueries({ queryKey: AGENT_OS_SNAPSHOT_KEY })
    }
  })

  return () => {
    close()
    rest = null
    if (socketClient === socket) {
      socketClient = null
    }
  }
}

export function subscribeAgentOSLiveFrame(
  taskId: string,
  onFrame: (frame: AgentOSLiveFrame | null) => void
): () => void {
  const client = socketClient
  const expectedTaskId = taskId.trim()

  if (!client || !expectedTaskId) {
    onFrame(null)

    return () => undefined
  }

  return client(`/live-frames?task_id=${encodeURIComponent(expectedTaskId)}`, data => {
    const message = data as {
      frame?: AgentOSLiveFrame
      task_id?: string
      type?: string
    } | null

    if (message?.type === 'live_frame') {
      const frame = message.frame
      if (
        frame?.task_id === expectedTaskId &&
        typeof frame.data_url === 'string' &&
        frame.data_url.startsWith('data:image/')
      ) {
        onFrame(frame)
      }

      return
    }

    if (message?.type === 'live_frame.expired' && message.task_id === expectedTaskId) {
      onFrame(null)
    }
  })
}

export function fetchAgentOSSnapshot(): Promise<AgentOSSnapshot> {
  return rest
    ? rest<AgentOSSnapshot>('/snapshot?limit=60')
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}


export function fetchAgentOSContext(): Promise<AgentOSContextSnapshot> {
  return rest
    ? rest<AgentOSContextSnapshot>('/context')
    : Promise.reject(new Error('Agent OS Mission Control context API is not ready'))
}


export function fetchAgentOSMissions(): Promise<{ jobs: AgentOSMissionJob[] }> {
  return rest
    ? rest<{ jobs: AgentOSMissionJob[] }>('/missions')
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}

export function createAgentOSMission(input: {
  goal: string
  workspace_id?: string
  session_id?: string
}): Promise<{ ok: boolean; job: AgentOSMissionJob }> {
  return rest
    ? rest<{ ok: boolean; job: AgentOSMissionJob }>('/missions', { method: 'POST', body: input })
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}

export function resumeAgentOSMission(jobId: string): Promise<{ ok: boolean; job: AgentOSMissionJob }> {
  return rest
    ? rest<{ ok: boolean; job: AgentOSMissionJob }>(`/missions/${encodeURIComponent(jobId)}/resume`, {
        method: 'POST',
        body: { confirm: true }
      })
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}

export function fetchAgentOSApprovals(): Promise<{ approvals: AgentOSPendingApproval[] }> {
  return rest
    ? rest<{ approvals: AgentOSPendingApproval[] }>('/approvals')
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}

export function resolveAgentOSApproval(
  requestId: string,
  choice: 'allow_once' | 'deny'
): Promise<{ ok: boolean; request_id: string; choice: string }> {
  return rest
    ? rest<{ ok: boolean; request_id: string; choice: string }>(`/approvals/${encodeURIComponent(requestId)}`, {
        method: 'POST',
        body: { choice }
      })
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}
