import { host, useQuery, useValue } from '@hermes/plugin-sdk'

export interface ComputerUseSecuritySummary {
  permission_mode: 'bounded' | 'standard'
  telemetry_enabled: boolean
  manifest: {
    configured: boolean
    readable: boolean
    version: null | number
    mode_independent: boolean
    required: boolean
  }
}

async function readComputerUseSecurity(profile: string): Promise<ComputerUseSecuritySummary> {
  return host.request<ComputerUseSecuritySummary>('config.get', {
    key: 'computer_use.security',
    profile
  })
}

export function useComputerUseSecurity() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'

  return useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () => readComputerUseSecurity(profile),
    queryKey: ['hermes-os', 'computer-use-security', connectionId, profile],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10_000
  })
}


export interface TelemetrySecuritySummary {
  shared_metrics: {
    collection_enabled: boolean
    transmission_requested: boolean
    transmission_enabled: boolean
    destination: 'blocked' | 'custom_https' | 'loopback' | 'nous'
  }
}

async function readTelemetrySecurity(profile: string): Promise<TelemetrySecuritySummary> {
  return host.request<TelemetrySecuritySummary>('config.get', {
    key: 'telemetry.security',
    profile
  })
}

export function useTelemetrySecurity() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'

  return useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () => readTelemetrySecurity(profile),
    queryKey: ['hermes-os', 'telemetry-security', connectionId, profile],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10_000
  })
}
