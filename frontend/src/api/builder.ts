import type { AgentRecord, TraceEvent } from '../types'
import { getActorHeader } from '../context/AuthContext'

const BASE = 'http://localhost:8080'

const json = (r: Response) => {
  if (!r.ok) return r.json().then(e => Promise.reject(e))
  return r.json()
}

const actor = () => ({ 'X-Atom-Actor': getActorHeader() })

export interface AuthConfig {
  type: 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2'
  // api_key
  header_name?: string
  key?: string
  in_?: 'header' | 'query'
  param_name?: string
  // bearer
  token?: string
  // basic
  username?: string
  password?: string
  // oauth2
  grant_type?: 'client_credentials' | 'authorization_code'
  token_url?: string
  client_id?: string
  client_secret?: string
  scope?: string
  audience?: string
}

export interface ToolRecord {
  tool_id: string
  name: string
  display_name?: string
  description?: string
  scope: 'global' | 'agent'
  owner_agent?: string | null
  tool_type: 'http' | 'python' | 'mcp'
  // HTTP
  endpoint?: string | null
  method?: string
  // Python
  code?: string | null
  // MCP
  mcp_server_url?: string | null
  mcp_transport?: 'sse' | 'stdio'
  mcp_tool_names?: string[]
  // Auth
  auth_type?: string
  auth_config?: AuthConfig
  // Schema
  input_schema?: Record<string, unknown>
  output_schema?: Record<string, unknown>
  tags?: string[]
  domain?: string
  subdomain?: string
  created_by?: string
  created_at?: string
  updated_at?: string
}

export interface AttachmentItem {
  type: 'file' | 'url'
  file_id?: string
  name?: string
  content_type?: string
  url?: string
  /** client-only: upload progress 0-100 */
  uploading?: boolean
  error?: string
}

export interface SkillRecord {
  name: string
  content: string
}

export interface SessionRecord {
  session_id: string
  agent_name: string
  owner: string
  created_at: string
  updated_at: string
  status: 'active' | 'ended'
  reme_context?: string | null
  message_count?: number
  metadata?: Record<string, unknown>
}

export interface MessageRecord {
  message_id: string
  session_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  created_at: string
  run_id?: string | null
}

export interface DeploymentRecord {
  deployment_id: string
  target_type: 'agent' | 'workflow'
  target_name: string
  target_version: string
  spec_hash: string
  code_hash?: string | null
  requested_by: string
  requested_at: string
  approval_status: 'pending' | 'approved' | 'rejected' | 'bypassed' | 'changes_requested' | 'n/a'
  approved_by?: string | null
  approved_at?: string | null
  deploy_status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'undeployed'
  deployed_at?: string | null
  deploy_error?: string | null
  service_account_id?: string | null
  notes: string
  previous_request_id?: string | null
}

