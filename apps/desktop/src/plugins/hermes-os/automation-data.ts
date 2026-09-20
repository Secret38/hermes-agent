import { host, useQuery, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'

export interface HermesCronJobSummary {
  enabled?: boolean
  job_id: string
  last_delivery_error?: null | string
  last_error?: null | string
  last_fire_error?: null | string
  last_run_at?: null | string
  last_status?: null | string
  name?: string
  next_run_at?: null | string
  paused_reason?: null | string
  schedule?: string
  state?: null | string
}

interface CronListResult {
  count?: null | number
  error?: null | string
  gateway_running?: null | boolean
  jobs?: HermesCronJobSummary[] | null
  scoped?: null | string
  success?: null | boolean
  warning?: null | string
}

export function useAutomationSummary() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'
  const [revision, setRevision] = useState(0)

  useEffect(
    () =>
      host.onEvent('cron.changed', () => {
        setRevision(value => value + 1)
      }),
    [connectionId, profile]
  )

  const query = useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () =>
      host.request<CronListResult>('cron.manage', {
        action: 'list',
        include_disabled: true,
        profile
      }),
    queryKey: ['hermes-os', 'automations', connectionId, profile, revision],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 15_000
  })

  const jobs = query.data?.jobs ?? []
  const enabled = jobs.filter(job => job.enabled !== false && job.state !== 'paused')
  const failed = jobs.filter(job => {
    const status = (job.last_status || '').toLowerCase()
    return Boolean(job.last_error || job.last_fire_error || job.last_delivery_error || ['error', 'failed'].includes(status))
  })
  const paused = jobs.filter(job => job.enabled === false || job.state === 'paused')

  return {
    ...query,
    enabledCount: enabled.length,
    failed,
    jobs,
    pausedCount: paused.length
  }
}
