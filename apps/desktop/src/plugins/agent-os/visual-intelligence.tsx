import { cn, Codicon } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import type {
  AgentOSAction,
  AgentOSAgent,
  AgentOSLearningGraph,
  AgentOSLearningNode,
  AgentOSPlan,
  AgentOSPlanStep,
  AgentOSTask
} from './types'

type ExecutionNodeKind = 'action' | 'agent' | 'goal' | 'persist' | 'plan' | 'verify'
type ExecutionEdgeKind = 'dependency' | 'execution' | 'membership' | 'verification'

export interface ExecutionCanvasNode {
  id: string
  kind: ExecutionNodeKind
  title: string
  detail: string
  state: string
  column: number
  row: number
  meta?: string[]
}

export interface ExecutionCanvasEdge {
  id: string
  source: string
  target: string
  kind: ExecutionEdgeKind
  label: string
}

export interface ExecutionCanvasModel {
  nodes: ExecutionCanvasNode[]
  edges: ExecutionCanvasEdge[]
  columns: number
}

const TERMINAL_STATES = new Set(['CANCELLED', 'COMPLETED', 'FAILED', 'SUCCEEDED'])
const ACTIVE_STATES = new Set(['ACTIVE', 'EXECUTING', 'RECOVERING', 'RUNNING', 'STARTING', 'VERIFYING'])

