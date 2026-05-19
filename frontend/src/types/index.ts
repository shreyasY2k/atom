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
  agent_role_name?: string   // e.g. "kyc-analyst" for the kyc-refresh spec
  description?: string
  skills?: { name: string; content: string }[]
  version_count?: number
  domain?: string
  subdomain?: string
}

export interface TraceMessage {
  role: string
  content: string
}

export interface TraceToolCall {
  name: string
  arguments: string
}

export interface TraceEvent {
  event_type: 'llm_call' | 'tool_call'
  model?: string
  input_tokens?: number
  output_tokens?: number
  duration_ms?: number
  timestamp?: number
  tool_name?: string
  messages?: TraceMessage[]
  response_content?: string
  tool_calls?: TraceToolCall[]
}

// ---- Workflow types ----

export interface RetryConfig {
  max_attempts: number
  backoff: 'exponential' | 'linear' | 'constant'
  initial_delay_seconds?: number
  max_delay_seconds?: number
}

export interface AuthConfig {
  type: 'bearer' | 'basic' | 'api_key'
  token?: string
  username?: string
  password?: string
  header?: string
  key?: string
}

export interface DecisionCase {
  condition: string
  target: string
  label?: string
}

export interface EscalationPolicy {
  action: 'auto_approve' | 'auto_reject' | 'escalate'
  escalate_to_group?: string
}

export interface SkipCondition {
  condition: string
  auto_resolution: 'accept' | 'reject'
}

export interface WorkflowNode {
  id: string
  label: string
  type: 'agent' | 'http' | 'decision' | 'human_task'
  description?: string
  next?: string | null
  branches?: Record<string, string | null>
  on_error?: string
  timeout_seconds?: number
  retry?: RetryConfig
  tags?: string[]

  // agent
  agent_ref?: { name: string; version: string }
  input_mapping?: Record<string, string>
  output_capture?: string
  confidence_threshold?: number
  fallback_node?: string

  // http
  method?: string
  url_template?: string
  headers?: Record<string, string>
  body_template?: Record<string, unknown>
  auth?: AuthConfig
  extract?: Record<string, string>
  expect_status?: number[]

  // decision
  expression?: string
  cases?: DecisionCase[]
  default?: string

  // human_task
  assignee_group?: string
  assignee_individual?: string
  task_template?: { title: string; description: string; actions: string[] }
  sla_seconds?: number
  priority?: 'low' | 'medium' | 'high' | 'critical'
  evidence?: string[]
  form_schema?: Record<string, unknown>
  skip_if?: SkipCondition
  escalation_policy?: EscalationPolicy

  // runtime (set by UI, not serialised)
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

// ---- Guardrail types ----

export interface GuardrailLayerResult {
  layer: string
  verdict: string
  threat_level?: string
  message?: string
  processing_time_ms?: number
}

export interface GuardrailViolationError {
  error: 'guardrail_violation'
  guardrail: string
  phase: 'pre_call' | 'post_call'
  verdict: string
  threat_level: string
  blocked_by: string
  layers: GuardrailLayerResult[]
  message: string
}

export function isGuardrailViolation(err: unknown): err is GuardrailViolationError {
  return (
    typeof err === 'object' && err !== null &&
    (err as Record<string, unknown>).error === 'guardrail_violation'
  )
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
  hmac?: string | null          // hmac-sha256:{hex} if event was signed
  hmac_valid?: boolean | null   // client-side verified (when key available)
  raw: Record<string, unknown>
}
