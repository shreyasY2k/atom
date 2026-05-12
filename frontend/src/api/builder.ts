import type { AgentRecord, TraceEvent } from '../types'
import { getActorHeader } from '../context/AuthContext'

const BASE = 'http://localhost:8080'

const json = (r: Response) => {
  if (!r.ok) return r.json().then(e => Promise.reject(e))
  return r.json()
}

const actor = () => ({ 'X-Atom-Actor': getActorHeader() })

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
  listAgents: (): Promise<{ agents: AgentRecord[] }> =>
    fetch(`${BASE}/agents`, { headers: actor() }).then(json),

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

  compileAgent: (name: string): Promise<{ code: string; code_hash: string }> =>
    fetch(`${BASE}/agents/${name}/compile`, { method: 'POST', headers: actor() }).then(json),

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
}
