import { beforeEach, describe, expect, it } from 'vitest'

import {
  $liveSessionSnapshots,
  clearLiveSessionSnapshot,
  liveSessionScopeKey,
  publishLiveSessionSnapshot,
  resetLiveSessionSnapshots
} from './live-sessions'

describe('live session snapshot authority', () => {
  beforeEach(() => resetLiveSessionSnapshots())

  it('isolates identical profile names across connections', () => {
    publishLiveSessionSnapshot('conn-a', 'default', [
      { id: 'runtime-a', session_key: 'stored-a', status: 'working' }
    ], 10)
    publishLiveSessionSnapshot('conn-b', 'default', [
      { id: 'runtime-b', session_key: 'stored-b', status: 'waiting' }
    ], 20)

    const snapshots = $liveSessionSnapshots.get()

    expect(snapshots[liveSessionScopeKey('conn-a', 'default')]).toMatchObject({
      connectionId: 'conn-a',
      profile: 'default',
      updatedAt: 10,
      sessions: [{ id: 'runtime-a', session_key: 'stored-a', status: 'working' }]
    })
    expect(snapshots[liveSessionScopeKey('conn-b', 'default')]).toMatchObject({
      connectionId: 'conn-b',
      profile: 'default',
      updatedAt: 20,
      sessions: [{ id: 'runtime-b', session_key: 'stored-b', status: 'waiting' }]
    })
  })

  it('normalizes ids and drops unusable rows', () => {
    publishLiveSessionSnapshot('conn-a', 'worker', [
      { id: ' runtime-a ', session_key: ' stored-a ', status: 'idle' },
      { id: '', session_key: 'stored-b', status: 'working' },
      { id: 'runtime-c', session_key: '', status: 'working' }
    ])

    expect(
      $liveSessionSnapshots.get()[liveSessionScopeKey('conn-a', 'worker')]?.sessions
    ).toEqual([{ id: 'runtime-a', session_key: 'stored-a', status: 'idle' }])
  })

  it('clears only the requested connection/profile scope', () => {
    publishLiveSessionSnapshot('conn-a', 'default', [{ id: 'a', session_key: 'sa' }])
    publishLiveSessionSnapshot('conn-b', 'default', [{ id: 'b', session_key: 'sb' }])

    clearLiveSessionSnapshot('conn-a', 'default')

    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-a', 'default')]).toBeUndefined()
    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-b', 'default')]).toBeDefined()
  })
})
