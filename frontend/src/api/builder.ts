import type { AgentRecord, TraceEvent } from '../types'
import { getActorHeader } from '../context/AuthContext'

const BASE = 'http://localhost:8080'

const json = (r: Response) => {
  if (!r.ok) return r.json().then(e => Promise.reject(e))
  return r.json()
}

const actor = () => ({ 'X-Atom-Actor': getActorHeader() })

export const builderApi = {
  // Agents
  listAgents: (): Promise<{ agents: AgentRecord[] }> =>
    fetch(`${BASE}/agents`, { headers: actor() }).then(json),

  getAgent: (name: string): Promise<AgentRecord> =>
    fetch(`${BASE}/agents/${name}`, { headers: actor() }).then(json),

  deployAgent: (name: string): Promise<AgentRecord> =>
    fetch(`${BASE}/agents/${name}/deploy`, { method: 'POST', headers: actor() }).then(json),

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
}
