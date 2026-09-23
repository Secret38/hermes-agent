import { atom } from 'nanostores'

export type LiveSessionStatus = 'idle' | 'resuming' | 'starting' | 'streaming' | 'waiting' | 'working'

export interface LiveSessionSnapshotItem {
  current?: boolean
  id: string
  last_active?: number
  message_count?: number
  model?: string
  preview?: string
  session_key: string
  started_at?: number
  status?: LiveSessionStatus
  title?: string
}

export interface LiveSessionSnapshot {
  connectionId: null | string
  profile: string
  sessions: LiveSessionSnapshotItem[]
  updatedAt: number
}

export interface LiveSessionStatusResponse {
  sessions?: LiveSessionSnapshotItem[]
}

export const $liveSessionSnapshots = atom<Record<string, LiveSessionSnapshot>>({})

export function liveSessionScopeKey(connectionId: null | string | undefined, profile: null | string | undefined): string {
  return JSON.stringify([connectionId ?? '', String(profile ?? '').trim() || 'default'])
}

export function publishLiveSessionSnapshot(
  connectionId: null | string | undefined,
  profile: null | string | undefined,
  sessions: readonly LiveSessionSnapshotItem[],
  updatedAt = Date.now()
): void {
  const normalizedProfile = String(profile ?? '').trim() || 'default'
  const key = liveSessionScopeKey(connectionId, normalizedProfile)

  $liveSessionSnapshots.set({
    ...$liveSessionSnapshots.get(),
    [key]: {
      connectionId: connectionId ?? null,
      profile: normalizedProfile,
      sessions: sessions
        .filter(session => Boolean(session.id?.trim() && session.session_key?.trim()))
        .map(session => ({
          ...session,
          id: session.id.trim(),
          session_key: session.session_key.trim()
        })),
      updatedAt
    }
  })
}

export function clearLiveSessionSnapshot(
  connectionId: null | string | undefined,
  profile: null | string | undefined
): void {
  const key = liveSessionScopeKey(connectionId, profile)
  const current = $liveSessionSnapshots.get()

  if (!(key in current)) {
    return
  }

  const { [key]: _drop, ...rest } = current
  $liveSessionSnapshots.set(rest)
}

export function resetLiveSessionSnapshots(): void {
  $liveSessionSnapshots.set({})
}
