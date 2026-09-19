import { host } from '@hermes/plugin-sdk'

import { openSession, type OpenSessionIntent } from '@/app/open-session'
import type { SessionProfileRoute } from '@/store/session-request-router'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

export function storedHermesSessionId(sessionId: string): string {
  const id = sessionId.trim()

  return id ? (storedSessionIdForRuntimeId(id) ?? id) : ''
}

function openHermesSessionWithIntent(
  sessionId: string,
  ownerRoute: SessionProfileRoute | undefined,
  intent: OpenSessionIntent
): void {
  const storedId = storedHermesSessionId(sessionId)

  if (!storedId) {
    return
  }

  openSession(storedId, to => host.navigate(to), intent, {
    ...(ownerRoute ? { ownerRoute } : {}),
    workspaceMode: 'sessions'
  })
}

export function openHermesSession(sessionId: string, ownerRoute?: SessionProfileRoute): void {
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