function compactId(value: null | string | undefined): string {
  if (!value) return '—'
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`
}

function stepLevels(steps: AgentOSPlanStep[], dependencies: AgentOSPlan['dependencies']): Map<string, number> {
  const known = new Set(steps.map(step => step.id))
  const parents = new Map<string, string[]>()

  for (const edge of dependencies ?? []) {
    if (!known.has(edge.step_id) || !known.has(edge.dependency_step_id)) continue
    parents.set(edge.step_id, [...(parents.get(edge.step_id) ?? []), edge.dependency_step_id])
  }

  const levels = new Map<string, number>()
  const pending = new Set(known)

  for (let pass = 0; pass <= steps.length && pending.size; pass += 1) {
    let changed = false

    for (const id of [...pending]) {
      const deps = parents.get(id) ?? []
      if (!deps.every(parent => levels.has(parent))) continue
      levels.set(id, deps.length ? Math.max(...deps.map(parent => levels.get(parent) ?? 0)) + 1 : 0)
      pending.delete(id)
      changed = true
    }

    if (!changed) break
  }

  const fallback = Math.max(-1, ...levels.values()) + 1
  for (const id of pending) levels.set(id, fallback)

  return levels
}

function actionDetail(action: AgentOSAction): string {
  return [action.tool, action.operation].filter(Boolean).join(' · ')
}

function agentDetail(agent: AgentOSAgent): string {
  return [agent.runtime, agent.goal].filter(Boolean).join(' · ')
}

export function buildExecutionCanvasModel(task: AgentOSTask): ExecutionCanvasModel {
  const nodes: ExecutionCanvasNode[] = []
  const edges: ExecutionCanvasEdge[] = []
  const plan = task.plan
  const levels = stepLevels(plan?.steps ?? [], plan?.dependencies ?? [])
  const planDepth = plan?.steps.length ? Math.max(...levels.values()) + 1 : 0
  const agentColumn = Math.max(2, planDepth + 1)
  const actionColumn = agentColumn + 1
  const verifyColumn = actionColumn + 1
  const persistColumn = verifyColumn + 1

  nodes.push({
    id: `goal:${task.id}`,
    kind: 'goal',
    title: 'Goal',
    detail: task.goal,
    state: task.state,
    column: 0,
    row: 0,
    meta: [compactId(task.id)]
  })

  const rowsByColumn = new Map<number, number>()
  const nextRow = (column: number) => {
    const row = rowsByColumn.get(column) ?? 0
    rowsByColumn.set(column, row + 1)
    return row
  }

  for (const step of plan?.steps ?? []) {
    const column = 1 + (levels.get(step.id) ?? 0)
    nodes.push({
      id: `step:${step.id}`,
      kind: 'plan',
      title: step.title,
      detail: step.kind,
      state: step.state,
      column,
      row: nextRow(column),
      meta: [
        `priority ${step.priority}`,
        step.claim_owner ? `owner ${step.claim_owner}` : '',
        step.execution_id ? `execution ${compactId(step.execution_id)}` : ''
      ].filter(Boolean)
    })
  }

  for (const agent of task.agents) {
    nodes.push({
      id: `agent:${agent.id}`,
      kind: 'agent',
      title: agent.role || 'Agent',
      detail: agentDetail(agent),
      state: agent.state,
      column: agentColumn,
      row: nextRow(agentColumn),
      meta: [`restarts ${agent.restart_count}/${agent.max_restarts}`, compactId(agent.id)]
    })
  }

  for (const action of task.actions) {
    nodes.push({
      id: `action:${action.id}`,
      kind: 'action',
      title: actionDetail(action),
      detail: action.risk_level ? `risk ${action.risk_level}` : 'execution action',
      state: action.state,
      column: actionColumn,
      row: nextRow(actionColumn),
      meta: [
        action.permission_policy ? `policy ${action.permission_policy}` : '',
        action.verification_required ? 'verification required' : '',
        action.recovery_attempts ? `recovery ×${action.recovery_attempts}` : ''
      ].filter(Boolean)
    })
  }

  const verificationActions = task.actions.filter(action => action.verification_required)
  if (verificationActions.length) {
    const verified = verificationActions.filter(action => action.state === 'SUCCEEDED').length
    const failed = verificationActions.some(action => action.state === 'FAILED')
    nodes.push({
      id: `verify:${task.id}`,
      kind: 'verify',
      title: 'Verification',
      detail: `${verified}/${verificationActions.length} verified`,
      state:
        task.state === 'VERIFYING'
          ? 'VERIFYING'
          : failed
            ? 'FAILED'
            : verified === verificationActions.length
              ? 'SUCCEEDED'
              : 'READY',
      column: verifyColumn,
      row: 0,
      meta: [`${task.metrics.verifications} evidence event(s)`]
    })
  }

  nodes.push({
    id: `persist:${task.id}`,
    kind: 'persist',
    title: 'Durable memory',
    detail: task.workspace_id ? `workspace ${compactId(task.workspace_id)}` : 'append-only execution ledger',
    state: task.state === 'COMPLETED' ? 'SUCCEEDED' : 'ACTIVE',
    column: persistColumn,
    row: 0,
    meta: [`${task.events.length} recent event(s)`, `${task.metrics.checkpoints} checkpoint(s)`]
  })

  const nodeIds = new Set(nodes.map(node => node.id))
  const linkedTargets = new Set<string>()
  const addEdge = (source: string, target: string, kind: ExecutionEdgeKind, label: string) => {
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return
    const id = `${kind}:${source}->${target}`
    if (edges.some(edge => edge.id === id)) return
    edges.push({ id, source, target, kind, label })
    linkedTargets.add(target)
  }

  const goalId = `goal:${task.id}`

  for (const dependency of plan?.dependencies ?? []) {
    addEdge(
      `step:${dependency.dependency_step_id}`,
      `step:${dependency.step_id}`,
      'dependency',
      'depends on'
    )
  }

  for (const step of plan?.steps ?? []) {
    const nodeId = `step:${step.id}`
    const hasDependency = (plan?.dependencies ?? []).some(edge => edge.step_id === step.id)
    if (!hasDependency) addEdge(goalId, nodeId, 'membership', 'planned from goal')

    if (step.execution_id) {
      const target = task.agents.some(agent => agent.id === step.execution_id)
        ? `agent:${step.execution_id}`
        : task.actions.some(action => action.id === step.execution_id)
          ? `action:${step.execution_id}`
          : null
      if (target) addEdge(nodeId, target, 'execution', 'executes as')
    }
  }

  for (const agent of task.agents) {
    const nodeId = `agent:${agent.id}`
    if (agent.parent_agent_id && task.agents.some(parent => parent.id === agent.parent_agent_id)) {
      addEdge(`agent:${agent.parent_agent_id}`, nodeId, 'execution', 'delegates')
    } else if (!linkedTargets.has(nodeId)) {
      addEdge(goalId, nodeId, 'membership', 'task agent')
    }
  }

  for (const action of task.actions) {
    const nodeId = `action:${action.id}`
    if (action.parent_action_id && task.actions.some(parent => parent.id === action.parent_action_id)) {
      addEdge(`action:${action.parent_action_id}`, nodeId, 'execution', 'child action')
    } else if (action.agent_id && task.agents.some(agent => agent.id === action.agent_id)) {
      addEdge(`agent:${action.agent_id}`, nodeId, 'execution', 'executes')
    } else if (!linkedTargets.has(nodeId)) {
      addEdge(goalId, nodeId, 'membership', 'task action')
    }

    if (action.verification_required && nodeIds.has(`verify:${task.id}`)) {
      addEdge(nodeId, `verify:${task.id}`, 'verification', 'verified by')
    }
  }

  const persistId = `persist:${task.id}`
  const verifyId = `verify:${task.id}`
  if (nodeIds.has(verifyId)) {
    addEdge(verifyId, persistId, 'verification', 'records evidence')
  } else {
    const terminalActions = task.actions.filter(action => TERMINAL_STATES.has(action.state))
    if (terminalActions.length) {
      for (const action of terminalActions.slice(-4)) {
        addEdge(`action:${action.id}`, persistId, 'membership', 'records')
      }
    } else {
      addEdge(goalId, persistId, 'membership', 'records')
    }
  }

  return {
    nodes,
    edges,
    columns: Math.max(...nodes.map(node => node.column), 0) + 1
  }
}

function nodeIcon(kind: ExecutionNodeKind): string {
  if (kind === 'goal') return 'target'
  if (kind === 'plan') return 'list-tree'
  if (kind === 'agent') return 'hubot'
  if (kind === 'action') return 'tools'
  if (kind === 'verify') return 'verified'
  return 'database'
}

function edgeIsActive(edge: ExecutionCanvasEdge, nodeById: Map<string, ExecutionCanvasNode>): boolean {
  const source = nodeById.get(edge.source)
  const target = nodeById.get(edge.target)
  return Boolean(
    (source && ACTIVE_STATES.has(source.state)) ||
    (target && ACTIVE_STATES.has(target.state))
  )
}

const NODE_WIDTH = 176
const NODE_HEIGHT = 78
const COLUMN_GAP = 72
const ROW_GAP = 22
const PADDING_X = 28
const PADDING_Y = 34

function nodePosition(node: ExecutionCanvasNode, countInColumn: number, canvasHeight: number) {
  const x = PADDING_X + node.column * (NODE_WIDTH + COLUMN_GAP)
  const totalHeight = countInColumn * NODE_HEIGHT + Math.max(0, countInColumn - 1) * ROW_GAP
  const y = (canvasHeight - totalHeight) / 2 + node.row * (NODE_HEIGHT + ROW_GAP)
  return { x, y }
}

export function ExecutionCanvas({ task }: { task: AgentOSTask }) {
  const model = useMemo(() => buildExecutionCanvasModel(task), [task])
  const [selectedId, setSelectedId] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const counts = new Map<number, number>()

  for (const node of model.nodes) {
    counts.set(node.column, (counts.get(node.column) ?? 0) + 1)
  }

  const maxRows = Math.max(1, ...counts.values())
  const height = Math.max(
    300,
    PADDING_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP
  )
  const positioned = new Map(
    model.nodes.map(node => {
      const position = nodePosition(node, counts.get(node.column) ?? 1, height)
      return [node.id, { node, ...position }] as const
    })
  )
  const width = PADDING_X * 2 + model.columns * NODE_WIDTH + Math.max(0, model.columns - 1) * COLUMN_GAP
  const selected = selectedId ? positioned.get(selectedId)?.node : undefined
  const nodeById = new Map(model.nodes.map(node => [node.id, node]))

  return (
    <section className="aos-panel overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Codicon className="shrink-0 text-(--ui-text-tertiary)" name="circuit-board" size="0.85rem" />
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-tight text-foreground">Unified execution canvas</div>
            <div className="mt-0.5 text-[0.58rem] text-(--ui-text-tertiary)">
              Ledger-backed relationships only · no inferred worker ownership
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            aria-label="Zoom out execution canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom <= 0.7}
            onClick={() => setZoom(value => Math.max(0.7, Math.round((value - 0.1) * 10) / 10))}
            type="button"
          >
            <Codicon name="zoom-out" size="0.72rem" />
          </button>
          <button
            className="h-7 min-w-12 rounded border border-(--ui-stroke-tertiary) px-1.5 text-[0.58rem] tabular-nums text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
            onClick={() => setZoom(1)}
            title="Reset zoom"
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in execution canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom >= 1.4}
            onClick={() => setZoom(value => Math.min(1.4, Math.round((value + 0.1) * 10) / 10))}
            type="button"
          >
            <Codicon name="zoom-in" size="0.72rem" />
          </button>
        </div>
      </div>

      <div className="aos-graph-viewport aos-scrollbar">
        <div
          className="aos-graph-stage"
          style={{
            height: height * zoom,
            width: width * zoom
          }}
        >
          <div
            className="aos-graph-transform"
            style={{
              height,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              width
            }}
          >
            <svg aria-hidden="true" className="aos-graph-edges" height={height} width={width}>
              <defs>
                <marker id="aos-arrow" markerHeight="6" markerWidth="6" orient="auto-start-reverse" refX="5" refY="3">
                  <path d="M0,0 L6,3 L0,6 z" fill="currentColor" />
                </marker>
              </defs>
              {model.edges.map(edge => {
                const source = positioned.get(edge.source)
                const target = positioned.get(edge.target)
                if (!source || !target) return null

                const x1 = source.x + NODE_WIDTH
                const y1 = source.y + NODE_HEIGHT / 2
                const x2 = target.x
                const y2 = target.y + NODE_HEIGHT / 2
                const dx = Math.max(34, (x2 - x1) * 0.45)
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`

                return (
                  <path
                    className={cn(
                      'aos-graph-edge',
                      edge.kind === 'membership' && 'aos-graph-edge-membership',
                      edgeIsActive(edge, nodeById) && 'aos-graph-edge-active'
                    )}
                    d={d}
                    data-kind={edge.kind}
                    key={edge.id}
                    markerEnd="url(#aos-arrow)"
                  />
                )
              })}
            </svg>

            {model.nodes.map(node => {
              const position = positioned.get(node.id)!
              return (
                <button
                  className={cn('aos-graph-node', selectedId === node.id && 'aos-graph-node-selected')}
                  data-kind={node.kind}
                  data-state={node.state}
                  key={node.id}
                  onClick={() => setSelectedId(node.id)}
                  style={{
                    height: NODE_HEIGHT,
                    left: position.x,
                    top: position.y,
                    width: NODE_WIDTH
                  }}
                  title={node.detail}
                  type="button"
                >
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
                      <Codicon name={nodeIcon(node.kind)} size="0.7rem" />
                    </span>
                    <span className="aos-graph-status-dot" />
                  </span>
                  <span className="mt-2 block truncate text-left text-[0.68rem] font-semibold text-foreground">{node.title}</span>
                  <span className="mt-0.5 block truncate text-left text-[0.56rem] text-(--ui-text-tertiary)">{node.detail}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid border-t border-(--ui-stroke-tertiary) lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 px-3 py-2.5">
          {selected ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className="aos-kicker">{selected.kind}</span>
                <span className="truncate text-[0.66rem] font-medium text-foreground">{selected.title}</span>
                <span className="shrink-0 text-[0.56rem] uppercase tracking-[0.06em] text-(--ui-text-tertiary)">
                  {selected.state}
                </span>
              </div>
              <div className="mt-1 truncate text-[0.58rem] text-(--ui-text-tertiary)" title={selected.detail}>
                {selected.detail}
              </div>
              {selected.meta?.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selected.meta.map(item => (
                    <span className="rounded border border-(--ui-stroke-tertiary) px-1.5 py-0.5 text-[0.54rem] text-(--ui-text-tertiary)" key={item}>
                      {item}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="text-[0.6rem] text-(--ui-text-tertiary)">
              Select any node to inspect its ledger-backed state. Animated edges indicate currently active execution paths.
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-(--ui-stroke-tertiary) px-3 py-2 text-[0.54rem] text-(--ui-text-quaternary) lg:border-l lg:border-t-0">
          <span>{model.nodes.length} nodes</span>
          <span>{model.edges.length} links</span>
        </div>
      </div>
    </section>
  )
}

export interface KnowledgeCanvasNode {
  id: string
  kind: string
  label: string
  connections: number
  category?: string
  useCount?: number
  row: number
  column: number
}

export interface KnowledgeCanvasModel {
  nodes: KnowledgeCanvasNode[]
  edges: Array<{ source: string; target: string }>
}

function knowledgeNodeScore(node: AgentOSLearningNode, degree: number): number {
  return degree * 1000 + (node.useCount ?? 0) * 10 + (node.pinned ? 5 : 0)
}

export function buildKnowledgeCanvasModel(graph: AgentOSLearningGraph, limit = 30): KnowledgeCanvasModel {
  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  const memory = graph.nodes
    .filter(node => node.kind === 'memory')
    .sort((a, b) => knowledgeNodeScore(b, degree.get(b.id) ?? 0) - knowledgeNodeScore(a, degree.get(a.id) ?? 0))
  const skills = graph.nodes
    .filter(node => node.kind !== 'memory')
    .sort((a, b) => knowledgeNodeScore(b, degree.get(b.id) ?? 0) - knowledgeNodeScore(a, degree.get(a.id) ?? 0))

  const memoryLimit = Math.max(1, Math.ceil(limit / 2))
  const skillLimit = Math.max(1, limit - memoryLimit)
  const visible = [...memory.slice(0, memoryLimit), ...skills.slice(0, skillLimit)]
  const visibleIds = new Set(visible.map(node => node.id))
  const rows = new Map<number, number>()

  const nodes = visible.map(node => {
    const column = node.kind === 'memory' ? 0 : 1
    const row = rows.get(column) ?? 0
    rows.set(column, row + 1)

    return {
      id: node.id,
      kind: node.kind,
      label: node.label || node.id,
      connections: degree.get(node.id) ?? 0,
      category: node.kind === 'memory' ? node.memorySource : node.category,
      useCount: node.useCount,
      row,
      column
    }
  })

  return {
    nodes,
    edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
  }
}

const KNOWLEDGE_NODE_WIDTH = 184
const KNOWLEDGE_NODE_HEIGHT = 62
const KNOWLEDGE_COLUMN_GAP = 240
const KNOWLEDGE_ROW_GAP = 16
const KNOWLEDGE_PADDING = 28

export function SemanticKnowledgeCanvas({
  graph,
  onSelect,
  selectedId
}: {
  graph: AgentOSLearningGraph
  onSelect: (id: string) => void
  selectedId?: string
}) {
  const model = useMemo(() => buildKnowledgeCanvasModel(graph), [graph])
  const memoryCount = model.nodes.filter(node => node.column === 0).length
  const skillCount = model.nodes.filter(node => node.column === 1).length
  const rows = Math.max(memoryCount, skillCount, 1)
  const height = Math.max(
    300,
    KNOWLEDGE_PADDING * 2 +
      rows * KNOWLEDGE_NODE_HEIGHT +
      Math.max(0, rows - 1) * KNOWLEDGE_ROW_GAP
  )
  const width = KNOWLEDGE_PADDING * 2 + KNOWLEDGE_NODE_WIDTH * 2 + KNOWLEDGE_COLUMN_GAP
  const positions = new Map(
    model.nodes.map(node => {
      const count = node.column === 0 ? memoryCount : skillCount
      const total =
        count * KNOWLEDGE_NODE_HEIGHT + Math.max(0, count - 1) * KNOWLEDGE_ROW_GAP
      const y =
        (height - total) / 2 +
        node.row * (KNOWLEDGE_NODE_HEIGHT + KNOWLEDGE_ROW_GAP)
      const x =
        KNOWLEDGE_PADDING +
        node.column * (KNOWLEDGE_NODE_WIDTH + KNOWLEDGE_COLUMN_GAP)

      return [node.id, { x, y }] as const
    })
  )

  if (!model.nodes.length) {
    return (
      <div className="grid min-h-64 place-items-center text-xs text-(--ui-text-tertiary)">
        No semantic memory relationships are available yet.
      </div>
    )
  }

  return (
    <div className="aos-knowledge-viewport aos-scrollbar">
      <div className="aos-knowledge-stage" style={{ height, width }}>
        <div className="aos-knowledge-axis aos-knowledge-axis-memory">
          <span>Memory</span>
        </div>
        <div className="aos-knowledge-axis aos-knowledge-axis-skills">
          <span>Skills</span>
        </div>

        <svg aria-hidden="true" className="aos-graph-edges" height={height} width={width}>
          {model.edges.map((edge, index) => {
            const sourceNode = model.nodes.find(node => node.id === edge.source)
            const targetNode = model.nodes.find(node => node.id === edge.target)
            const source = positions.get(edge.source)
            const target = positions.get(edge.target)
            if (!sourceNode || !targetNode || !source || !target) return null

            const from = sourceNode.column <= targetNode.column ? source : target
            const to = sourceNode.column <= targetNode.column ? target : source
            const x1 = from.x + KNOWLEDGE_NODE_WIDTH
            const y1 = from.y + KNOWLEDGE_NODE_HEIGHT / 2
            const x2 = to.x
            const y2 = to.y + KNOWLEDGE_NODE_HEIGHT / 2
            const dx = Math.max(90, (x2 - x1) * 0.44)

            return (
              <path
                className="aos-knowledge-edge"
                d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                key={`${edge.source}->${edge.target}:${index}`}
              />
            )
          })}
        </svg>

        {model.nodes.map(node => {
          const position = positions.get(node.id)!
          return (
            <button
              className={cn(
                'aos-knowledge-node',
                node.kind === 'memory' ? 'aos-knowledge-node-memory' : 'aos-knowledge-node-skill',
                selectedId === node.id && 'aos-knowledge-node-selected'
              )}
              key={node.id}
              onClick={() => onSelect(node.id)}
              style={{
                height: KNOWLEDGE_NODE_HEIGHT,
                left: position.x,
                top: position.y,
                width: KNOWLEDGE_NODE_WIDTH
              }}
              title={node.label}
              type="button"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
                  <Codicon name={node.kind === 'memory' ? 'note' : 'sparkle'} size="0.64rem" />
                </span>
                <span className="text-[0.52rem] tabular-nums text-(--ui-text-tertiary)">
                  {node.connections} links
                </span>
              </span>
              <span className="mt-1.5 block truncate text-left text-[0.64rem] font-medium text-foreground">
                {node.label}
              </span>
              <span className="mt-0.5 block truncate text-left text-[0.52rem] uppercase tracking-[0.05em] text-(--ui-text-quaternary)">
                {node.category || node.kind}
                {node.useCount ? ` · used ${node.useCount}` : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function safeVerificationLabel(action: AgentOSAction): string {
  const result = action.verification_result ?? {}
  for (const key of ['verdict', 'status', 'result']) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'boolean') return value ? 'PASS' : 'FAIL'
  }
  return action.verification_required ? 'PENDING' : 'NOT REQUIRED'
}

function latestActionForTool(task: AgentOSTask, names: string[]): AgentOSAction | undefined {
  const normalized = new Set(names.map(name => name.replaceAll('-', '_').toLowerCase()))
  return [...task.actions]
    .filter(action => normalized.has(action.tool.replaceAll('-', '_').toLowerCase()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
}

function ObservatoryLane({
  action,
  icon,
  label,
  pixelNote
}: {
  action?: AgentOSAction
  icon: string
  label: string
  pixelNote: string
}) {
  return (
    <div className="aos-observatory-lane">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary)">
            <Codicon name={icon} size="0.75rem" />
          </span>
          <div className="min-w-0">
            <div className="aos-kicker">{label}</div>
            <div className="mt-1 truncate text-[0.68rem] font-medium text-foreground">
              {action ? action.operation : 'No observed action'}
            </div>
          </div>
        </div>
        {action ? (
          <span className="shrink-0 text-[0.54rem] uppercase tracking-[0.06em] text-(--ui-text-tertiary)">
            {action.state}
          </span>
        ) : null}
      </div>

      {action ? (
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[0.56rem]">
          <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2 py-1.5">
            <div className="aos-kicker">Risk</div>
            <div className="mt-1 truncate text-(--ui-text-secondary)">{action.risk_level || 'unclassified'}</div>
          </div>
          <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2 py-1.5">
            <div className="aos-kicker">Verify</div>
            <div className="mt-1 truncate text-(--ui-text-secondary)">{safeVerificationLabel(action)}</div>
          </div>
          <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2 py-1.5">
            <div className="aos-kicker">Attempts</div>
            <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{action.execution_attempts}</div>
          </div>
          <div className="rounded border border-(--ui-stroke-tertiary) bg-(--ui-bg-primary) px-2 py-1.5">
            <div className="aos-kicker">Recovery</div>
            <div className="mt-1 tabular-nums text-(--ui-text-secondary)">{action.recovery_attempts}</div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded border border-dashed border-(--ui-stroke-tertiary) px-2.5 py-3 text-[0.58rem] text-(--ui-text-tertiary)">
          This task has not used this runtime.
        </div>
      )}

      <div className="mt-2 text-[0.54rem] leading-relaxed text-(--ui-text-quaternary)">{pixelNote}</div>
    </div>
  )
}

export function RuntimeObservatory({ task }: { task: AgentOSTask }) {
  const browser = latestActionForTool(task, ['browser'])
  const computer = latestActionForTool(task, ['computer_use', 'computer-use'])

  return (
    <section className="aos-panel overflow-hidden">
      <div className="flex min-w-0 items-center justify-between gap-3 border-b border-(--ui-stroke-tertiary) px-3.5 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Codicon className="text-(--ui-text-tertiary)" name="eye" size="0.8rem" />
          <div>
            <div className="text-xs font-semibold text-foreground">Runtime observatory</div>
            <div className="mt-0.5 text-[0.58rem] text-(--ui-text-tertiary)">
              Browser and Computer Use execution truth without persisting raw screen contents
            </div>
          </div>
        </div>
        <span className="text-[0.54rem] uppercase tracking-[0.08em] text-(--ui-text-quaternary)">safe metadata</span>
      </div>
      <div className="grid gap-0 lg:grid-cols-2">
        <ObservatoryLane
          action={browser}
          icon="browser"
          label="Browser"
          pixelNote="Accessibility snapshots and browser state are used for verification; raw visual frames are not exposed through this durable control-plane view."
        />
        <ObservatoryLane
          action={computer}
          icon="device-desktop"
          label="Computer use"
          pixelNote="CUA captures are runtime-ephemeral. A future opt-in live viewport should stream them directly rather than storing desktop pixels in the Agent OS ledger."
        />
      </div>
    </section>
  )
}