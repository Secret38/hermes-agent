import {
  $resumeFailedSessionId,
  $workspaceCwdOwner,
  host,
  openBrowserTab,
  type PluginProfileRoute,
  revealDesktopPane,
  revealReview
} from '@hermes/plugin-sdk'

import { openHermesWorkspaceSession, storedHermesSessionId } from './session-navigation'

export type ProjectWorkspaceSurface = 'browser' | 'changes' | 'chat' | 'files' | 'terminal'

const WORKSPACE_READY_TIMEOUT_MS = 20_000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Project workspace could not be opened.')
}

function targetStoredId(sessionId: string): string {
  const storedId = storedHermesSessionId(sessionId)

  if (!storedId) {
    throw new Error('Project workspace session id is unavailable.')
  }

  return storedId
}

function selectedPrimarySession(target: string): boolean {
  return host.state.selectedStoredSessionId.get() === target
}

function confirmedWorkspaceCwd(target: string): string | null {
  const cwd = host.state.cwd.get().trim()

  return selectedPrimarySession(target) && $workspaceCwdOwner.get() === target && cwd ? cwd : null
}

function resumeFailed(target: string): boolean {
  return $resumeFailedSessionId.get() === target
}

function waitForCondition<T>(
  target: string,
  read: () => T | null,
  timeoutMessage: string
): Promise<T> {
  if (resumeFailed(target)) {
    return Promise.reject(new Error(`Could not resume project session ${target}.`))
  }

  const immediate = read()

  if (immediate !== null) {
    return Promise.resolve(immediate)
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeout: number | undefined

    const unsubs: Array<() => void> = []

    const finish = (result: { error?: Error; value?: T }) => {
      if (settled) {
        return
      }

      settled = true

      if (timeout !== undefined) {
        window.clearTimeout(timeout)
      }

      for (const unsub of unsubs) {
        unsub()
      }

      if (result.error) {
        reject(result.error)
      } else {
        resolve(result.value as T)
      }
    }

    const check = () => {
      if (resumeFailed(target)) {
        finish({ error: new Error(`Could not resume project session ${target}.`) })
        return
      }

      const value = read()

      if (value !== null) {
        finish({ value })
      }
    }

    unsubs.push(
      host.state.selectedStoredSessionId.listen(check),
      $workspaceCwdOwner.listen(check),
      host.state.cwd.listen(check),
      $resumeFailedSessionId.listen(check)
    )

    timeout = window.setTimeout(() => finish({ error: new Error(timeoutMessage) }), WORKSPACE_READY_TIMEOUT_MS)
    check()
  })
}

export function waitForPrimaryProjectSession(sessionId: string): Promise<string> {
  const target = targetStoredId(sessionId)

  return waitForCondition(
    target,
    () => (selectedPrimarySession(target) ? target : null),
    `Timed out opening project session ${target} in the primary workspace.`
  )
}

export function waitForProjectWorkspaceCwd(sessionId: string): Promise<string> {
  const target = targetStoredId(sessionId)

  return waitForCondition(
    target,
    () => confirmedWorkspaceCwd(target),
    `Timed out waiting for project session ${target} to publish its workspace.`
  )
}

export async function launchProjectWorkspaceSurface(
  sessionId: string,
  ownerRoute: PluginProfileRoute | undefined,
  surface: ProjectWorkspaceSurface
): Promise<void> {
  const target = targetStoredId(sessionId)

  openHermesWorkspaceSession(target, ownerRoute)

  if (surface === 'chat') {
    return
  }

  if (surface === 'browser') {
    await waitForPrimaryProjectSession(target)
    openBrowserTab()
    return
  }

  const cwd = await waitForProjectWorkspaceCwd(target)

  if (surface === 'files') {
    if (!revealDesktopPane('files')) {
      throw new Error('Hermes Files pane is unavailable.')
    }
    return
  }

  if (surface === 'changes') {
    revealReview(cwd, 'main')
    return
  }

  if (surface !== 'terminal') {
    throw new Error(`Unsupported project workspace surface: ${surface}`)
  }

  if (!revealDesktopPane('terminal')) {
    throw new Error('Hermes Terminal pane is unavailable.')
  }
}

export function projectWorkspaceErrorMessage(error: unknown): string {
  return errorText(error)
}
