import { beforeEach, describe, expect, it, vi } from 'vitest'

const openSession = vi.fn()
const navigate = vi.fn()

vi.mock('@hermes/plugin-sdk', () => ({
  host: { navigate }
}))

vi.mock('@/app/open-session', () => ({
  openSession: (...args: unknown[]) => openSession(...args)
}))

vi.mock('@/store/session-states', () => ({
  storedSessionIdForRuntimeId: () => null
}))

import { openHermesSession, openHermesWorkspaceSession } from './session-navigation'

describe('Hermes OS session navigation', () => {
  beforeEach(() => {
    openSession.mockClear()
    navigate.mockClear()
  })

  it('keeps ordinary session opens stacked', () => {
    openHermesSession('stored-1')

    expect(openSession).toHaveBeenCalledWith(
      'stored-1',
      expect.any(Function),
      'stack',
      { workspaceMode: 'sessions' }
    )
  })

  it('forces workspace launches through the primary workspace', () => {
    const ownerRoute = {
      connectionId: 'remote-a',
      mode: 'remote' as const,
      profile: 'worker',
      targetProfile: 'worker'
    }

    openHermesWorkspaceSession('stored-2', ownerRoute)

    expect(openSession).toHaveBeenCalledWith(
      'stored-2',
      expect.any(Function),
      'main',
      { ownerRoute, workspaceMode: 'sessions' }
    )
  })
})
