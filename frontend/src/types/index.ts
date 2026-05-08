// ---- Agent types ----

export interface AgentRecord {
  name: string
  version: string
  service_account_id: string
  owner: string
  deployed_at: string
  endpoint: string
  spec_hash: string
  code_hash: string
  status: 'deployed' | 'undeployed' | 'deploying'
  reasoning_mode?: 'prescribed' | 'guided'
  sample_prompts?: string[]
}

export interface TraceEvent {
  event_type: 'llm_call' | 'tool_call'
  model?: string
  input_tokens?: number
  output_tokens?: number
  duration_ms?: number
  timestamp?: string
  tool_name?: string
}

// ---- Workflow types ----

export interface WorkflowNode {
  id: string
  label: string
  type: 'agent' | 'http' | 'decision' | 'human_task'
  next?: string | null
  branches?: Record<string, string | null>
  // agent
  agent_ref?: { name: string; version: string }
  input_mapping?: Record<string, string>
  output_capture?: string
  confidence_threshold?: number
  fallback_node?: string
  // http
  method?: string
  url_template?: string
  body_template?: Record<string, unknown>
  timeout_seconds?: number
  // decision
  expression?: string
  // human_task
  assignee_group?: string
  task_template?: { title: string; description: string; actions: string[] }
  sla_seconds?: number
  // runtime (set by UI)
  _serviceAccountId?: string
  _nodeState?: 'running' | 'completed' | 'paused' | 'error'
  _outputSummary?: Record<string, unknown>
}

export interface WorkflowSpec {
  apiVersion: string
  kind: string
  metadata: {
    name: string
    domain: string
    version: string
    description: string
    owner: string
    // visual layout persisted alongside the spec
    layout?: { nodes: Record<string, { x: number; y: number }> }
    // sample inputs for the run pane
    sample_inputs?: { label: string; input: Record<string, unknown> }[]
  }
  spec: {
    input_schema?: {
      type: string
      required?: string[]
      properties?: Record<string, { type: string; enum?: string[]; items?: unknown }>
    }
    nodes: WorkflowNode[]
    audit: { log_to: string; retention_days: number }
    deployment: { runtime: string; task_queue: string }
  }
}

export interface WorkflowRecord {
  name: string
  version: string
  domain: string
  task_queue: string
  registered_at: string
  spec_hash: string
  status: string
}

// ---- Run types ----

export interface RunRecord {
  run_id: string
  workflow_name: string
  status: string
  started_at: string
  input?: Record<string, unknown>
}

export type NodeState = 'running' | 'completed' | 'paused' | 'error'

export interface SSEEvent {
  event: string
  run_id: string
  node_id?: string
  from?: string
  to?: string
  actor_type?: string
  actor_id?: string
  output_summary?: Record<string, unknown>
  duration_ms?: number
  reason?: string
  task_id?: string
}

// ---- Task types ----

export interface Task {
  task_id: string
  workflow_run_id: string
  node_id: string
  assignee_group: string
  title: string
  description: string
  actions: string[]
  context: Record<string, unknown>
  status: 'OPEN' | 'RESOLVED'
  created_at: string
  resolved_at?: string
  resolved_by?: string
  resolution?: string
}

// ---- Audit types ----

export interface AuditEvent {
  id: string
  timestamp: string
  source: 'llm' | 'workflow'
  event_type: string
  actor_type: 'agent' | 'human' | 'system'
  actor_id: string
  model?: string | null
  input_tokens?: number | null
  output_tokens?: number | null
  duration_ms?: number | null
  run_id?: string | null
  node_id?: string | null
  raw: Record<string, unknown>
}
