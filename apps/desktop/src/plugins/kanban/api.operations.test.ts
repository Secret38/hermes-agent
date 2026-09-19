import { describe, expect, it } from 'vitest'

import type { KanbanTaskDetail } from './types'
import {
  toOperationsRunInspection,
  toOperationsSnapshot,
  toOperationsTaskExecution,
  toOperationsTaskLog
} from './api'

describe('Kanban operations execution projection', () => {
  it('preserves the board scope used to produce an operations snapshot', () => {
    const snapshot = toOperationsSnapshot(
      {
        assignees: [],
        columns: [],
        latest_event_id: 0,
        now: 10,
        tenants: []
      },
      {
        boards: [{ slug: 'alpha', name: 'Alpha' }],
        current: 'alpha'
      },
      [],
      'alpha'
    )

    expect(snapshot.scopeKey).toBe('alpha')
  })


  it('projects task runs, artifacts, workspace, result, and failure fields', () => {
    const detail: KanbanTaskDetail = {
      task: {
        id: 't_1',
        title: 'Build dashboard',
        status: 'done',
        result: 'Shipped',
        last_failure_error: 'previous attempt failed',
        workspace_path: '/work/project',
        branch_name: 'agent/t_1'
      },
      comments: [],
      events: [],
      links: { parents: [], children: [] },
      attachments: [{ id: 7, filename: 'report.json', size: 2048 }],
      runs: [
        {
          id: 10,
          profile: 'coder',
          status: 'failed',
          outcome: 'crashed',
          summary: 'first attempt',
          error: 'worker crashed',
          worker_pid: 111,
          worker_session_id: 'session-a',
          started_at: 100,
          ended_at: 140
        },
        {
          id: 11,
          profile: 'coder',
          status: 'done',
          outcome: 'completed',
          summary: 'finished',
          worker_pid: 222,
          worker_session_id: 'session-b',
          started_at: 200,
          ended_at: 260
        }
      ]
    }

    expect(toOperationsTaskExecution(detail)).toEqual({
      taskId: 't_1',
      result: 'Shipped',
      lastFailureError: 'previous attempt failed',
      workspacePath: '/work/project',
      branchName: 'agent/t_1',
      artifacts: [{ id: 7, name: 'report.json', sizeBytes: 2048 }],
      events: [],
      runs: [
        {
          id: 10,
          status: 'failed',
          outcome: 'crashed',
          profile: 'coder',
          workerSessionId: 'session-a',
          workerPid: 111,
          startedAt: 100,
          endedAt: 140,
          summary: 'first attempt',
          error: 'worker crashed'
        },
        {
          id: 11,
          status: 'done',
          outcome: 'completed',
          profile: 'coder',
          workerSessionId: 'session-b',
          workerPid: 222,
          startedAt: 200,
          endedAt: 260,
          summary: 'finished',
          error: undefined
        }
      ]
    })
  })

  it('projects worker log metadata and content', () => {
    expect(
      toOperationsTaskLog({
        exists: true,
        size_bytes: 4096,
        content: 'worker output',
        truncated: true
      })
    ).toEqual({
      exists: true,
      sizeBytes: 4096,
      content: 'worker output',
      truncated: true
    })
  })

  it('projects live process inspection without inventing health state', () => {
    expect(
      toOperationsRunInspection({
        run_id: 42,
        alive: true,
        pid: 9001,
        status: 'sleeping',
        cpu_percent: 12.5,
        memory_rss_bytes: 1048576,
        num_threads: 8
      })
    ).toEqual({
      runId: 42,
      alive: true,
      reason: undefined,
      pid: 9001,
      status: 'sleeping',
      cpuPercent: 12.5,
      memoryRssBytes: 1048576,
      numThreads: 8
    })
  })
})
