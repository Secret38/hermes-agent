import { type PluginRestOptions, queryClient } from '@hermes/plugin-sdk'

import type { AgentOSContextSnapshot, AgentOSMissionJob, AgentOSPendingApproval, AgentOSSnapshot } from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>
type Socket = (path: string, onMessage: (data: unknown) => void) => () => void

let rest: null | Rest = null
let openSocket: null | Socket = null

export const AGENT_OS_SNAPSHOT_KEY = ['agent-os', 'mission-control'] as const
export const AGENT_OS_CONTEXT_KEY = ['agent-os', 'mission-context'] as const
export const AGENT_OS_MISSIONS_KEY = ['agent-os', 'missions'] as const
export const AGENT_OS_APPROVALS_KEY = ['agent-os', 'approvals'] as const

export function bindAgentOSApi(nextRest: Rest, socket: Socket): () => void {
  rest = nextRest
  openSocket = socket

  const close = socket('/events', data => {
    const frame = data as { type?: string } | null

    if (frame?.type === 'ledger.changed') {
      void queryClient.invalidateQueries({ queryKey: AGENT_OS_SNAPSHOT_KEY })
    }
  })

  return () => {
    close()
    openSocket = null
    rest = null
  }
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


export type AgentOSLiveFrameMessage =
  | {
      type: 'runtime.frame'
      task_id: string
      session_id: string
      action_id: string
      mime_type: 'image/jpeg' | 'image/png' | 'image/webp'
      image_b64: string
      width: number | null
      height: number | null
    }
  | { type: 'runtime.frame.expired' | 'runtime.frame.waiting'; task_id: string }

export function subscribeAgentOSLiveFrame(
  taskId: string,
  sessionId: string,
  onFrame: (frame: AgentOSLiveFrameMessage) => void
): () => void {
  const taskKey = taskId.trim()
  const sessionKey = sessionId.trim()
  if (!taskKey || !sessionKey || !openSocket) {
    return () => undefined
  }

  return openSocket(
    `/live/${encodeURIComponent(taskKey)}?session_id=${encodeURIComponent(sessionKey)}`,
    data => onFrame(data as AgentOSLiveFrameMessage)
  )
}
