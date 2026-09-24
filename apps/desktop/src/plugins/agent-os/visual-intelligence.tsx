import {
...counts.values())
  const height = Math.max(
    280,
...counts.values())
  const height = Math.max(
    300,
...levels.values()) + 1
  for (const id of pending) {
    levels.set(id,
...levels.values()) + 1
  for (const node of nodes) {
    if (!levels.has(node.id)) {
      levels.set(node.id,
...position }] as const
    })
  )
  const width = PADDING_X * 2 + model.columns * NODE_WIDTH + Math.max(0,
...skills.slice(0,
'_').toLowerCase()))
    .sort((a,
'_').toLowerCase()))
  return [...task.actions]
    .filter(action => normalized.has(action.tool.replaceAll('-',
'child action')
    } else if (action.agent_id && task.agents.some(agent => agent.id === action.agent_id)) {
      addEdge(`agent:${action.agent_id}`,
'COMPLETED',
'computer-use'])

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

export interface RuntimeTopologyCanvasNode {
  id: string
  label: string
  kind: string
  status: string
  detail?: string
  remediation?: null | string
  column: number
  row: number
}

export interface RuntimeTopologyCanvasModel {
  nodes: RuntimeTopologyCanvasNode[]
  edges: Array<{ source: string; target: string; relation: string }>
  columns: number
}

export function buildRuntimeTopologyCanvasModel(
  nodes: AgentOSTopologyNode[],
'delegates')
    } else if (!linkedTargets.has(nodeId)) {
      addEdge(goalId,
'dependency',
'depends on'
    )
  }

  for (const step of plan?.steps ?? []) {
    const nodeId = `step:${step.id}`
    const hasDependency = (plan?.dependencies ?? []).some(edge => edge.step_id === step.id)
    if (!hasDependency) {
      addEdge(goalId,
'executes as')
      }
    }
  }

  for (const agent of task.agents) {
    const nodeId = `agent:${agent.id}`
    if (agent.parent_agent_id && task.agents.some(parent => parent.id === agent.parent_agent_id)) {
      addEdge(`agent:${agent.parent_agent_id}`,
'executes'),
undefined} else if (!linkedTargets.has(nodeId)) {
      addEdge(goalId,
'EXECUTING',
'execution',
'execution',
'execution',
'execution',
'FAILED',
'membership',
'membership',
'membership',
'membership',
'membership',
'planned from goal')

    }

    if (step.execution_id) {
      const target = task.agents.some(agent => agent.id === step.execution_id)
        ? `agent:${step.execution_id}`
        : task.actions.some(action => action.id === step.execution_id)
          ? `action:${step.execution_id}`
          : null
      if (target) {
        addEdge(nodeId,
'records evidence')
  } else {
    const terminalActions = task.actions.filter(action => TERMINAL_STATES.has(action.state))
    if (terminalActions.length) {
      for (const action of terminalActions.slice(-4)) {
        addEdge(`action:${action.id}`,
'records')
      }
    } else {
      addEdge(goalId,
'records')
    }
  }

  return {
    nodes,
'RECOVERING',
'result']) {
    const value = result[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
    if (typeof value === 'boolean') {
      return value ? 'PASS' : 'FAIL'
    }
  }
  return action.verification_required ? 'PENDING' : 'NOT REQUIRED'
}

function latestActionForTool(task: AgentOSTask,
'RUNNING',
'STARTING',
'status',
'SUCCEEDED'])
const ACTIVE_STATES = new Set(['ACTIVE',
'task action')
    }

    if (action.verification_required && nodeIds.has(`verify:${task.id}`)) {
      addEdge(nodeId,
'task agent')
    }
  }

  for (const action of task.actions) {
    const nodeId = `action:${action.id}`
    if (action.parent_action_id && task.actions.some(parent => parent.id === action.parent_action_id)) {
      addEdge(`action:${action.parent_action_id}`,
'verification',
'verification',
'verified by')
    }
  }

  const persistId = `persist:${task.id}`
  const verifyId = `verify:${task.id}`
  if (nodeIds.has(verifyId)) {
    addEdge(verifyId,
'VERIFYING'])

