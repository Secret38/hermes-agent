import { host } from '@hermes/plugin-sdk'

import { openSession } from '@/app/open-session'
import { storedSessionIdForRuntimeId } from '@/store/session-states'

export function openHermesSession(sessionId: string): void {
  const id = sessionId.trim()

  if (!id) {
    return
  }

  const storedId = storedSessionIdForRuntimeId(id) ?? id
  openSession(storedId, to => host.navigate(to), 'stack')
}
