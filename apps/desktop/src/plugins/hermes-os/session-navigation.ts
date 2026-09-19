import { host } from '@hermes/plugin-sdk'

import { openSession } from '@/app/open-session'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

export function storedHermesSessionId(sessionId: string): string {
  const id = sessionId.trim()

  return id ? (storedSessionIdForRuntimeId(id) ?? id) : ''
}

export function openHermesSession(sessionId: string): void {
  const storedId = storedHermesSessionId(sessionId)

  if (!storedId) {
    return
  }

  openSession(storedId, to => host.navigate(to), 'stack')
}
