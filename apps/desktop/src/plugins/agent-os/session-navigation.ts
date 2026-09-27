import { host, type PluginProfileRoute, storedSessionIdForRuntimeId } from '@hermes/plugin-sdk'

export function storedHermesSessionId(sessionId: string): string {
  const id = sessionId.trim()

  return id ? (storedSessionIdForRuntimeId(id) ?? id) : ''
}

function openHermesSessionWithIntent(
  sessionId: string,
  ownerRoute: PluginProfileRoute | undefined,
  intent: 'main' | 'stack'
): void {
  const storedId = storedHermesSessionId(sessionId)

  if (!storedId) {
    return
  }

  void host.openSession(storedId, {
    intent,
    ...(ownerRoute ? { route: ownerRoute } : {}),
    workspaceMode: 'sessions'
  })
}

export function openHermesSession(sessionId: string, ownerRoute?: PluginProfileRoute): void {
  openHermesSessionWithIntent(sessionId, ownerRoute, 'stack')
}

export function openHermesWorkspaceSession(sessionId: string, ownerRoute?: PluginProfileRoute): void {
  openHermesSessionWithIntent(sessionId, ownerRoute, 'main')
}
