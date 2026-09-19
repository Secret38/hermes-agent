import { describe, expect, it } from 'vitest'

import { flattenProjectSessions, projectOperationalTasks } from './project-data'

describe('Hermes OS project projection', () => {
  it('filters operational tasks only by exact project id', () => {
    const snapshots = [
      {
        observedAt: 1,
        projects: [],
        sourceId: 'kanban',
        sourceLabel: 'Kanban',
        tasks: [
          { id: 'a', projectId: 'p_one', status: 'running', title: 'One' },
          { id: 'b', projectId: 'p_two', status: 'done', title: 'Two' },
          { id: 'c', projectName: 'One', status: 'todo', title: 'Name only' }
        ]
      }
    ]

    expect(projectOperationalTasks(snapshots, 'p_one').map(task => task.id)).toEqual(['a'])
  })

  it('deduplicates compressed session lineage and sorts by activity', () => {
    const older = {
      ended_at: null,
      id: 'old-tip',
      _lineage_root_id: 'root-a',
      input_tokens: 1,
      is_active: false,
      last_active: 10,
      message_count: 1,
      model: 'm',
      output_tokens: 1,
      preview: null,
      source: 'desktop',
      started_at: 1,
      title: 'Old',
      tool_call_count: 0
    }
    const newer = {
      ...older,
      id: 'new-tip',
      _lineage_root_id: 'root-a',
      last_active: 30,
      title: 'New'
    }
    const separate = {
      ...older,
      id: 'separate',
      _lineage_root_id: null,
      last_active: 20,
      title: 'Separate'
    }

    const sessions = flattenProjectSessions({
      id: 'p_one',
      label: 'Project',
      path: '/repo',
      repos: [
        {
          id: 'repo',
          label: 'repo',
          path: '/repo',
          sessionCount: 3,
          groups: [
            { id: 'a', label: 'main', path: '/repo', sessions: [older, separate] },
            { id: 'b', label: 'worktree', path: '/repo/wt', sessions: [newer] }
          ]
        }
      ],
      sessionCount: 3
    })

    expect(sessions.map(session => session.id)).toEqual(['separate', 'old-tip'])
  })
})
