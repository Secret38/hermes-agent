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

/**
 * Bring a session into Hermes' primary workspace rather than a side tile.
 *
 * Workspace-derived panes (Files, Review/Changes, Terminal) are intentionally
 * keyed to the primary selected session and its confirmed cwd owner, so a
 * Project Workspace launcher must take this path before revealing those panes.
 */
export function openHermesWorkspaceSession(sessionId: string, ownerRoute?: SessionProfileRoute): void {
  openHermesSessionWithIntent(sessionId, ownerRoute, 'main')
}
