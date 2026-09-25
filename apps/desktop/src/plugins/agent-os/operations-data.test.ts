import { describe, expect, it } from 'vitest'

import { projectLiveSubagent } from './operations-data'

describe('Agent OS live Fleet projection', () => {
  it('preserves rich event-store subagent metrics without a gateway roster round-trip', () => {
    const projected = projectLiveSubagent({
      id: 'child-1',
      parentId: 'parent-1',
      goal: 'Implement search',
      sessionId: 'stored-child',
      delegationId: 'delegation-1',
      model: 'model-a',
      status: 'running',
      taskCount: 2,
      taskIndex: 1,
      startedAt: 2_000,
      updatedAt: 5_000,
      durationSeconds: 3,
      costUsd: 0.42,
      inputTokens: 120,
      outputTokens: 80,
      toolCount: 4,
      filesRead: ['a.ts'],
      filesWritten: ['b.ts'],
      stream: [],
      currentTool: 'terminal'
    })

    expect(projected).toMatchObject({
      subagent_id: 'child-1',
      parent_id: 'parent-1',
      session_id: 'stored-child',
      delegation_id: 'delegation-1',
      model: 'model-a',
      status: 'running',
      tool_count: 4,
      input_tokens: 120,
      output_tokens: 80,
      cost_usd: 0.42,
      last_tool: 'terminal',
      files_read: ['a.ts'],
      files_written: ['b.ts'],
      started_at: 2,
      updated_at: 5
    })
  })
})
