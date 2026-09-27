import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type AgentOSLiveFrameMessage,
  bindAgentOSApi,
  subscribeAgentOSLiveFrame
} from './api'

describe('Agent OS live frame subscription', () => {
  let dispose: undefined | (() => void)
  const rest = async <T>() => ({} as T)

  afterEach(() => {
    dispose?.()
    dispose = undefined
  })

  it('opens an exact task and session scoped socket only after API binding', () => {
    const calls: Array<{ path: string; onMessage: (data: unknown) => void }> = []
    const closed: string[] = []
    const socket = vi.fn((path: string, onMessage: (data: unknown) => void) => {
      calls.push({ path, onMessage })
      return () => closed.push(path)
    })
    dispose = bindAgentOSApi(rest, socket)

    const seen: AgentOSLiveFrameMessage[] = []
    const closeLive = subscribeAgentOSLiveFrame(
      'task / one',
      'session / one',
      frame => seen.push(frame)
    )

    expect(calls.map(call => call.path)).toEqual([
      '/events',
      '/live/task%20%2F%20one?session_id=session%20%2F%20one'
    ])

    calls[1].onMessage({
      type: 'runtime.frame.waiting',
      task_id: 'task / one'
    })
    expect(seen).toEqual([
      { type: 'runtime.frame.waiting', task_id: 'task / one' }
    ])

    closeLive()
    expect(closed).toContain('/live/task%20%2F%20one?session_id=session%20%2F%20one')
  })

  it('does not open a live socket without both identities', () => {
    const socket = vi.fn(() => () => undefined)
    dispose = bindAgentOSApi(rest, socket)

    subscribeAgentOSLiveFrame('task', '', vi.fn())
    expect(socket).toHaveBeenCalledTimes(1)
    expect(socket).toHaveBeenCalledWith('/events', expect.any(Function))
  })

  it('stops opening live sockets after API disposal', () => {
    const socket = vi.fn(() => () => undefined)
    dispose = bindAgentOSApi(rest, socket)
    dispose()
    dispose = undefined

    subscribeAgentOSLiveFrame('task', 'session', vi.fn())
    expect(socket).toHaveBeenCalledTimes(1)
  })
})
