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
    ])
    publishLiveSessionSnapshot('conn-b', 'default', [
      { id: 'runtime-b', session_key: 'stored-b', status: 'idle' }
    ])

    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-a', 'default')]?.sessions[0]?.id).toBe('runtime-a')
    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-b', 'default')]?.sessions[0]?.id).toBe('runtime-b')
  })

  it('drops malformed rows rather than publishing ambiguous identity', () => {
    publishLiveSessionSnapshot('conn-a', 'worker', [
      { id: '', session_key: 'stored-a', status: 'working' },
      { id: 'runtime-b', session_key: '', status: 'working' },
      { id: ' runtime-c ', session_key: ' stored-c ', status: 'streaming' }
    ])

    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-a', 'worker')]?.sessions).toEqual([
      { id: 'runtime-c', session_key: 'stored-c', status: 'streaming' }
    ])
  })

  it('clears only the requested scope', () => {
    publishLiveSessionSnapshot('conn-a', 'default', [{ id: 'a', session_key: 'sa' }])
    publishLiveSessionSnapshot('conn-b', 'default', [{ id: 'b', session_key: 'sb' }])

    clearLiveSessionSnapshot('conn-a', 'default')

    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-a', 'default')]).toBeUndefined()
    expect($liveSessionSnapshots.get()[liveSessionScopeKey('conn-b', 'default')]).toBeDefined()
  })
})