function compactId(value: null | string | undefined): string {
  if (!value) {
    return '—'
  }
  return value.length <= 18 ? value : `${value.slice(0,
(counts.get(node.column) ?? 0) + 1)
  }

  const maxRows = Math.max(1,
(counts.get(node.column) ?? 0) + 1)
  }
  const maxRows = Math.max(1,
(degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target,
(degree.get(edge.target) ?? 0) + 1)
  }

  const memory = graph.nodes
    .filter(node => node.kind === 'memory')
    .sort((a,
(x2 - x1) * 0.43)
              return (
                <path
                  className={cn(
                    'aos-runtime-topology-edge',
(x2 - x1) * 0.44)

                return (
                  <path
                    className={cn(
                      'aos-knowledge-edge',
(x2 - x1) * 0.45)
                const d = `M ${x1} ${y1} C ${x1 + dx} ${y1},
[...(outgoing.get(edge.source) ?? []),
[...(parents.get(edge.step_id) ?? []),
['browser'])
  const computer = latestActionForTool(task,
['computer_use',
[edges,
[focusPath,
[focusPath,
[focusPath,
[graph])
  const [zoom,
[task])
  const [selectedId,
{ node,
{ x,
{ x,
`${task.metrics.checkpoints} checkpoint(s)`]
  })

  const nodeIds = new Set(nodes.map(node => node.id))
  const linkedTargets = new Set<string>()
  const addEdge = (source: string,
`step:${dependency.step_id}`,
`verify:${task.id}`,
${x2 - dx} ${y2},
${x2 - dx} ${y2},
${x2 - dx} ${y2},
${x2} ${y2}`

                return (
                  <path
                    className={cn(
                      'aos-graph-edge',
${x2} ${y2}`}
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
${x2} ${y2}`}
                  key={`${edge.source}->${edge.target}:${index}`}
                />
              )
            })}
          </svg>

          {model.nodes.map(node => {
            const position = positions.get(node.id)!
            return (
              <button
            aria-label="Fit runtime topology"
                className={cn(
                  'aos-runtime-topology-node',
0 L6,
0.45fr)]">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="aos-kicker">{selected.kind}</span>
                <span className="truncate text-[0.66rem] font-medium text-foreground">{selected.label}</span>
                <span className="shrink-0 text-[0.54rem] uppercase tracking-[0.06em] text-(--ui-text-tertiary)">
                  {selected.status}
                </span>
              </div>
              <div className="mt-1 text-[0.58rem] leading-relaxed text-(--ui-text-tertiary)">
                {selected.detail || 'No additional runtime detail.'}
              </div>
            </div>
            <div className="text-[0.56rem] leading-relaxed text-(--ui-text-quaternary)">
              {selected.remediation || 'No remediation required or published.'}
            </div>
          </div>
        ) : (
          <div className="text-[0.58rem] text-(--ui-text-tertiary)">
            Select a runtime node to inspect its health detail and remediation authority.
          </div>
        )}
      </div>
    </>
  ),
0.55,
0.55,
0) + 1
  }
}

const TOPOLOGY_NODE_WIDTH = 178
const TOPOLOGY_NODE_HEIGHT = 76
const TOPOLOGY_COLUMN_GAP = 86
const TOPOLOGY_ROW_GAP = 22
const TOPOLOGY_PADDING = 30

export function connectedRuntimeTopologyNodeIds(
  model: RuntimeTopologyCanvasModel,
0) + 1
  }
}

function nodeIcon(kind: ExecutionNodeKind): string {
  if (kind === 'goal') {
    return 'target'
  }
  if (kind === 'plan') {
    return 'list-tree'
  }
  if (kind === 'agent') {
    return 'hubot'
  }
  if (kind === 'action') {
    return 'tools'
  }
  if (kind === 'verify') {
    return 'verified'
  }
  return 'database'
}

function edgeIsActive(edge: ExecutionCanvasEdge,
0]])
  const outgoing = new Map<string,
1.2))
    viewport.scrollTo({ left: 0,
1.3))
    viewport.scrollTo({ left: 0,
1)
  const height = Math.max(
    300,
1fr)_auto]">
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

function knowledgeNodeScore(node: AgentOSLearningNode,
1fr)_minmax(12rem,
3 L0,
6 z" fill="currentColor" />
                </marker>
              </defs>
              {model.edges.map(edge => {
                const source = positioned.get(edge.source)
                const target = positioned.get(edge.target)
                if (!source || !target) {
                  return null
                }

                const x1 = source.x + NODE_WIDTH
                const y1 = source.y + NODE_HEIGHT / 2
                const x2 = target.x
                const y2 = target.y + NODE_HEIGHT / 2
                const dx = Math.max(34,
9)}…${value.slice(-6)}`
}

function stepLevels(steps: AgentOSPlanStep[],
action.operation].filter(Boolean).join(' · ')
}

function agentDetail(agent: AgentOSAgent): string {
  return [agent.runtime,
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
action.verification_required ? 'verification required' : '',
agent.goal].filter(Boolean).join(' · ')
}

export function buildExecutionCanvasModel(task: AgentOSTask): ExecutionCanvasModel {
  const nodes: ExecutionCanvasNode[] = []
  const edges: ExecutionCanvasEdge[] = []
  const plan = task.plan
  const levels = stepLevels(plan?.steps ?? [],
AgentOSAgent,
AgentOSLearningGraph,
AgentOSLearningNode,
AgentOSPlan,
AgentOSPlanStep,
AgentOSTask,
AgentOSTopologyNode
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

const TERMINAL_STATES = new Set(['CANCELLED',
b) =>
        (levels.get(a.id) ?? 0) - (levels.get(b.id) ?? 0) ||
        a.kind.localeCompare(b.kind) ||
        a.label.localeCompare(b.label)
    )
    .map(node => {
      const column = levels.get(node.id) ?? fallback
      const row = rows.get(column) ?? 0
      rows.set(column,
b) => b.updated_at.localeCompare(a.updated_at))[0]
}

function ObservatoryLane({
  action,
b) => knowledgeNodeScore(b,
b) => knowledgeNodeScore(b,
behavior: 'smooth' })
  }

  const selectNode = (id: string) => {
    onSelect(id)
    const viewport = viewportRef.current
    const position = positions.get(id)
    if (!viewport || !position) {
      return
    }

    const left = Math.max(
      0,
behavior: 'smooth' })
  }

  const selectNode = (id: string) => {
    setSelectedId(id)
    const viewport = viewportRef.current
    const position = positioned.get(id)
    if (!viewport || !position) {
      return
    }

    const left = Math.max(0,
behavior: 'smooth' })
  }

  const selectNode = (id: string) => {
    setSelectedId(id)
    const viewport = viewportRef.current
    const position = positions.get(id)
    if (!viewport || !position) {
      return
    }

    const left = Math.max(0,
behavior: 'smooth' })
  }

  if (!model.nodes.length) {
    return (
      <div className="grid min-h-64 place-items-center text-xs text-(--ui-text-tertiary)">
        No runtime topology is currently available.
      </div>
    )
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--ui-stroke-tertiary) px-3 py-2">
        <div className="text-[0.56rem] text-(--ui-text-quaternary)">
          Runtime graph · {model.nodes.length} nodes · {model.edges.length} links
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={fitAll}
            type="button"
          >
            <Codicon name="screen-full" size="0.66rem" />
            Fit
          </button>
          <button
            aria-label="Fit semantic knowledge canvas"
            aria-pressed={focusPath}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
behavior: 'smooth' })
  }

  if (!model.nodes.length) {
    return (
      <div className="grid min-h-64 place-items-center text-xs text-(--ui-text-tertiary)">
        No semantic memory relationships are available yet.
      </div>
    )
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-(--ui-stroke-tertiary) px-3 py-2">
        <div className="text-[0.56rem] text-(--ui-text-quaternary)">
          Semantic graph · {model.nodes.length} nodes · {model.edges.length} links
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={fitAll}
            type="button"
          >
            <Codicon name="screen-full" size="0.66rem" />
            Fit
          </button>
          <button
            aria-label="Fit execution canvas"
            aria-pressed={focusPath}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
behavior: 'smooth' })
  }

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
            className="inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground"
            onClick={fitAll}
            type="button"
          >
            <Codicon name="screen-full" size="0.66rem" />
            Fit
          </button>
          <button
            aria-pressed={focusPath}
            className={cn(
              'inline-flex h-7 items-center gap-1 rounded border border-(--ui-stroke-tertiary) px-2 text-[0.56rem] font-medium text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground',
canvasHeight: number,
canvasHeight: number) {
  const x = PADDING_X + node.column * (NODE_WIDTH + COLUMN_GAP)
  const totalHeight = countInColumn * NODE_HEIGHT + Math.max(0,
canvasWidth: number,
category: node.kind === 'memory' ? node.memorySource : node.category,
cn,
Codicon } from '@hermes/plugin-sdk'
import { useMemo,
column,
column,
column
    }
  })

  return {
    nodes,
column: 0,
column: actionColumn,
column: agentColumn,
column: persistColumn,
column: verifyColumn,
columns: 0 }
  }

  const known = new Set(nodes.map(node => node.id))
  const validEdges = edges.filter(edge => known.has(edge.source) && known.has(edge.target))
  const core =
    nodes.find(node => node.id === 'agent-os') ??
    nodes.find(node => node.kind === 'core') ??
    nodes[0]
  const levels = new Map<string,
