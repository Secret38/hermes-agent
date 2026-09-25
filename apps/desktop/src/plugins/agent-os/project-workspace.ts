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

function targetStoredId(sessionId: string): string {
  const storedId = storedHermesSessionId(sessionId)

  if (!storedId) {throw new Error('Project workspace session id is unavailable.')}

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

function waitForCondition<T>(target: string, read: () => T | null, timeoutMessage: string): Promise<T> {
  if (resumeFailed(target)) {return Promise.reject(new Error(`Could not resume project session ${target}.`))}
  const immediate = read()

  if (immediate !== null) {return Promise.resolve(immediate)}

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timeout: number | undefined
    const unsubs: Array<() => void> = []

    const finish = (value?: T, error?: Error) => {
      if (settled) {return}
      settled = true

      if (timeout !== undefined) {window.clearTimeout(timeout)}
      unsubs.forEach(unsub => unsub())

      if (error) {reject(error)}
      else {resolve(value as T)}
    }

    const check = () => {
      if (resumeFailed(target)) {
        finish(undefined, new Error(`Could not resume project session ${target}.`))

        return
      }

      const value = read()

      if (value !== null) {finish(value)}
    }

    unsubs.push(
      host.state.selectedStoredSessionId.listen(check),
      $workspaceCwdOwner.listen(check),
      host.state.cwd.listen(check),
      $resumeFailedSessionId.listen(check)
    )
    timeout = window.setTimeout(() => finish(undefined, new Error(timeoutMessage)), WORKSPACE_READY_TIMEOUT_MS)
    check()
  })
}

export async function launchProjectWorkspaceSurface(
  sessionId: string,
  ownerRoute: PluginProfileRoute | undefined,
  surface: ProjectWorkspaceSurface
): Promise<void> {
  const target = targetStoredId(sessionId)
  openHermesWorkspaceSession(target, ownerRoute)

  if (surface === 'chat') {return}

  if (surface === 'browser') {
    await waitForCondition(target, () => (selectedPrimarySession(target) ? target : null), `Timed out opening project session ${target}.`)
    openBrowserTab()

    return
  }

  const cwd = await waitForCondition(
    target,
    () => confirmedWorkspaceCwd(target),
    `Timed out waiting for project session ${target} to publish its workspace.`
  )

  if (surface === 'files') {
    if (!revealDesktopPane('files')) {throw new Error('Hermes Files pane is unavailable.')}

    return
  }

  if (surface === 'changes') {
    revealReview(cwd, 'main')

    return
  }

  if (surface === 'terminal') {
    if (!revealDesktopPane('terminal')) {throw new Error('Hermes Terminal pane is unavailable.')}

    return
  }

  throw new Error(`Unsupported project workspace surface: ${surface}`)
}
