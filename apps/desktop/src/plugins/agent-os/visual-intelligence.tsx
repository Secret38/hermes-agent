import { cn, Codicon } from '@hermes/plugin-sdk'
import { useMemo, useState } from 'react'

import type { AgentOSAction, AgentOSAgent, AgentOSPlanStep, AgentOSTask } from './types'

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

function stepLevels(steps: AgentOSPlanStep[], dependencies: AgentOSTask['plan'] extends infer P
  ? P extends { dependencies: infer D }
    ? D
    : never
  : never): Map<string, number> {
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
      state: task.state === 'VERIFYING' ? 'VERIFYING' : failed ? 'FAILED' : verified === verificationActions.length ? 'SUCCEEDED' : 'READY',
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

function nodePosition(node: ExecutionCanvasNode, countInColumn: number) {
  const x = PADDING_X + node.column * (NODE_WIDTH + COLUMN_GAP)
  const totalHeight = countInColumn * NODE_HEIGHT + Math.max(0, countInColumn - 1) * ROW_GAP
  const canvasHeight = Math.max(260, totalHeight + PADDING_Y * 2)
  const y = (canvasHeight - totalHeight) / 2 + node.row * (NODE_HEIGHT + ROW_GAP)
  return { x, y, canvasHeight }
}

export function ExecutionCanvas({ task }: { task: AgentOSTask }) {
  const model = useMemo(() => buildExecutionCanvasModel(task), [task])
  const [selectedId, setSelectedId] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const counts = new Map<number, number>()

  for (const node of model.nodes) {
    counts.set(node.column, (counts.get(node.column) ?? 0) + 1)
  }

  const positioned = new Map(
    model.nodes.map(node => {
      const position = nodePosition(node, counts.get(node.column) ?? 1)
      return [node.id, { node, ...position }] as const
    })
  )
  const height = Math.max(300, ...[...positioned.values()].map(item => item.canvasHeight))
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