columns: Math.max(...modelNodes.map(node => node.column),
columns: Math.max(...nodes.map(node => node.column),
compactId(agent.id)]
    })
  }

  for (const action of task.actions) {
    nodes.push({
      id: `action:${action.id}`,
connections: degree.get(node.id) ?? 0,
count - 1) * KNOWLEDGE_ROW_GAP
      const y =
        (height - total) / 2 +
        node.row * (KNOWLEDGE_NODE_HEIGHT + KNOWLEDGE_ROW_GAP)
      const x =
        KNOWLEDGE_PADDING +
        node.column * (KNOWLEDGE_NODE_WIDTH + KNOWLEDGE_COLUMN_GAP)

      return [node.id,
count - 1) * TOPOLOGY_ROW_GAP
      const x = TOPOLOGY_PADDING + node.column * (TOPOLOGY_NODE_WIDTH + TOPOLOGY_COLUMN_GAP)
      const y = (height - total) / 2 + node.row * (TOPOLOGY_NODE_HEIGHT + TOPOLOGY_ROW_GAP)
      return [node.id,
countInColumn - 1) * ROW_GAP
  const y = (canvasHeight - totalHeight) / 2 + node.row * (NODE_HEIGHT + ROW_GAP)
  return { x,
countInColumn: number,
counts.get(node.column) ?? 1,
degree: number): number {
  return degree * 1000 + (node.useCount ?? 0) * 10 + (node.pinned ? 5 : 0)
}

export function buildKnowledgeCanvasModel(graph: AgentOSLearningGraph,
degree.get(a.id) ?? 0))

  const memoryLimit = Math.max(1,
degree.get(a.id) ?? 0))
  const skills = graph.nodes
    .filter(node => node.kind !== 'memory')
    .sort((a,
degree.get(b.id) ?? 0) - knowledgeNodeScore(a,
degree.get(b.id) ?? 0) - knowledgeNodeScore(a,
dependencies: AgentOSPlan['dependencies']): Map<string,
deps.length ? Math.max(...deps.map(parent => levels.get(parent) ?? 0)) + 1 : 0)
      pending.delete(id)
      changed = true
    }

    if (!changed) {
      break
    }
  }

  const fallback = Math.max(-1,
detail: `${verified}/${verificationActions.length} verified`,
detail: action.risk_level ? `risk ${action.risk_level}` : 'execution action',
detail: agentDetail(agent),
detail: step.kind,
detail: task.goal,
detail: task.workspace_id ? `workspace ${compactId(task.workspace_id)}` : 'append-only execution ledger',
edge.dependency_step_id])
  }

  const levels = new Map<string,
