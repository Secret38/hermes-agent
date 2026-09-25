import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

export interface AgentOSAuditEvent {
  id: number
  event: string
  category: string
  session_id: string | null
  request_id: string | null
  subject: string | null
  outcome: string | null
  task_id: string | null
  run_id: number | null
  project_id: string | null
  created_at: number
}

interface AuditListResult {
  events: AgentOSAuditEvent[]
}

async function readAudit(profile: string): Promise<AuditListResult> {
  return host.request<AuditListResult>('audit.list', {
    profile,
    limit: 200
  })
}

export function useAgentOSAudit() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'
  const [revision, setRevision] = useState(0)

  useEffect(
    () =>
      host.onEvent('audit.changed', () => {
        setRevision(value => value + 1)
      }),
    [connectionId, profile]
  )

  return useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () => readAudit(profile),
    queryKey: ['agent-os', 'audit', connectionId, profile, revision],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 30_000
  })
}
