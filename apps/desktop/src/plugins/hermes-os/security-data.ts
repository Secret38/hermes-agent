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
  browser: {
    class: NetworkClass
    reason: 'user_directed_destinations'
  }
  computer_use: {
    class: NetworkClass
    reason: 'controlled_app_egress_not_observable'
  }
  messaging: {
    class: NetworkClass
    reason: 'no_narrow_runtime_authority'
  }
  updates: {
    class: NetworkClass
    mode: 'on_demand'
  }
}

async function readNetworkSecurity(profile: string): Promise<NetworkSecuritySummary> {
  return host.request<NetworkSecuritySummary>('config.get', {
    key: 'network.security',
    profile
  })
}

export function useNetworkSecurity() {
  const connectionId = useValue(host.state.connectionId)
  const gateway = useValue(host.state.gateway)
  const profile = useValue(host.state.profile) || 'default'

  return useQuery({
    enabled: Boolean(gateway && host.getGateway()),
    queryFn: () => readNetworkSecurity(profile),
    queryKey: ['hermes-os', 'network-security', connectionId, profile],
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 10_000
  })
}
