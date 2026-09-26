import { describe, expect, it } from 'vitest'

import type { AgentOSTask } from './types'
import {
  buildExecutionCanvasModel,
  buildKnowledgeCanvasModel,
  buildRuntimeTopologyCanvasModel,
  connectedExecutionNodeIds,
  connectedKnowledgeNodeIds,
  connectedRuntimeTopologyNodeIds,
  fitCanvasZoom
} from './visual-intelligence'

function taskFixture(): AgentOSTask {
  return {
    id: 'task-1',
    goal: 'Ship the feature',
    state: 'RUNNING',
    workspace_id: 'workspace-1',
    created_at: '2026-09-23T12:00:00Z',
    updated_at: '2026-09-23T12:01:00Z',
    plan: {
      id: 'plan-1',
      task_id: 'task-1',
      objective: 'Ship the feature',
      revision: 1,
      state: 'ACTIVE',
      created_at: '2026-09-23T12:00:00Z',
      updated_at: '2026-09-23T12:01:00Z',
      progress: {
        total: 2,
        succeeded: 0,
        running: 1,
        ready: 1,
        blocked: 0,
        failed: 0,
        cancelled: 0
      },
      dependencies: [{ step_id: 'step-2', dependency_step_id: 'step-1' }],
      steps: [
        {
          id: 'step-1',
          plan_id: 'plan-1',
          task_id: 'task-1',
          title: 'Delegate implementation',
          kind: 'AGENT',
          state: 'RUNNING',
          execution_id: 'agent-root',
          priority: 100,
          created_at: '2026-09-23T12:00:00Z',
          updated_at: '2026-09-23T12:01:00Z'
        },
        {
          id: 'step-2',
          plan_id: 'plan-1',
          task_id: 'task-1',
          title: 'Verify implementation',
          kind: 'VERIFICATION',
          state: 'READY',
          priority: 90,
          created_at: '2026-09-23T12:00:00Z',
          updated_at: '2026-09-23T12:01:00Z'
        }
      ]
    },
    agents: [
      {
        id: 'agent-root',
        task_id: 'task-1',
        runtime: 'hermes',
        goal: 'Implement',
        state: 'RUNNING',
        role: 'builder',
        restart_count: 0,
        max_restarts: 2,
        created_at: '2026-09-23T12:00:00Z',
        updated_at: '2026-09-23T12:01:00Z'
      },
      {
        id: 'agent-child',
        task_id: 'task-1',
        runtime: 'hermes',
        goal: 'Inspect tests',
        state: 'RUNNING',
        parent_agent_id: 'agent-root',
        role: 'tester',
        restart_count: 0,
        max_restarts: 2,
        created_at: '2026-09-23T12:00:00Z',
        updated_at: '2026-09-23T12:01:00Z'
      }
    ],
    actions: [
      {
        id: 'action-1',
        task_id: 'task-1',
        agent_id: 'agent-root',
        tool: 'terminal',
        operation: 'run',
        state: 'RUNNING',
        risk_level: 'L1',
        retry_budget: 1,
        verification_required: true,
        verification_method: 'exit-code',
        recovery_attempts: 0,
        execution_attempts: 1,
        created_at: '2026-09-23T12:00:00Z',
        updated_at: '2026-09-23T12:01:00Z'
      }
    ],
    events: [],
    metrics: {
      actions: 1,
      agents: 2,
      recoveries: 0,
      approvals: 0,
      verifications: 1,
      checkpoints: 1
    }
  }
}

