import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

export interface HermesEstopState {
  engaged: boolean
  reason: string | null
  engaged_at: string | null
}

async function readEstop(): Promise<HermesEstopState> {
  return host.request<HermesEstopState>('system.estop.get', {})
}

export function useHermesEstop() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const [revision, setRevision] = useState(0)

  useEffect(
    () =>
      host.onEvent('audit.changed', () => {
        setRevision(value => value + 1)
      }),
    [connectionId]
  )

  const query = useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: readEstop,
    queryKey: ['hermes-os', 'estop', connectionId, revision],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10_000
  })

  const setEngaged = async (engaged: boolean, reason?: string): Promise<HermesEstopState> => {
    const result = await host.request<HermesEstopState>('system.estop.set', {
      engaged,
      ...(reason ? { reason } : {})
    })
    setRevision(value => value + 1)
    return result
  }

  return { ...query, setEngaged }
}
