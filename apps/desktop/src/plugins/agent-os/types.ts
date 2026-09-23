export interface AgentOSHealthCheck {
  name: string
  status: 'FAIL' | 'PASS' | 'WARN' | string
  detail: string
  required_for_core?: boolean
  required_for_full?: boolean
  remediation?: null | string
}

export interface AgentOSHealth {
  platform?: string
  store_path?: string
  core_ready: boolean
  full_ready: boolean
  checks: AgentOSHealthCheck[]
}

export interface AgentOSPlanStep {
  id: string
  plan_id: string
  task_id: string
  title: string
  kind: 'ACTION' | 'AGENT' | 'MANUAL' | 'VERIFICATION' | string
  state: string
  spec?: Record<string, unknown>
  execution_id?: null | string
  claim_owner?: null | string
  claim_expires_at?: null | number
  priority: number
  created_at: string
  updated_at: string
}

export interface AgentOSPlan {
  id: string
  task_id: string
  objective: string
  revision: number
  state: string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
  steps: AgentOSPlanStep[]
  dependencies: Array<{ step_id: string; dependency_step_id: string }>
  progress: {
    total: number
    succeeded: number
    running: number
    ready: number
    blocked: number
    failed: number
    cancelled: number
  }
}

export interface AgentOSAction {
  id: string
  task_id: string
  parent_action_id?: null | string
  agent_id?: null | string
  tool: string
  operation: string
  state: string
  risk_level?: null | string
  permission_policy?: null | string
  workspace_id?: null | string
  checkpoint_id?: null | string
  retry_budget: number
  verification_required: boolean
  verification_method?: null | string
  verification_result?: Record<string, unknown>
  recovery_attempts: number
  execution_attempts: number
  error?: null | string
  created_at: string
  updated_at: string
}

export interface AgentOSAgent {
  id: string
  task_id: string
  runtime: string
  goal: string
  state: string
  parent_agent_id?: null | string
  role: string
  restart_count: number
  max_restarts: number
  error?: null | string
  diagnostic?: null | string
  created_at: string
  updated_at: string
  started_at?: null | string
  completed_at?: null | string
}

export interface AgentOSEvent {
  sequence: number
  id: string
  task_id: string
  action_id?: null | string
  type: string
  payload?: Record<string, unknown>
  created_at: string
}

export interface AgentOSTask {
  id: string
  goal: string
  state: string
  parent_task_id?: null | string
  session_id?: null | string
  kanban_task_id?: null | string
  workspace_id?: null | string
  metadata?: Record<string, unknown>
  created_at: string
  updated_at: string
  plan?: AgentOSPlan | null
  actions: AgentOSAction[]
  agents: AgentOSAgent[]
  events: AgentOSEvent[]
  metrics: {
    actions: number
    agents: number
    recoveries: number
    approvals: number
    verifications: number
    checkpoints: number
  }
}

export interface AgentOSTopologyNode {
  id: string
  kind: 'agent_runtime' | 'capability' | 'core' | 'tool' | string
  label: string
  status: string
  detail?: string
  remediation?: null | string
}

export interface AgentOSMemory {
  workspaces: Array<{ id: string; tasks: number; active_tasks: number }>
  sessions: Array<{ id: string; tasks: number }>
  checkpoints: Array<{
    id: string
    action_id: string
    task_id: string
    workspace_id?: null | string
    updated_at: string
  }>
  event_types: Array<{ type: string; count: number }>
  relations: Array<{ source: string; target: string; relation: string }>
}

export interface AgentOSSnapshot {
  generated_at: string
  store_path: string
  store_error?: null | string
  health: AgentOSHealth
  summary: {
    tasks: number
    active_tasks: number
    completed_tasks: number
    failed_tasks: number
    actions: number
    running_actions: number
    agents: number
    active_agents: number
    events: number
    recoveries: number
    approvals: number
    verifications: number
    checkpoints: number
    workspaces: number
  }
  tasks: AgentOSTask[]
  topology: {
    nodes: AgentOSTopologyNode[]
    edges: Array<{ source: string; target: string; relation: string }>
  }
  memory: AgentOSMemory
}


export interface AgentOSLearningNode {
  id: string
  label: string
  kind: 'memory' | 'skill' | string
  timestamp?: null | number
  category?: string
  useCount?: number
  state?: string
  createdBy?: null | string
  pinned?: boolean
  memorySource?: string
}

export interface AgentOSLearningMemoryCard {
  source: string
  timestamp?: null | number
  title: string
  body: string
}

export interface AgentOSLearningGraph {
  nodes: AgentOSLearningNode[]
  edges: Array<{ source: string; target: string }>
  clusters: Array<{ category: string; count: number }>
  memory: AgentOSLearningMemoryCard[]
  stats: {
    nodes?: number
    related_edges?: number
    edges_per_node?: number
    linked_nodes?: number
    isolated_pct?: number
    categories?: number
    agent_created?: number
    used?: number
    top_categories?: Array<[string, number]>
    memory_nodes: number
    memory_skill_edges: number
    learned_skills: number
  }
  error?: string
}

export interface AgentOSMcpConnection {
  name: string
  transport: string
  auth?: null | string
  enabled: boolean
  target: string
  tool_count?: null | number
  error?: string
}

export interface AgentOSMemoryProviderConnection {
  name: string
  description: string
  available: boolean
  configured: boolean
  status: string
  active: boolean
}

export interface AgentOSContextSnapshot {
  generated_at: string
  learning: AgentOSLearningGraph
  integrations: {
    mcp_servers: AgentOSMcpConnection[]
    memory_providers: {
      active: string
      providers: AgentOSMemoryProviderConnection[]
      error?: string
    }
  }
}


export interface AgentOSMissionJob {
  id: string
  goal: string
  workspace_id?: null | string
  session_id?: null | string
  state:
    | 'QUEUED'
    | 'PLANNING'
    | 'RUNNING'
    | 'WAITING_APPROVAL'
    | 'INTERRUPTED'
    | 'COMPLETED'
    | 'BLOCKED'
    | 'FAILED'
    | 'CANCELLED'
    | string
  task_id?: null | string
  plan_id?: null | string
  error?: null | string
  created_at: string
  updated_at: string
}

export interface AgentOSPendingApproval {
  id: string
  task_id: string
  action_id: string
  tool: string
  operation: string
  risk_level: string
  reason: string
  target: string
  requested_at: string
}
