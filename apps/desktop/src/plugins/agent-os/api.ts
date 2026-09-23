import type { PluginRestOptions } from '@hermes/plugin-sdk'

import type { AgentOSSnapshot } from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>

let rest: null | Rest = null

export const AGENT_OS_SNAPSHOT_KEY = ['agent-os', 'mission-control'] as const

export function bindAgentOSApi(next: Rest): () => void {
  rest = next

  return () => {
    rest = null
  }
}

export function fetchAgentOSSnapshot(): Promise<AgentOSSnapshot> {
  return rest
    ? rest<AgentOSSnapshot>('/snapshot?limit=60')
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}
