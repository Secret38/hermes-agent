import { atom } from 'nanostores'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const revealDesktopPane = vi.fn()
const openBrowserTab = vi.fn()
const revealReview = vi.fn()
const openHermesWorkspaceSession = vi.fn()

const selected = atom<null | string>(null)
const cwd = atom('')
const owner = atom<null | string>(null)
const resumeFailed = atom<null | string>(null)

vi.mock('@/store/pane-focus', () => ({
  revealDesktopPane: (...args: unknown[]) => revealDesktopPane(...args)
}))

vi.mock('@/store/preview', () => ({
  openBrowserTab: (...args: unknown[]) => openBrowserTab(...args)
}))

vi.mock('@/store/review', () => ({
  revealReview: (...args: unknown[]) => revealReview(...args)
}))

vi.mock('@/store/session', () => ({
  $currentCwd: cwd,
  $resumeFailedSessionId: resumeFailed,
  $selectedStoredSessionId: selected,
  $workspaceCwdOwner: owner
}))

vi.mock('./session-navigation', () => ({
  openHermesWorkspaceSession: (...args: unknown[]) => openHermesWorkspaceSession(...args),
  storedHermesSessionId: (id: string) => id.trim()
}))

import { launchProjectWorkspaceSurface } from './project-workspace'

describe('Hermes OS project workspace launcher', () => {
  beforeEach(() => {
    selected.set(null)
    cwd.set('')
    owner.set(null)
    resumeFailed.set(null)
    revealDesktopPane.mockReset()
    revealDesktopPane.mockReturnValue(true)
    openBrowserTab.mockReset()
    revealReview.mockReset()
    openHermesWorkspaceSession.mockReset()
  })

  it('opens chat in the primary workspace without waiting for cwd', async () => {
    await launchProjectWorkspaceSurface('session-a', undefined, 'chat')

    expect(openHermesWorkspaceSession).toHaveBeenCalledWith('session-a', undefined)
    expect(revealDesktopPane).not.toHaveBeenCalled()
  })

  it('waits for confirmed cwd ownership before revealing Files', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'files')

    selected.set('session-a')
    cwd.set('/workspace/a')

    await Promise.resolve()
    expect(revealDesktopPane).not.toHaveBeenCalled()

    owner.set('session-a')
    await pending

    expect(revealDesktopPane).toHaveBeenCalledWith('files')
  })

  it('scopes Changes to the confirmed session cwd', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'changes')

    selected.set('session-a')
    cwd.set('/workspace/a')
    owner.set('session-a')
    await pending

    expect(revealReview).toHaveBeenCalledWith('/workspace/a', 'main')
  })

  it('waits only for primary selection before opening Browser', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'browser')

    selected.set('session-a')
    await pending

    expect(openBrowserTab).toHaveBeenCalledTimes(1)
    expect(owner.get()).toBeNull()
  })

  it('fails closed when the target resume fails', async () => {
    const pending = launchProjectWorkspaceSurface('session-a', undefined, 'terminal')

    resumeFailed.set('session-a')

    await expect(pending).rejects.toThrow('Could not resume project session session-a.')
    expect(revealDesktopPane).not.toHaveBeenCalledWith('terminal')
  })
})