edge.kind === 'membership' && 'aos-graph-edge-membership',
edge.target])
  }

  const queue = [core.id]
  while (queue.length) {
    const current = queue.shift()!
    const level = levels.get(current) ?? 0
    for (const target of outgoing.get(current) {
      ?? []) {
    }
      if (levels.has(target)) {
        continue
      }
      levels.set(target,
edgeIsActive(edge,
edges,
edges: [],
edges: Array<{ source: string; target: string; relation: string }>
): RuntimeTopologyCanvasModel {
  if (!nodes.length) {
    return { nodes: [],
edges: graph.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
  }
}

const KNOWLEDGE_NODE_WIDTH = 184
const KNOWLEDGE_NODE_HEIGHT = 62
const KNOWLEDGE_COLUMN_GAP = 240
const KNOWLEDGE_ROW_GAP = 16
const KNOWLEDGE_PADDING = 28

export function connectedKnowledgeNodeIds(
  model: KnowledgeCanvasModel,
edges: validEdges,
edges),
ExecutionCanvasNode>): boolean {
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

function nodePosition(node: ExecutionCanvasNode,
fallback)
    }
  }

  const rows = new Map<number,
fallback)
  }

  return levels
}

function actionDetail(action: AgentOSAction): string {
  return [action.tool,
focusPath ? selectedId : undefined),
focusPath ? selectedId : undefined),
focusPath &&
                        selectedId &&
                        edge.source !== selectedId &&
                        edge.target !== selectedId &&
                        'aos-graph-edge-dimmed'
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
                  className={cn(
                    'aos-graph-node',
focusPath &&
                        selectedIsVisible &&
                        edge.source !== selectedId &&
                        edge.target !== selectedId &&
                        'aos-knowledge-edge-dimmed'
                    )}
                    d={`M ${x1} ${y1} C ${x1 + dx} ${y1},
focusPath &&
                      selectedId &&
                      edge.source !== selectedId &&
                      edge.target !== selectedId &&
                      'aos-runtime-topology-edge-dimmed'
                  )}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1},
focusPath &&
                      selectedIsVisible &&
                      !focusedNodeIds.has(node.id) &&
                      'aos-knowledge-node-dimmed'
                  )}
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  style={{
                    height: KNOWLEDGE_NODE_HEIGHT,
focusPath && 'bg-(--ui-control-active-background) text-foreground'
            )}
            disabled={!selectedId}
            onClick={() => setFocusPath(value => !value)}
            type="button"
          >
            <Codicon name="target" size="0.66rem" />
            Focus
          </button>
          <button
            aria-label="Zoom out execution canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom <= 0.7}
            onClick={() => setZoom(value => Math.max(0.7,
focusPath && 'bg-(--ui-control-active-background) text-foreground'
            )}
            disabled={!selectedId}
            onClick={() => setFocusPath(value => !value)}
            type="button"
          >
            <Codicon name="target" size="0.66rem" />
            Focus
          </button>
          <button
            aria-label="Zoom out runtime topology"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom <= 0.55}
            onClick={() => setZoom(value => Math.max(0.55,
focusPath && 'bg-(--ui-control-active-background) text-foreground'
            )}
            disabled={!selectedIsVisible}
            onClick={() => setFocusPath(value => !value)}
            type="button"
          >
            <Codicon name="target" size="0.66rem" />
            Focus
          </button>
          <button
            aria-label="Zoom out semantic knowledge canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom <= 0.55}
            onClick={() => setZoom(value => Math.max(0.55,
focusPath && selectedId && !focusedNodeIds.has(node.id) && 'aos-graph-node-dimmed'
                  )}
                  data-kind={node.kind}
                  data-state={node.state}
                  key={node.id}
                  onClick={() => selectNode(node.id)}
                  style={{
                    height: NODE_HEIGHT,
focusPath && selectedId && !focusedNodeIds.has(node.id) && 'aos-runtime-topology-node-dimmed'
                )}
                data-status={node.status}
                key={node.id}
                onClick={() => selectNode(node.id)}
                style={{
                  height: TOPOLOGY_NODE_HEIGHT,
focusPath && selectedIsVisible ? selectedId : undefined),
height,
height,
height)
      return [node.id,
height))
    viewport.scrollTo({ left: 0,
icon,
index) => {
                const sourceNode = model.nodes.find(node => node.id === edge.source)
                const targetNode = model.nodes.find(node => node.id === edge.target)
                const source = positions.get(edge.source)
                const target = positions.get(edge.target)
                if (!sourceNode || !targetNode || !source || !target) {
                  return null
                }

                const from = sourceNode.column <= targetNode.column ? source : target
                const to = sourceNode.column <= targetNode.column ? target : source
                const x1 = from.x + KNOWLEDGE_NODE_WIDTH
                const y1 = from.y + KNOWLEDGE_NODE_HEIGHT / 2
                const x2 = to.x
                const y2 = to.y + KNOWLEDGE_NODE_HEIGHT / 2
                const dx = Math.max(90,
index) => {
              const source = positions.get(edge.source)
              const target = positions.get(edge.target)
              if (!source || !target) {
                return null
              }
              const x1 = source.x + TOPOLOGY_NODE_WIDTH
              const y1 = source.y + TOPOLOGY_NODE_HEIGHT / 2
              const x2 = target.x
              const y2 = target.y + TOPOLOGY_NODE_HEIGHT / 2
              const dx = Math.max(42,
kind,
kind: 'action',
kind: 'agent',
kind: 'goal',
kind: 'persist',
kind: 'plan',
kind: 'verify',
kind: ExecutionEdgeKind,
kind: node.kind,
KNOWLEDGE_PADDING * 2 +
      rows * KNOWLEDGE_NODE_HEIGHT +
      Math.max(0,
label,
label })
    linkedTargets.add(target)
  }

  const goalId = `goal:${task.id}`

  for (const dependency of plan?.dependencies ?? []) {
    addEdge(
      `step:${dependency.dependency_step_id}`,
label: node.label || node.id,
label: string) => {
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) {
      return
    }
    const id = `${kind}:${source}->${target}`
    if (edges.some(edge => edge.id === id)) {
      return
    }
    edges.push({ id,
left: position.x,
left: position.x,
left: position.x,
level + 1)
      queue.push(target)
    }
  }

  const fallback = Math.max(0,
limit - memoryLimit)
  const visible = [...memory.slice(0,
limit = 30): KnowledgeCanvasModel {
  const degree = new Map<string,
Math.ceil(limit / 2))
  const skillLimit = Math.max(1,
Math.round((value - 0.1) * 10) / 10))}
            type="button"
          >
            <Codicon name="zoom-out" size="0.72rem" />
          </button>
          <button
            aria-label="Reset execution canvas zoom"
            className="h-7 min-w-12 rounded border border-(--ui-stroke-tertiary) px-1.5 text-[0.58rem] tabular-nums text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
            onClick={() => setZoom(1)}
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in execution canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom >= 1.4}
            onClick={() => setZoom(value => Math.min(1.4,
Math.round((value - 0.1) * 100) / 100))}
            type="button"
          >
            <Codicon name="zoom-out" size="0.72rem" />
          </button>
          <button
            aria-label="Reset runtime topology zoom"
            className="h-7 min-w-12 rounded border border-(--ui-stroke-tertiary) px-1.5 text-[0.56rem] tabular-nums text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
            onClick={() => setZoom(1)}
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in runtime topology"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom >= 1.2}
            onClick={() => setZoom(value => Math.min(1.2,
Math.round((value - 0.1) * 100) / 100))}
            type="button"
          >
            <Codicon name="zoom-out" size="0.72rem" />
          </button>
          <button
            aria-label="Reset semantic knowledge canvas zoom"
            className="h-7 min-w-12 rounded border border-(--ui-stroke-tertiary) px-1.5 text-[0.56rem] tabular-nums text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background)"
            onClick={() => setZoom(1)}
            type="button"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="Zoom in semantic knowledge canvas"
            className="grid size-7 place-items-center rounded border border-(--ui-stroke-tertiary) text-(--ui-text-tertiary) hover:bg-(--ui-control-hover-background) hover:text-foreground disabled:opacity-40"
            disabled={zoom >= 1.3}
            onClick={() => setZoom(value => Math.min(1.3,
Math.round((value + 0.1) * 10) / 10))}
            type="button"
          >
            <Codicon name="zoom-in" size="0.72rem" />
          </button>
        </div>
      </div>

      <div className="aos-graph-viewport aos-scrollbar" ref={viewportRef}>
        <div
          className="aos-graph-stage"
          style={{
            height: height * zoom,
Math.round((value + 0.1) * 100) / 100))}
            type="button"
          >
            <Codicon name="zoom-in" size="0.72rem" />
          </button>
        </div>
      </div>

      <div className="aos-knowledge-viewport aos-scrollbar" ref={viewportRef}>
        <div className="aos-knowledge-stage" style={{ height: height * zoom,
Math.round((value + 0.1) * 100) / 100))}
            type="button"
          >
            <Codicon name="zoom-in" size="0.72rem" />
          </button>
        </div>
      </div>
      <div className="aos-runtime-topology-viewport aos-scrollbar" ref={viewportRef}>
        <div className="aos-runtime-topology-stage" style={{ height: height * zoom,
Math.round(fitted * 100) / 100)
}

export function connectedExecutionNodeIds(
  model: ExecutionCanvasModel,
maxRows - 1) * ROW_GAP
  )
  const positioned = new Map(
    model.nodes.map(node => {
      const position = nodePosition(node,
maxRows - 1) * TOPOLOGY_ROW_GAP
  )
  const width =
    TOPOLOGY_PADDING * 2 +
    model.columns * TOPOLOGY_NODE_WIDTH +
    Math.max(0,
maxZoom = 1.4
): number {
  if (viewportWidth <= 0 || viewportHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return 1
  }

  const horizontal = Math.max(0,
maxZoom)

  return Math.max(minZoom,
memoryLimit),
meta: [
        `priority ${step.priority}`,
meta: [
        action.permission_policy ? `policy ${action.permission_policy}` : '',
meta: [`${task.events.length} recent event(s)`,
meta: [`${task.metrics.verifications} evidence event(s)`]
    })
  }

  nodes.push({
    id: `persist:${task.id}`,
meta: [`restarts ${agent.restart_count}/${agent.max_restarts}`,
meta: [compactId(task.id)]
  })

  const rowsByColumn = new Map<number,
minZoom = 0.55,
model,
model,
model,
model.columns - 1) * COLUMN_GAP
  const selected = selectedId ? positioned.get(selectedId)?.node : undefined
  const nodeById = new Map(model.nodes.map(node => [node.id,
model.columns - 1) * TOPOLOGY_COLUMN_GAP
  const positions = new Map(
    model.nodes.map(node => {
      const count = counts.get(node.column) ?? 1
      const total = count * TOPOLOGY_NODE_HEIGHT + Math.max(0,
names: string[]): AgentOSAction | undefined {
  const normalized = new Set(names.map(name => name.replaceAll('-',
node.kind === 'memory' ? 'aos-knowledge-node-memory' : 'aos-knowledge-node-skill',
node]))
  const focusedNodeIds = useMemo(
    () => connectedExecutionNodeIds(model,
nodeById: Map<string,
nodeById) && 'aos-graph-edge-active',
nodeId,
nodeId,
nodeId,
nodeId,
nodeId,
nodeId,
nodes
}: {
  edges: Array<{ source: string; target: string; relation: string }>
  nodes: AgentOSTopologyNode[]
}) {
  const model = useMemo(() => buildRuntimeTopologyCanvasModel(nodes,
nodes])
  const [selectedId,
number> {
  const known = new Set(steps.map(step => step.id))
  const parents = new Map<string,
number>()

  const nodes = visible.map(node => {
    const column = node.kind === 'memory' ? 0 : 1
    const row = rows.get(column) ?? 0
    rows.set(column,
number>()

  for (const node of model.nodes) {
    counts.set(node.column,
number>()
  const modelNodes = nodes
    .slice()
    .sort(
      (a,
number>()
  const nextRow = (column: number) => {
    const row = rowsByColumn.get(column) ?? 0
    rowsByColumn.set(column,
number>()
  const pending = new Set(known)

  for (let pass = 0; pass <= steps.length && pending.size; pass += 1) {
    let changed = false

    for (const id of [...pending]) {
      const deps = parents.get(id) ?? []
      if (!deps.every(parent => levels.has(parent))) {
        continue
      }
      levels.set(id,
number>()
  for (const edge of graph.edges) {
    degree.set(edge.source,
number>()
  for (const node of model.nodes) {
    counts.set(node.column,
number>([[core.id,
onSelect,
PADDING_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0,
persistId,
persistId,
persistId,
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
  const browser = latestActionForTool(task,
plan?.dependencies ?? [])
  const planDepth = plan?.steps.length ? Math.max(...levels.values()) + 1 : 0
  const agentColumn = Math.max(2,
planDepth + 1)
  const actionColumn = agentColumn + 1
  const verifyColumn = actionColumn + 1
  const persistColumn = verifyColumn + 1

  nodes.push({
    id: `goal:${task.id}`,
position.x * zoom - viewport.clientWidth / 2 + (KNOWLEDGE_NODE_WIDTH * zoom) / 2
    )
    const top = Math.max(
      0,
position.x * zoom - viewport.clientWidth / 2 + (NODE_WIDTH * zoom) / 2)
    const top = Math.max(0,
position.x * zoom - viewport.clientWidth / 2 + (TOPOLOGY_NODE_WIDTH * zoom) / 2)
    const top = Math.max(0,
position.y * zoom - viewport.clientHeight / 2 + (KNOWLEDGE_NODE_HEIGHT * zoom) / 2
    )
    viewport.scrollTo({ left,
position.y * zoom - viewport.clientHeight / 2 + (NODE_HEIGHT * zoom) / 2)
    viewport.scrollTo({ left,
position.y * zoom - viewport.clientHeight / 2 + (TOPOLOGY_NODE_HEIGHT * zoom) / 2)
    viewport.scrollTo({ left,
row,
row
      }
    })

  return {
    nodes: modelNodes,
row + 1)

    return {
      id: node.id,
row + 1)
      return {
        ...node,
row + 1)
    return row
  }

  for (const step of plan?.steps ?? []) {
    const column = 1 + (levels.get(step.id) ?? 0)
    nodes.push({
      id: `step:${step.id}`,
row: 0,
row: 0,
row: 0,
row: nextRow(actionColumn),
row: nextRow(agentColumn),
row: nextRow(column),
rows - 1) * KNOWLEDGE_ROW_GAP
  )
  const width = KNOWLEDGE_PADDING * 2 + KNOWLEDGE_NODE_WIDTH * 2 + KNOWLEDGE_COLUMN_GAP
  const positions = new Map(
    model.nodes.map(node => {
      const count = node.column === 0 ? memoryCount : skillCount
      const total =
        count * KNOWLEDGE_NODE_HEIGHT + Math.max(0,
selectedId,
selectedId
}: {
  graph: AgentOSLearningGraph
  onSelect: (id: string) => void
  selectedId?: string
}) {
  const model = useMemo(() => buildKnowledgeCanvasModel(graph),
selectedId === node.id && 'aos-graph-node-selected',
selectedId === node.id && 'aos-knowledge-node-selected',
selectedId === node.id && 'aos-runtime-topology-node-selected',
selectedId: string | undefined
): Set<string> {
  if (!selectedId || !model.nodes.some(node => node.id === selectedId)) {
    return new Set()
  }

  const connected = new Set<string>([selectedId])
  for (const edge of model.edges) {
    if (edge.source === selectedId) {
      connected.add(edge.target)
    }
    if (edge.target === selectedId) {
      connected.add(edge.source)
    }
  }

  return connected
}

export function RuntimeTopologyCanvas({
  edges,
selectedId: string | undefined
): Set<string> {
  if (!selectedId || !model.nodes.some(node => node.id === selectedId)) {
    return new Set()
  }

  const connected = new Set<string>([selectedId])
  for (const edge of model.edges) {
    if (edge.source === selectedId) {
      connected.add(edge.target)
    }
    if (edge.target === selectedId) {
      connected.add(edge.source)
    }
  }

  return connected
}

export function SemanticKnowledgeCanvas({
  graph,
selectedId: string | undefined
): Set<string> {
  if (!selectedId) {
    return new Set()
  }

  const connected = new Set<string>([selectedId])
  for (const edge of model.edges) {
    if (edge.source === selectedId) {
      connected.add(edge.target)
    }
    if (edge.target === selectedId) {
      connected.add(edge.source)
    }
  }

  return connected
}

export function ExecutionCanvas({ task }: { task: AgentOSTask }) {
  const model = useMemo(() => buildExecutionCanvasModel(task),
selectedId]
  )

  const fitAll = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    setZoom(fitCanvasZoom(viewport.clientWidth,
selectedId]
  )

  const fitAll = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    setZoom(fitCanvasZoom(viewport.clientWidth,
selectedIsVisible]
  )

  const fitAll = () => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    setZoom(fitCanvasZoom(viewport.clientWidth,
setFocusPath] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const counts = new Map<number,
setFocusPath] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const counts = new Map<number,
setFocusPath] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const memoryCount = model.nodes.filter(node => node.column === 0).length
  const skillCount = model.nodes.filter(node => node.column === 1).length
  const rows = Math.max(memoryCount,
setSelectedId] = useState<string>()
  const [zoom,
setSelectedId] = useState<string>()
  const [zoom,
setZoom] = useState(1)
  const [focusPath,
setZoom] = useState(1)
  const [focusPath,
setZoom] = useState(1)
  const [focusPath,
skillCount,
skillLimit)]
  const visibleIds = new Set(visible.map(node => node.id))
  const rows = new Map<number,
source,
state:
        task.state === 'VERIFYING'
          ? 'VERIFYING'
          : failed
            ? 'FAILED'
            : verified === verificationActions.length
              ? 'SUCCEEDED'
              : 'READY',
state: action.state,
state: agent.state,
state: step.state,
state: task.state,
state: task.state === 'COMPLETED' ? 'SUCCEEDED' : 'ACTIVE',
step.claim_owner ? `owner ${step.claim_owner}` : '',
step.execution_id ? `execution ${compactId(step.execution_id)}` : ''
      ].filter(Boolean)
    })
  }

  for (const agent of task.agents) {
    nodes.push({
      id: `agent:${agent.id}`,
string[]>()

  for (const edge of dependencies ?? []) {
    if (!known.has(edge.step_id) || !known.has(edge.dependency_step_id)) {
      continue
    }
    parents.set(edge.step_id,
string[]>()

  for (const edge of validEdges) {
    outgoing.set(edge.source,
target,
target,
target: string,
title: 'Durable memory',
title: 'Goal',
title: 'Verification',
title: actionDetail(action),
title: agent.role || 'Agent',
title: step.title,
top,
top,
top,
top: 0,
top: 0,
top: 0,
top: position.y,
top: position.y,
top: position.y,
TOPOLOGY_PADDING * 2 +
      maxRows * TOPOLOGY_NODE_HEIGHT +
      Math.max(0,
transform: `scale(${zoom})`,
transform: `scale(${zoom})`,
transform: `scale(${zoom})`,
transformOrigin: 'top left',
transformOrigin: 'top left',
transformOrigin: 'top left',
useCount: node.useCount,
useRef,
useState } from 'react'

import type {
  AgentOSAction,
vertical,
viewport.clientHeight,
viewport.clientHeight,
viewport.clientHeight,
viewportHeight - 24) / canvasHeight
  const fitted = Math.min(horizontal,
viewportHeight: number,
viewportWidth - 24) / canvasWidth
  const vertical = Math.max(0,
width,
width,
width,
width
            }}
          >
            <svg aria-hidden="true" className="aos-graph-edges" height={height} width={width}>
              <defs>
                <marker id="aos-arrow" markerHeight="6" markerWidth="6" orient="auto-start-reverse" refX="5" refY="3">
                  <path d="M0,
width }}>
            <div className="aos-knowledge-axis aos-knowledge-axis-memory">
              <span>Memory</span>
            </div>
            <div className="aos-knowledge-axis aos-knowledge-axis-skills">
              <span>Skills</span>
            </div>

            <svg aria-hidden="true" className="aos-graph-edges" height={height} width={width}>
              {model.edges.map((edge,
width }}>
          <svg aria-hidden="true" className="aos-graph-edges" height={height} width={width}>
            {model.edges.map((edge,
width: KNOWLEDGE_NODE_WIDTH
                  }}
                  aria-label={node.label}
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
      </div>
    </div>
  )
}

function safeVerificationLabel(action: AgentOSAction): string {
  const result = action.verification_result ?? {}
  for (const key of ['verdict',
width: NODE_WIDTH
                  }}
                  aria-label={`${node.title}: ${node.detail}`}
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

      <div className="grid border-t border-(--ui-stroke-tertiary) lg:grid-cols-[minmax(0,
width: TOPOLOGY_NODE_WIDTH
                }}
                aria-label={`${node.label}: ${node.status}`}
                type="button"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="aos-kicker">{node.kind}</span>
                  <span className="aos-graph-status-dot" />
                </span>
                <span className="mt-2 block truncate text-left text-[0.68rem] font-semibold text-foreground">
                  {node.label}
                </span>
                <span className="mt-0.5 block truncate text-left text-[0.55rem] uppercase tracking-[0.05em] text-(--ui-text-tertiary)">
                  {node.status}
                </span>
              </button>
            )
          })}
          </div>
        </div>
      </div>

      <div className="border-t border-(--ui-stroke-tertiary) px-3 py-2.5">
        {selected ? (
          <div className="grid gap-2 lg:grid-cols-[minmax(0,
width: width * zoom
          }}
        >
          <div
            className="aos-graph-transform"
            style={{
              height,
width: width * zoom }}>
          <div style={{ height,
width: width * zoom }}>
          <div style={{ height,
y }
}

export function fitCanvasZoom(
  viewportWidth: number,
y }] as const
    })
  )
  const selectedIsVisible = Boolean(selectedId && positions.has(selectedId))
  const focusedNodeIds = useMemo(
    () => connectedKnowledgeNodeIds(model,
y }] as const
    })
  )
  const selected = selectedId ? model.nodes.find(node => node.id === selectedId) : undefined
  const focusedNodeIds = useMemo(
    () => connectedRuntimeTopologyNodeIds(model,
}