export const builderApi = {
  // Agents
  listAgents: (filters?: { domain?: string; subdomain?: string; status?: string }): Promise<{ agents: AgentRecord[] }> => {
    const params = new URLSearchParams()
    if (filters?.domain) params.set('domain', filters.domain)
    if (filters?.subdomain) params.set('subdomain', filters.subdomain)
    if (filters?.status) params.set('status', filters.status)
    const qs = params.toString()
    return fetch(`${BASE}/agents${qs ? '?' + qs : ''}`, { headers: actor() }).then(json)
  },

  getAgent: (name: string): Promise<AgentRecord> =>
    fetch(`${BASE}/agents/${name}`, { headers: actor() }).then(json),

  deployAgent: (name: string, specYaml?: string, skillContent?: string): Promise<AgentRecord> =>
    fetch(`${BASE}/agents/${name}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ spec_yaml: specYaml ?? null, skill_content: skillContent ?? null }),
    }).then(json),

  deleteAgent: (name: string): Promise<unknown> =>
    fetch(`${BASE}/agents/${name}`, { method: 'DELETE', headers: actor() }).then(json),

  invokeAgent: (name: string, payload: unknown): Promise<{ result: unknown; run_id: string }> =>
    fetch(`${BASE}/agents/${name}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(payload),
    }).then(json),

  getRunEvents: (name: string, runId: string): Promise<{ run_id: string; events: TraceEvent[]; raw_count: number }> =>
    fetch(`${BASE}/agents/${name}/runs/${runId}/events`, { headers: actor() }).then(json),

  listAgentRuns: (name: string): Promise<{ runs: { run_id: string; started_at: string; status: string }[] }> =>
    fetch(`${BASE}/agents/${name}/runs`, { headers: actor() }).then(json),

  // Specs
  validateSpec: (yaml_text: string): Promise<unknown> =>
    fetch(`${BASE}/specs/agent/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ yaml_text }),
    }).then(json),

  generateSpec: (prose: string): Promise<{ spec: unknown; spec_yaml: string; skill_content: string; skill_path: string; name: string; domain: string; spec_saved: string }> =>
    fetch(`${BASE}/specs/agent/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ prose }),
    }).then(json),

  compileAgent: (name: string, specYaml?: string, skillContent?: string): Promise<{ code: string; code_hash: string }> =>
    fetch(`${BASE}/agents/${name}/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ spec_yaml: specYaml ?? null, skill_content: skillContent ?? null }),
    }).then(json),

  // Deployment requests
  saveAgentSpec: (name: string, specYaml: string, skillContent?: string): Promise<{ saved: boolean }> =>
    fetch(`${BASE}/agents/${name}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      // Deploy with spec content but no further action — backend saves and returns early if we
      // just need persistence before a deploy-request. We use deploy endpoint as the save gate.
      body: JSON.stringify({ spec_yaml: specYaml, skill_content: skillContent ?? null }),
    }).then(json),

  submitDeployRequest: (name: string, notes = '', specYaml?: string, skillContent?: string): Promise<DeploymentRecord> =>
    fetch(`${BASE}/agents/${name}/deploy-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ notes, spec_yaml: specYaml ?? null, skill_content: skillContent ?? null }),
    }).then(json),

  deployDirect: (name: string, notes = '', specYaml?: string, skillContent?: string): Promise<DeploymentRecord> =>
    fetch(`${BASE}/agents/${name}/deploy-direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ notes, spec_yaml: specYaml ?? null, skill_content: skillContent ?? null }),
    }).then(json),

  listAgentDeployments: (name: string): Promise<{ deployments: DeploymentRecord[] }> =>
    fetch(`${BASE}/agents/${name}/deployments`, { headers: actor() }).then(json),

  listWorkflowDeployments: (name: string): Promise<{ deployments: DeploymentRecord[] }> =>
    fetch(`${BASE}/deployments?target_type=workflow&target_name=${encodeURIComponent(name)}`, { headers: actor() })
      .then(json)
      .then(d => ({ deployments: d.deployments ?? [] })),

  listDeployments: (params?: { approval_status?: string; requester?: string; target_type?: string; target_name?: string }): Promise<{ deployments: DeploymentRecord[]; total: number }> => {
    const qs = new URLSearchParams()
    if (params?.approval_status) qs.set('approval_status', params.approval_status)
    if (params?.requester) qs.set('requester', params.requester)
    if (params?.target_type) qs.set('target_type', params.target_type)
    if (params?.target_name) qs.set('target_name', params.target_name)
    return fetch(`${BASE}/deployments?${qs}`, { headers: actor() }).then(json)
  },

  approveDeployment: (id: string, notes = ''): Promise<DeploymentRecord> =>
    fetch(`${BASE}/deployments/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ notes }),
    }).then(json),

  rejectDeployment: (id: string, reason: string): Promise<DeploymentRecord> =>
    fetch(`${BASE}/deployments/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ reason }),
    }).then(json),

  requestChanges: (id: string, comments: string): Promise<DeploymentRecord> =>
    fetch(`${BASE}/deployments/${id}/request-changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ comments }),
    }).then(json),

  // New provisioning flow
  provisionAgent: (name: string, description: string): Promise<Record<string, unknown>> =>
    fetch(`${BASE}/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ name, description }),
    }).then(json),

  getAgentTools: (name: string): Promise<{ tools: ToolRecord[] }> =>
    fetch(`${BASE}/agents/${name}/tools`, { headers: actor() }).then(json),

  addAgentTool: (name: string, tool: Partial<ToolRecord>): Promise<{ tools: ToolRecord[] }> =>
    fetch(`${BASE}/agents/${name}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(tool),
    }).then(json),

  associateGlobalTool: (agentName: string, toolId: string): Promise<{ tools: ToolRecord[] }> =>
    fetch(`${BASE}/agents/${agentName}/tools/associate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ tool_id: toolId }),
    }).then(json),

  removeAgentTool: (agentName: string, toolId: string): Promise<{ tools: ToolRecord[] }> =>
    fetch(`${BASE}/agents/${agentName}/tools/${toolId}`, {
      method: 'DELETE', headers: actor(),
    }).then(json),

  getAgentSkills: (name: string): Promise<{ skills: SkillRecord[] }> =>
    fetch(`${BASE}/agents/${name}/skills`, { headers: actor() }).then(json),

  upsertSkill: (name: string, skillName: string, content: string): Promise<{ skills: SkillRecord[] }> =>
    fetch(`${BASE}/agents/${name}/skills`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ name: skillName, content }),
    }).then(json),

  deleteSkill: (agentName: string, skillName: string): Promise<{ skills: SkillRecord[] }> =>
    fetch(`${BASE}/agents/${agentName}/skills/${encodeURIComponent(skillName)}`, {
      method: 'DELETE', headers: actor(),
    }).then(json),

  generateAgent: (name: string, behavior: string): Promise<{ spec_yaml: string; role_md: string; status: string }> =>
    fetch(`${BASE}/agents/${name}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ behavior }),
    }).then(json),

  getDraft: (name: string): Promise<{ spec_yaml: string; role_md: string; has_draft: boolean }> =>
    fetch(`${BASE}/agents/${name}/draft`, { headers: actor() }).then(json),

  startEdit: (name: string): Promise<{ status: string; base_version: number }> =>
    fetch(`${BASE}/agents/${name}/edit`, { method: 'POST', headers: actor() }).then(json),

  // Compliance reports
  generateComplianceReport: (name: string, periodDays = 30, notes = ''): Promise<{ report_id: string; status: string }> =>
    fetch(`${BASE}/agents/${name}/compliance-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ period_days: periodDays, notes }),
    }).then(json),

  getComplianceReport: (name: string, reportId: string): Promise<{ status: string; report_md?: string; created_at?: string }> =>
    fetch(`${BASE}/agents/${name}/compliance-report/${reportId}`, { headers: actor() }).then(json),

  listComplianceReports: (name: string): Promise<{ reports: { report_id: string; status: string; created_at: string; period_start: string; period_end: string }[] }> =>
    fetch(`${BASE}/agents/${name}/compliance-reports`, { headers: actor() }).then(json),

  // Domains taxonomy
  listDomains: (): Promise<{ domains: { domain: string; subdomains: string[] }[] }> =>
    fetch(`${BASE}/domains`, { headers: actor() }).then(json),

  // Tools registry
  listGlobalTools: (filters?: { domain?: string; subdomain?: string }): Promise<{ tools: ToolRecord[] }> => {
    const params = new URLSearchParams()
    if (filters?.domain) params.set('domain', filters.domain)
    if (filters?.subdomain) params.set('subdomain', filters.subdomain)
    const qs = params.toString()
    return fetch(`${BASE}/tools${qs ? '?' + qs : ''}`, { headers: actor() }).then(json)
  },

  createGlobalTool: (tool: Partial<ToolRecord>): Promise<ToolRecord> =>
    fetch(`${BASE}/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(tool),
    }).then(json),

  updateGlobalTool: (toolId: string, tool: Partial<ToolRecord>): Promise<ToolRecord> =>
    fetch(`${BASE}/tools/${toolId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(tool),
    }).then(json),

  deleteGlobalTool: (toolId: string): Promise<unknown> =>
    fetch(`${BASE}/tools/${toolId}`, { method: 'DELETE', headers: actor() }).then(json),

  executeGlobalTool: (toolId: string, input: Record<string, unknown>): Promise<{ result: unknown }> =>
    fetch(`${BASE}/tools/${toolId}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ input }),
    }).then(json),

  // Sessions
  createSession: (agentName: string, workspaceId?: string): Promise<{ session_id: string; status: string; reme_context?: string }> =>
    fetch(`${BASE}/agents/${agentName}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ workspace_id: workspaceId ?? null, metadata: {} }),
    }).then(json),

  listSessions: (agentName: string): Promise<{ sessions: SessionRecord[]; total: number }> =>
    fetch(`${BASE}/agents/${agentName}/sessions`, { headers: actor() }).then(json),

  getSession: (agentName: string, sessionId: string): Promise<SessionRecord & { messages: MessageRecord[] }> =>
    fetch(`${BASE}/agents/${agentName}/sessions/${sessionId}`, { headers: actor() }).then(json),

  sendMessage: (
    agentName: string,
    sessionId: string,
    text: string,
    workspaceId?: string,
    attachments?: AttachmentItem[],
  ): Promise<{ session_id: string; run_id: string; role: string; content: string; result: unknown }> =>
    fetch(`${BASE}/agents/${agentName}/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ text, workspace_id: workspaceId ?? null, attachments: attachments ?? [] }),
    }).then(json),

  uploadFile: (file: File): Promise<{ file_id: string; original_name: string; content_type: string; size: number; minio_key: string }> => {
    const fd = new FormData()
    fd.append('file', file)
    return fetch(`${BASE}/files/upload`, { method: 'POST', headers: actor(), body: fd }).then(json)
  },

  extractUrl: (url: string): Promise<{ url: string; format: string; text: string }> =>
    fetch(`${BASE}/files/extract-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ url }),
    }).then(json),

  endSession: (agentName: string, sessionId: string): Promise<{ status: string }> =>
    fetch(`${BASE}/agents/${agentName}/sessions/${sessionId}`, {
      method: 'DELETE', headers: actor(),
    }).then(json),

  getAgentSwagger: (agentName: string): Promise<Record<string, unknown>> =>
    fetch(`${BASE}/agents/${agentName}/swagger`, { headers: actor() }).then(json),
}
