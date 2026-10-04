import { captureGatewayFileDownload, type PluginRestOptions, queryClient } from '@hermes/plugin-sdk'

import type { AgentOSContextSnapshot, AgentOSMissionJob, AgentOSPendingApproval, AgentOSPlanReview, AgentOSSnapshot } from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>
type Socket = (path: string, onMessage: (data: unknown) => void) => () => void

let rest: null | Rest = null
let openSocket: null | Socket = null

export const AGENT_OS_SNAPSHOT_KEY = ['agent-os', 'mission-control'] as const
export const AGENT_OS_CONTEXT_KEY = ['agent-os', 'mission-context'] as const
export const AGENT_OS_MISSIONS_KEY = ['agent-os', 'missions'] as const
export const AGENT_OS_APPROVALS_KEY = ['agent-os', 'approvals'] as const
export const AGENT_OS_PLAN_REVIEW_KEY = ['agent-os', 'plan-review'] as const

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

export async function fetchAgentOSPlanReview(jobId: string): Promise<AgentOSPlanReview> {
  if (!rest) {throw new Error('Agent OS Mission Control API is not ready')}

  const plan = await rest<AgentOSPlanReview>(`/missions/${encodeURIComponent(jobId)}/plan`)

  // An old or malformed backend response must never become an approvable preview.
  if (!plan || plan.job_id !== jobId || typeof plan.plan_id !== 'string' || !plan.plan_id
    || !Number.isInteger(plan.revision) || plan.revision < 1
    || typeof plan.objective !== 'string' || typeof plan.reviewable !== 'boolean'
    || typeof plan.state !== 'string' || (plan.reviewable && plan.state !== 'DRAFT')
    || (plan.workspace_id !== null && typeof plan.workspace_id !== 'string')
    || !Array.isArray(plan.steps) || !plan.steps.length
    || !plan.steps.every(step => step && typeof step.id === 'string' && step.id
      && typeof step.title === 'string' && typeof step.kind === 'string'
      && step.spec && typeof step.spec === 'object' && !Array.isArray(step.spec)
      && Array.isArray(step.depends_on) && step.depends_on.every(id => typeof id === 'string'))) {
    throw new Error('The saved plan response is incomplete. Reload the plan before deciding.')
  }

  const ids = new Set(plan.steps.map(step => step.id))

  if (ids.size !== plan.steps.length || plan.steps.some(step => step.depends_on.some(id => !ids.has(id)))) {
    throw new Error('The saved plan dependencies are incomplete. Reload the plan before deciding.')
  }

  return plan
}

export async function editAgentOSPlan(
  jobId: string,
  plan: Pick<AgentOSPlanReview, 'plan_id' | 'revision'>,
  steps: Pick<AgentOSPlanReview['steps'][number], 'id' | 'title' | 'spec'>[]
): Promise<AgentOSPlanReview> {
  if (!rest) {throw new Error('Agent OS Mission Control API is not ready')}
  await rest(`/missions/${encodeURIComponent(jobId)}/plan/edit`, {
    method: 'POST', body: { plan_id: plan.plan_id, revision: plan.revision, steps }
  })

  const updated = await fetchAgentOSPlanReview(jobId)

  if (updated.plan_id === plan.plan_id || updated.revision <= plan.revision) {
    throw new Error('The new plan version was not confirmed. Reload before deciding.')
  }

  return updated
}

export function decideAgentOSPlan(
  jobId: string,
  plan: Pick<AgentOSPlanReview, 'plan_id' | 'revision'>,
  choice: 'approve' | 'discard'
): Promise<{ ok: boolean; job: AgentOSMissionJob }> {
  return rest
    ? rest<{ ok: boolean; job: AgentOSMissionJob }>(`/missions/${encodeURIComponent(jobId)}/plan/decision`, {
        method: 'POST',
        body: { plan_id: plan.plan_id, revision: plan.revision, choice }
      })
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

export interface AgentOSFileResult {
  id: string
  task_id: string
  name: string
  path: string
  sha256: string
  bytes: number | null
  verified_at: string
}

export async function fetchAgentOSResults(taskId: string) {
  const request = rest

  if (!request) {throw new Error('Agent OS Mission Control API is not ready')}
  const download = captureGatewayFileDownload()
  const path = `/tasks/${encodeURIComponent(taskId)}/results`
  const data = await request<{ task_id: string; results: AgentOSFileResult[] }>(path)

  if (data.task_id !== taskId || !Array.isArray(data.results)
    || data.results.some(result => result.task_id !== taskId || typeof result.id !== 'string'
      || typeof result.path !== 'string' || typeof result.name !== 'string' || typeof result.sha256 !== 'string')) {
    throw new Error('Invalid mission results response')
  }

  return { ...data, download, preview: (id: string) => request<AgentOSFileResult & { preview: string; truncated: boolean }>(`${path}/${encodeURIComponent(id)}`) }
}
