import type { SessionGoal, SessionInfo } from '@hermes/plugin-sdk'

import { storedHermesSessionId } from './session-navigation'

export interface ProjectGoalProjection {
  goal: SessionGoal
  runtimeSessionId: string
  session: SessionInfo
  storedSessionId: string
}

function sessionMatchesGoalOwner(session: SessionInfo, storedSessionId: string): boolean {
  if (session.id === storedSessionId || session._lineage_root_id === storedSessionId) {
    return true
  }

  return session._lineage_ids?.includes(storedSessionId) === true
}

/**
 * Project goals are a read-only projection of Hermes' live per-session goal
 * store. There is no project-goal database in Desktop, so only goals whose
 * runtime/stored identity resolves onto an authoritative project session are
 * surfaced.
 */
export function projectGoalProjection(
  sessions: readonly SessionInfo[],
  goalsBySession: Readonly<Record<string, SessionGoal>>,
  resolveStoredId: (sessionId: string) => string = storedHermesSessionId
): ProjectGoalProjection[] {
  const latestByLineage = new Map<string, ProjectGoalProjection>()

  for (const [runtimeSessionId, goal] of Object.entries(goalsBySession)) {
    const storedSessionId = resolveStoredId(runtimeSessionId)

    if (!storedSessionId) {
      continue
    }

    const session = sessions.find(candidate => sessionMatchesGoalOwner(candidate, storedSessionId))

    if (!session) {
      continue
    }

    const lineageKey = session._lineage_root_id || session.id
    const current = latestByLineage.get(lineageKey)

    if (!current || goal.updatedAt > current.goal.updatedAt) {
      latestByLineage.set(lineageKey, {
        goal,
        runtimeSessionId,
        session,
        storedSessionId
      })
    }
  }

  return [...latestByLineage.values()].sort((a, b) => b.goal.updatedAt - a.goal.updatedAt)
}
