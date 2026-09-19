import { describe, expect, it } from 'vitest'

import type { SessionInfo } from '@/hermes'
import type { SessionGoal } from '@/store/goals'

import { projectGoalProjection } from './project-plan'

function session(id: string, lineageRoot?: string, lineageIds?: string[]): SessionInfo {
  return {
    ended_at: null,
    id,
    _lineage_root_id: lineageRoot ?? null,
    _lineage_ids: lineageIds ?? null,
    input_tokens: 0,
    is_active: false,
    last_active: 1,
    message_count: 0,
    model: null,
    output_tokens: 0,
    preview: null,
    source: 'desktop',
    started_at: 1,
    title: id,
    tool_call_count: 0
  }
}

describe('Hermes OS project goal projection', () => {
  it('only surfaces goals whose resolved stored session belongs to the project', () => {
    const goals: Record<string, SessionGoal> = {
      'runtime-project': { status: 'active', title: 'Ship project', updatedAt: 20 },
      'runtime-other': { status: 'waiting', title: 'Other work', updatedAt: 30 }
    }

    const projected = projectGoalProjection(
      [session('stored-project')],
      goals,
      runtime => ({
        'runtime-project': 'stored-project',
        'runtime-other': 'stored-other'
      })[runtime] ?? ''
    )

    expect(projected.map(item => item.goal.title)).toEqual(['Ship project'])
  })

  it('matches a goal owner against a compression lineage', () => {
    const projected = projectGoalProjection(
      [session('tip-3', 'root-1', ['root-1', 'tip-2', 'tip-3'])],
      {
        runtime: { status: 'active', title: 'Continue migration', updatedAt: 40 }
      },
      () => 'tip-2'
    )

    expect(projected[0]?.session.id).toBe('tip-3')
    expect(projected[0]?.storedSessionId).toBe('tip-2')
  })

  it('keeps only the newest goal for one compression lineage', () => {
    const projectSession = session('tip-3', 'root-1', ['root-1', 'tip-2', 'tip-3'])
    const projected = projectGoalProjection(
      [projectSession],
      {
        oldRuntime: { status: 'paused', title: 'Old goal', updatedAt: 10 },
        currentRuntime: { status: 'active', title: 'Current goal', updatedAt: 50 }
      },
      runtime => (runtime === 'oldRuntime' ? 'tip-2' : 'tip-3')
    )

    expect(projected).toHaveLength(1)
    expect(projected[0]?.goal.title).toBe('Current goal')
  })
})