describe('Agent OS visual intelligence graph', () => {
  it('builds a truthful goal-to-plan dependency graph', () => {
    const model = buildExecutionCanvasModel(taskFixture())

    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'goal:task-1',
          target: 'step:step-1',
          kind: 'membership'
        }),
        expect.objectContaining({
          source: 'step:step-1',
          target: 'step:step-2',
          kind: 'dependency'
        })
      ])
    )
  })

  it('preserves exact plan-to-agent, delegation and agent-to-action bindings', () => {
    const model = buildExecutionCanvasModel(taskFixture())

    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'step:step-1',
          target: 'agent:agent-root',
          kind: 'execution'
        }),
        expect.objectContaining({
          source: 'agent:agent-root',
          target: 'agent:agent-child',
          kind: 'execution'
        }),
        expect.objectContaining({
          source: 'agent:agent-root',
          target: 'action:action-1',
          kind: 'execution'
        })
      ])
    )

    expect(
      model.edges.some(
        edge =>
          edge.source === 'goal:task-1' &&
          edge.target === 'agent:agent-root' &&
          edge.kind === 'membership'
      )
    ).toBe(false)
  })

  it('routes verification-required actions into durable evidence', () => {
    const model = buildExecutionCanvasModel(taskFixture())

    expect(model.nodes.map(node => node.id)).toEqual(
      expect.arrayContaining(['verify:task-1', 'persist:task-1'])
    )
    expect(model.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'action:action-1',
          target: 'verify:task-1',
          kind: 'verification'
        }),
        expect.objectContaining({
          source: 'verify:task-1',
          target: 'persist:task-1',
          kind: 'verification'
        })
      ])
    )
  })

  it('does not invent an execution edge when a plan execution id has no durable target', () => {
    const task = taskFixture()
    task.plan!.steps[0].execution_id = 'missing-runtime-record'

    const model = buildExecutionCanvasModel(task)

    expect(
      model.edges.some(edge => edge.source === 'step:step-1' && edge.label === 'executes as')
    ).toBe(false)
  })
})

describe('Agent OS semantic knowledge canvas', () => {
  it('renders only real visible memory-to-skill relationships', () => {
    const graph = {
      nodes: [
        { id: 'memory:a:0', label: 'Release lesson', kind: 'memory', memorySource: 'session' },
        { id: 'skill:release', label: 'Release qualification', kind: 'skill', category: 'release', useCount: 4 },
        { id: 'skill:isolated', label: 'Isolated skill', kind: 'skill', category: 'other' }
      ],
      edges: [
        { source: 'memory:a:0', target: 'skill:release' },
        { source: 'memory:missing', target: 'skill:release' }
      ],
      clusters: [],
      memory: [],
      stats: {
        memory_nodes: 1,
        memory_skill_edges: 2,
        learned_skills: 2
      }
    }

    const model = buildKnowledgeCanvasModel(graph)

    expect(model.nodes.map(node => node.id)).toEqual(
      expect.arrayContaining(['memory:a:0', 'skill:release', 'skill:isolated'])
    )
    expect(model.edges).toEqual([{ source: 'memory:a:0', target: 'skill:release' }])
  })

  it('returns only the selected knowledge node and its direct semantic neighbors', () => {
    const model = buildKnowledgeCanvasModel({
      nodes: [
        { id: 'memory:1', label: 'One', kind: 'memory' },
        { id: 'memory:2', label: 'Two', kind: 'memory' },
        { id: 'skill:1', label: 'Skill one', kind: 'skill' },
        { id: 'skill:2', label: 'Skill two', kind: 'skill' }
      ],
      edges: [
        { source: 'memory:1', target: 'skill:1' },
        { source: 'memory:2', target: 'skill:2' }
      ],
      clusters: [],
      memory: [],
      stats: {
        memory_nodes: 2,
        memory_skill_edges: 2,
        learned_skills: 2
      }
    })

    const focused = connectedKnowledgeNodeIds(model, 'memory:1')

    expect(focused).toEqual(new Set(['memory:1', 'skill:1']))
    expect(focused.has('memory:2')).toBe(false)
    expect(focused.has('skill:2')).toBe(false)
  })

  it('prioritizes highly connected knowledge without inventing edges when bounded', () => {
    const graph = {
      nodes: [
        { id: 'memory:1', label: 'One', kind: 'memory' },
        { id: 'memory:2', label: 'Two', kind: 'memory' },
        { id: 'skill:1', label: 'Skill one', kind: 'skill' },
        { id: 'skill:2', label: 'Skill two', kind: 'skill' }
      ],
      edges: [
        { source: 'memory:1', target: 'skill:1' },
        { source: 'memory:1', target: 'skill:2' },
        { source: 'memory:2', target: 'skill:2' }
      ],
      clusters: [],
      memory: [],
      stats: {
        memory_nodes: 2,
        memory_skill_edges: 3,
        learned_skills: 2
      }
    }

    const model = buildKnowledgeCanvasModel(graph, 2)

    expect(model.nodes.map(node => node.id)).toEqual(['memory:1', 'skill:2'])
    expect(model.edges).toEqual([{ source: 'memory:1', target: 'skill:2' }])
  })
})

