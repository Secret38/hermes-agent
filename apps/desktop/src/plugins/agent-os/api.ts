import { type PluginRestOptions, queryClient } from '@hermes/plugin-sdk'

import type { AgentOSSnapshot } from './types'

type Rest = <T>(path: string, opts?: PluginRestOptions) => Promise<T>
type Socket = (path: string, onMessage: (data: unknown) => void) => () => void

let rest: null | Rest = null

export const AGENT_OS_SNAPSHOT_KEY = ['agent-os', 'mission-control'] as const

export function bindAgentOSApi(nextRest: Rest, socket: Socket): () => void {
  rest = nextRest

  const close = socket('/events', data => {
    const frame = data as { type?: string } | null

    if (frame?.type === 'ledger.changed') {
      void queryClient.invalidateQueries({ queryKey: AGENT_OS_SNAPSHOT_KEY })
    }
  })

  return () => {
    close()
    rest = null
  }
}

export function fetchAgentOSSnapshot(): Promise<AgentOSSnapshot> {
  return rest
    ? rest<AgentOSSnapshot>('/snapshot?limit=60')
    : Promise.reject(new Error('Agent OS Mission Control API is not ready'))
}
