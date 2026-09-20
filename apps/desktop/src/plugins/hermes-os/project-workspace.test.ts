import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revealDesktopPane: vi.fn(),
  openBrowserTab: vi.fn(),
  revealReview: vi.fn(),
  openHermesWorkspaceSession: vi.fn()
}))

vi.mock('@/store/pane-focus', () => ({
  revealDesktopPane: (...args: unknown[]) => mocks.revealDesktopPane(...args)
}))

vi.mock('@/store/preview', () => ({
  openBrowserTab: (...args: unknown[]) => mocks.openBrowserTab(...args)
}))

vi.mock('@/store/review', () => ({
  revealReview: (...args: unknown[]) => mocks.revealReview(...args)
}))

vi.mock('./session-navigation', () => ({
  openHermesWorkspaceSession: (...args: unknown[]) => mocks.openHermesWorkspaceSession(...args),
  storedHermesSessionId: (id: string) => id.trim()
}))

import {
  $currentCwd as cwd,
  $resumeFailedSessionId as resumeFailed,
  $selectedStoredSessionId as selected,
  $workspaceCwdOwner as owner
} from '@/store/session'

import { launchProjectWorkspaceSurface } from './project-workspace'

describe('Hermes OS project workspace launcher', () => {
  beforeEach(() => {
    selected.set(null)
    cwd.set('')
    owner.set(null)
    resumeFailed.set(null)
    mocks.revealDesktopPane.mockReset()
    mocks.revealDesktopPane.mockReturnValue(true)
    mocks.openBrowserTab.mockReset()
    mocks.revealReview.mockReset()
    mocks.openHermesWorkspaceSession.mockReset()
  })

  it('opens chat in the primary workspace without waiting for cwd', async () => {
    await launchProjectWorkspaceSurface('session-a', undefined, 'chat')

    expect(mocks.openHermesWorkspaceSession).toHaveBeenCalledWith('session-a', undefined)
    expect(mocks.revealDesktopPane).not.toHaveBeenCalled()
  })

  it('waits for confirmed cwd ownership before revealing Files', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'files')

    selected.set('session-a')
    cwd.set('/workspace/a')

    await Promise.resolve()
    expect(mocks.revealDesktopPane).not.toHaveBeenCalled()

    owner.set('session-a')
    await pending

    expect(mocks.revealDesktopPane).toHaveBeenCalledWith('files')
  })

  it('scopes Changes to the confirmed session cwd', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'changes')

    selected.set('session-a')
    cwd.set('/workspace/a')
    owner.set('session-a')
    await pending

    expect(mocks.revealReview).toHaveBeenCalledWith('/workspace/a', 'main')
  })

  it('waits only for primary selection before opening Browser', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'browser')

    selected.set('session-a')
    await pending

    expect(mocks.openBrowserTab).toHaveBeenCalledTimes(1)
    expect(owner.get()).toBeNull()
  })

  it('fails closed when the target resume fails', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'terminal')

    resumeFailed.set('session-a')

    await expect(pending).rejects.toThrow('Could not resume project session session-a.')
    expect(mocks.revealDesktopPane).not.toHaveBeenCalledWith('terminal')
  })
})