describe('Agent OS runtime topology canvas', () => {
  it('lays out known runtime edges from the Agent OS core without inventing links', () => {
    const nodes = [
      { id: 'agent-os', kind: 'core', label: 'Agent OS', status: 'PASS' },
      { id: 'browser', kind: 'capability', label: 'Browser', status: 'PASS' },
      { id: 'computer', kind: 'capability', label: 'Computer Use', status: 'WARN' },
      { id: 'orphan', kind: 'tool', label: 'Unlinked tool', status: 'PASS' }
    ]

    const edges = [
      { source: 'agent-os', target: 'browser', relation: 'executes' },
      { source: 'agent-os', target: 'computer', relation: 'executes' },
      { source: 'missing', target: 'orphan', relation: 'invalid' }
    ]

    const model = buildRuntimeTopologyCanvasModel(nodes, edges)

    expect(model.edges).toEqual([
      { source: 'agent-os', target: 'browser', relation: 'executes' },
      { source: 'agent-os', target: 'computer', relation: 'executes' }
    ])
    expect(model.nodes.find(node => node.id === 'agent-os')?.column).toBe(0)
    expect(model.nodes.find(node => node.id === 'browser')?.column).toBe(1)
    expect(model.nodes.find(node => node.id === 'computer')?.column).toBe(1)
    expect(model.nodes.find(node => node.id === 'orphan')?.column).toBe(2)
  })

  it('returns the selected runtime node and direct topology neighbors', () => {
    const model = buildRuntimeTopologyCanvasModel(
      [
        { id: 'agent-os', kind: 'core', label: 'Agent OS', status: 'PASS' },
        { id: 'browser', kind: 'capability', label: 'Browser', status: 'PASS' },
        { id: 'computer', kind: 'capability', label: 'Computer Use', status: 'WARN' },
        { id: 'orphan', kind: 'tool', label: 'Unlinked tool', status: 'PASS' }
      ],
      [
        { source: 'agent-os', target: 'browser', relation: 'executes' },
        { source: 'agent-os', target: 'computer', relation: 'executes' }
      ]
    )

    const focused = connectedRuntimeTopologyNodeIds(model, 'browser')

    expect(focused).toEqual(new Set(['browser', 'agent-os']))
    expect(focused.has('computer')).toBe(false)
    expect(focused.has('orphan')).toBe(false)
  })
})


describe('Agent OS execution viewport helpers', () => {
  it('fits the canvas within the viewport while respecting zoom bounds', () => {
    expect(fitCanvasZoom(1000, 600, 2000, 1200)).toBe(0.55)
    expect(fitCanvasZoom(1200, 800, 600, 300)).toBe(1.4)
    expect(fitCanvasZoom(0, 800, 600, 300)).toBe(1)
  })

  it('returns only the selected execution node and its direct neighbors for focus mode', () => {
    const model = buildExecutionCanvasModel(taskFixture())
    const focused = connectedExecutionNodeIds(model, 'agent:agent-root')

    expect(focused.has('agent:agent-root')).toBe(true)
    expect(focused.has('step:step-1')).toBe(true)
    expect(focused.has('agent:agent-child')).toBe(true)
    expect(focused.has('action:action-1')).toBe(true)
    expect(focused.has('persist:task-1')).toBe(false)
  })
})
