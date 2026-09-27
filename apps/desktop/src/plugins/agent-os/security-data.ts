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

export interface TelemetrySecuritySummary {
  shared_metrics: {
    collection_enabled: boolean
    transmission_requested: boolean
    transmission_enabled: boolean
    destination: 'blocked' | 'custom_https' | 'loopback' | 'nous'
  }
}

export type NetworkClass = 'disabled' | 'external' | 'loopback' | 'process' | 'unknown'

export interface NetworkSecuritySummary {
  coverage: 'partial'
  model_provider: {
    class: NetworkClass
    provider: string
    model_configured: boolean
    coverage: 'effective_startup_route'
    subprocess_may_egress: boolean
  }
  mcp: {
    configured: number
    enabled: number
    classes: Record<NetworkClass, number>
    subprocess_may_egress: boolean
  }
  telemetry: {
    class: NetworkClass
    transmission_enabled: boolean
  }
  browser: { class: NetworkClass; reason: string }
  computer_use: { class: NetworkClass; reason: string }
  messaging: { class: NetworkClass; reason: string }
  updates: { class: NetworkClass; mode: 'on_demand' }
}

function useSecurityQuery<T>(key: string) {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'

  return useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () => host.request<T>('config.get', { key, profile }),
    queryKey: ['agent-os', 'security', key, connectionId, profile],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10_000
  })
}

export function useComputerUseSecurity() {
  return useSecurityQuery<ComputerUseSecuritySummary>('computer_use.security')
}

export function useTelemetrySecurity() {
  return useSecurityQuery<TelemetrySecuritySummary>('telemetry.security')
}

export function useNetworkSecurity() {
  return useSecurityQuery<NetworkSecuritySummary>('network.security')
}
