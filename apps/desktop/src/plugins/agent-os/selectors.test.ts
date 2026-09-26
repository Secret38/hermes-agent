import { describe, expect, it } from 'vitest'

import {
  activeRunCount,
  activeRunIds,
  attentionOperationalTasks,
  exactWorkerRoute,
  executionOperationalTasks,
  runningOperationalTasks,
  taskCountForProject,
  uniqueOperationalProjects
} from './selectors'

const snapshots = [
  {
    sourceId: 'kanban',
    sourceLabel: 'Kanban',
    observedAt: 1,
    projects: [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' }
    ],
    tasks: [
      { id: 'a', title: 'Run', status: 'running', projectId: 'p1' },
      { id: 'b', title: 'Blocked', status: 'blocked', projectId: 'p1' },
      { id: 'c', title: 'Review', status: 'review', projectId: 'p2' },
      { id: 'd', title: 'Warn', status: 'todo', projectId: 'p2', warning: { count: 1, severity: 'warning' } },
      { id: 'e', title: 'Done', status: 'done', projectId: 'p1' }
    ]
  }
]

describe('Agent OS selectors', () => {
  it('derives active runs only from authoritative busy session flags', () => {
    const state = {
      idle: false,
      runningA: true,
      runningB: true
    }

    expect(activeRunIds(state)).toEqual(['runningA', 'runningB'])
    expect(activeRunCount(state)).toBe(2)
  })

  it('returns an empty operational set when no Hermes session is mid-turn', () => {
    expect(activeRunIds({ a: false, b: false })).toEqual([])
    expect(activeRunCount({ a: false, b: false })).toBe(0)
  })

  it('orders execution-bearing tasks by newest start time', () => {
    const history = [
      {
        sourceId: 'kanban',
        sourceLabel: 'Kanban',
        observedAt: 1,
        projects: [],
        tasks: [
          { id: 'old', title: 'Old', status: 'done', runId: 1, startedAt: 100 },
          { id: 'none', title: 'None', status: 'todo' },
          { id: 'new', title: 'New', status: 'done', runId: 2, startedAt: 300 }
        ]
      }
    ]

    expect(executionOperationalTasks(history).map(task => task.id)).toEqual(['new', 'old'])
  })

  it('derives running and attention work from producer-authored task state', () => {
    expect(runningOperationalTasks(snapshots).map(task => task.id)).toEqual(['a'])
    expect(attentionOperationalTasks(snapshots).map(task => task.id)).toEqual(['b', 'c', 'd'])
  })

  it('resolves a worker route only when source connection and assignee are unique', () => {
    const task = {
      assignee: 'worker',
      id: 'run-1',
      status: 'running',
      title: 'Run',
      workerSessionId: 'session-1'
    }

    const snapshot = {
      connectionId: 'source-a',
      observedAt: 1,
      projects: [],
      sourceId: 'kanban',
      sourceLabel: 'Kanban',
      tasks: [task]
    }

    const route = {
      connectionId: 'source-a',
      mode: 'remote' as const,
      profile: 'worker',
      targetProfile: 'worker'
    }

    expect(exactWorkerRoute(task, snapshot, [route])).toEqual(route)
    expect(exactWorkerRoute(task, snapshot, [{ ...route, connectionId: 'source-b' }])).toBeNull()
    expect(exactWorkerRoute(task, snapshot, [route, { ...route }])).toBeNull()
  })

  it('deduplicates projects and excludes completed tasks from active project counts', () => {
    expect(uniqueOperationalProjects(snapshots).map(project => project.id)).toEqual(['p1', 'p2'])
    expect(taskCountForProject(snapshots, 'p1')).toBe(2)
  })
})
