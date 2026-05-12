import type { AuditEvent, RunRecord, Task, WorkflowRecord, WorkflowSpec } from '../types'
import { getActorHeader } from '../context/AuthContext'

const BASE = 'http://localhost:8081'

const json = (r: Response) => {
  if (!r.ok) return r.json().then(e => Promise.reject(e))
  return r.json()
}

const actor = () => ({ 'X-Atom-Actor': getActorHeader() })

export const workflowApi = {
  // Workflows
  listWorkflows: (): Promise<{ workflows: WorkflowRecord[] }> =>
    fetch(`${BASE}/workflows`, { headers: actor() }).then(json),

  listWorkflowSpecs: (): Promise<{ specs: { name: string; version: string; domain: string; description: string; registered: boolean }[] }> =>
    fetch(`${BASE}/workflows/specs`, { headers: actor() }).then(json),

  getWorkflow: (name: string): Promise<WorkflowRecord> =>
    fetch(`${BASE}/workflows/${name}`, { headers: actor() }).then(json),

  getWorkflowSpec: (name: string): Promise<{ name: string; yaml: string }> =>
    fetch(`${BASE}/workflows/${name}/spec`, { headers: actor() }).then(json),

  registerWorkflow: (name: string, yaml_text?: string): Promise<unknown> =>
    fetch(`${BASE}/workflows/${name}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(yaml_text ? { yaml_text } : {}),
    }).then(json),

  saveWorkflowSpec: (name: string, yaml_text: string): Promise<unknown> =>
    fetch(`${BASE}/workflows/${name}/spec`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ yaml_text }),
    }).then(json),

  listRuns: (name: string, limit = 20): Promise<{ runs: RunRecord[] }> =>
    fetch(`${BASE}/workflows/${name}/runs?limit=${limit}`, { headers: actor() }).then(json),

  validateWorkflow: (yaml_text: string): Promise<unknown> =>
    fetch(`${BASE}/specs/workflow/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ yaml_text }),
    }).then(json),

  // Runs
  startRun: (name: string, payload: unknown): Promise<RunRecord> =>
    fetch(`${BASE}/workflows/${name}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify(payload),
    }).then(json),

  getRun: (name: string, runId: string): Promise<RunRecord> =>
    fetch(`${BASE}/workflows/${name}/runs/${runId}`, { headers: actor() }).then(json),

  cancelRun: (runId: string): Promise<unknown> =>
    fetch(`${BASE}/runs/${runId}/cancel`, { method: 'POST', headers: actor() }).then(json),

  // SSE event stream URL (used with EventSource — no actor header possible on EventSource)
  eventsUrl: (name: string, runId: string) =>
    `${BASE}/workflows/${name}/runs/${runId}/events`,

  // Tasks (proxied through workflow-backend)
  listTasks: (status = 'OPEN'): Promise<{ count: number; tasks: Task[] }> =>
    fetch(`${BASE}/tasks?status=${status}`, { headers: actor() }).then(json),

  resolveTask: (taskId: string, resolution: string): Promise<Task> =>
    fetch(`${BASE}/tasks/${taskId}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...actor() },
      body: JSON.stringify({ resolution, resolved_by: getActorHeader() }),
    }).then(json),

  // Audit
  listAuditEvents: (params?: {
    date?: string
    run_id?: string
    actor_type?: string
    limit?: number
  }): Promise<{ events: AuditEvent[]; total: number }> => {
    const qs = new URLSearchParams()
    if (params?.date) qs.set('date', params.date)
    if (params?.run_id) qs.set('run_id', params.run_id)
    if (params?.actor_type) qs.set('actor_type', params.actor_type)
    if (params?.limit) qs.set('limit', String(params.limit))
    return fetch(`${BASE}/audit/events?${qs}`, { headers: actor() }).then(json)
  },
}
