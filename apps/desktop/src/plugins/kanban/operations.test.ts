import { describe, expect, it } from 'vitest'

import { toOperationsSnapshot } from './api'
import type { BoardsResponse, KanbanBoard, KanbanProject } from './types'

describe('Kanban operations projection', () => {
  it('normalizes board tasks and projects without changing Kanban authority', () => {
    const board: KanbanBoard = {
      assignees: ['worker'],
      columns: [
        {
          name: 'running',
          tasks: [
            {
              id: 'task-1',
              title: 'Ship control plane',
              status: 'running',
              assignee: 'worker',
              project_id: 'project-1',
              session_id: 'session-origin',
              warnings: { count: 2, highest_severity: 'warning' },
              started_at: 100,
              last_heartbeat_at: 120
            }
          ]
        }
      ],
      latest_event_id: 4,
      now: 200,
      tenants: []
    }

    const boards: BoardsResponse = {
      current: 'default',
      boards: [
        {
          slug: 'default',
          name: 'Default',
          project_id: 'project-1',
          project_name: 'Hermes OS'
        }
      ]
    }

    const projects: KanbanProject[] = [
      {
        id: 'project-1',
        slug: 'hermes-os',
        name: 'Hermes OS',
        primary_path: '/work/hermes-os'
      }
    ]

    expect(toOperationsSnapshot(board, boards, projects)).toEqual({
      sourceId: 'kanban',
      sourceLabel: 'Kanban',
      scopeLabel: 'Default',
      observedAt: 200000,
      projects: [
        {
          id: 'project-1',
          name: 'Hermes OS',
          slug: 'hermes-os',
          path: '/work/hermes-os'
        }
      ],
      tasks: [
        {
          id: 'task-1',
          title: 'Ship control plane',
          status: 'running',
          assignee: 'worker',
          priority: undefined,
          projectId: 'project-1',
          projectName: 'Hermes OS',
          originSessionId: 'session-origin',
          startedAt: 100,
          lastHeartbeatAt: 120,
          warning: { count: 2, severity: 'warning' }
        }
      ]
    })
  })
})
