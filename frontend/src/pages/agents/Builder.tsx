import React, { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import MonacoEditor from '@monaco-editor/react'
import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Collapse,
  IconButton, InputBase, MenuItem, Paper, Select, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TerminalIcon from '@mui/icons-material/Terminal'
import CodeIcon from '@mui/icons-material/Code'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import SendIcon from '@mui/icons-material/Send'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { builderApi } from '../../api/builder'
import type { AgentRecord, TraceEvent } from '../../types'

type Mode = 'ai' | 'cli' | 'yaml' | 'test'

const TEMPLATES: Record<string, string> = {
  kyc: `apiVersion: mphasis.platform/v1
kind: AgentDeployment
metadata:
  name: my-kyc-agent
  domain: banking-kyc
  version: 1.0.0
  description: KYC refresh agent
  owner: user:platform@example.com
spec:
  agents:
    - name: kyc-analyst
      role: standalone
      skill: skills/ats/kyc-refresh.skill.md
      model: gemini-3.1-pro
      temperature: 1.0
      reasoning_effort: medium
      max_iterations: 6
      tools:
        - get_customer_profile
        - get_kyc_documents
        - get_external_screening
      memory:
        type: short_term
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/my-kyc-agent
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1`,
  recon: `apiVersion: mphasis.platform/v1
kind: AgentDeployment
metadata:
  name: my-recon-agent
  domain: banking-securities-ops
  version: 1.0.0
  description: Asset reconciliation agent
  owner: user:platform@example.com
spec:
  agents:
    - name: recon-analyst
      role: standalone
      skill: skills/ats/asset-recon.skill.md
      model: gemini-3.1-pro
      temperature: 1.0
      reasoning_effort: medium
      max_iterations: 6
      tools:
        - get_customer_positions
        - get_security_master
        - check_position_lots
      memory:
        type: short_term
  flow:
    type: standalone
  audit:
    log_to: minio://audit-logs/agent/my-recon-agent
    retention_days: 90
  deployment:
    runtime: agentscope
    sandbox: base
    replicas: 1`,
}

// ── AI Builder mode ─────────────────────────────────────────────────────────

function AIMode() {
  const qc = useQueryClient()
  const [prose, setProse] = useState('')
  const [specYaml, setSpecYaml] = useState('')
  const [skillContent, setSkillContent] = useState('')
  const [agentName, setAgentName] = useState('')
  const [deployResult, setDeployResult] = useState<AgentRecord | null>(null)
  const [error, setError] = useState('')

  const generate = useMutation({
    mutationFn: () => builderApi.generateSpec(prose),
    onSuccess: (d) => { setSpecYaml(d.spec_yaml); setSkillContent(d.skill_content ?? ''); setAgentName(d.name); setError('') },
    onError: (e: unknown) => setError(String(e)),
  })

  const deploy = useMutation({
    mutationFn: () => builderApi.deployAgent(agentName),
    onSuccess: (d) => { setDeployResult(d); qc.invalidateQueries({ queryKey: ['agents'] }); setError('') },
    onError: (e: unknown) => setError(String(e)),
  })

  return (
    <Stack spacing={2}>
      <TextField
        multiline
        rows={4}
        label="Describe the agent you want to build"
        placeholder="e.g. An agent that refreshes KYC for a bank customer before a securities transfer — it pulls their profile, checks document staleness, runs adverse media screening, and returns a confidence score."
        value={prose}
        onChange={(e) => setProse(e.target.value)}
        fullWidth
        variant="outlined"
        sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
      />

      <Box>
        <Button
          variant="contained"
          startIcon={generate.isPending ? <CircularProgress size={14} color="inherit" /> : <AutoFixHighIcon />}
          onClick={() => generate.mutate()}
          disabled={!prose.trim() || generate.isPending}
        >
          Generate Spec
        </Button>
      </Box>

      {specYaml && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, height: 320 }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" fontFamily="monospace">agent-spec.yaml</Typography>
                <Typography variant="caption" color="primary.main">editable</Typography>
              </Box>
              <Box sx={{ flex: 1 }}>
                <MonacoEditor height="100%" language="yaml" value={specYaml} onChange={(v) => setSpecYaml(v ?? '')} theme="vs-dark" options={{ fontSize: 11, minimap: { enabled: false }, scrollBeyondLastLine: false }} />
              </Box>
            </Paper>
            <Paper variant="outlined" sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', borderColor: 'rgba(124,58,237,0.4)' }}>
              <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" fontFamily="monospace" sx={{ color: '#a78bfa' }}>skill file (auto-generated)</Typography>
                <Typography variant="caption" color="text.secondary">editable</Typography>
              </Box>
              <Box sx={{ flex: 1 }}>
                <MonacoEditor height="100%" language="markdown" value={skillContent} onChange={(v) => setSkillContent(v ?? '')} theme="vs-dark" options={{ fontSize: 11, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on' }} />
              </Box>
            </Paper>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Button
              variant="contained"
              color="success"
              startIcon={deploy.isPending ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlineIcon />}
              onClick={() => deploy.mutate()}
              disabled={deploy.isPending || !agentName}
            >
              Compile &amp; Deploy
            </Button>
            <Typography variant="caption" color="text.secondary">
              Deploys <Box component="span" fontFamily="monospace">{agentName}</Box> — issues a service-account identity
            </Typography>
          </Box>
        </>
      )}

      {error && <Alert severity="error" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}><pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre></Alert>}

      {deployResult && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CheckCircleOutlineIcon color="success" fontSize="small" />
            <Typography variant="body2" fontWeight={600}>Agent deployed</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary">
            <Box component="span" fontFamily="monospace">{deployResult.name}</Box> v{deployResult.version}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
            <Typography variant="caption" color="text.secondary">Non-human identity:</Typography>
            <Chip label={deployResult.service_account_id} size="small" sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', fontSize: '0.65rem' }} />
          </Box>
          <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            owner: {deployResult.owner} · endpoint: {deployResult.endpoint}
          </Typography>
        </Paper>
      )}
    </Stack>
  )
}

// ── CLI Scaffold mode ────────────────────────────────────────────────────────

function CLIMode() {
  const { data } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const qc = useQueryClient()
  const deploy = useMutation({
    mutationFn: builderApi.deployAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Scaffold a new agent from the CLI</Typography>
        <Paper variant="outlined" sx={{ p: 2, fontFamily: 'monospace', fontSize: '0.875rem', bgcolor: 'background.default' }}>
          <Typography component="span" color="text.secondary">$ </Typography>
          atom agent scaffold <Box component="span" color="primary.main">&lt;agent-name&gt;</Box>
          {' '}--domain <Box component="span" sx={{ color: '#60a5fa' }}>banking-kyc</Box>
        </Paper>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Creates <code>specs/agents/&lt;name&gt;.yaml</code> and <code>skills/&lt;domain&gt;/&lt;name&gt;.skill.md</code> stubs.
          Fill in the spec, then deploy below.
        </Typography>
      </Box>

      <Box>
        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Agents in specs/agents/ — deploy any:</Typography>
        <Stack spacing={1}>
          {['kyc-refresh', 'asset-recon', 'treasury-liquidity-briefing', 'insurance-claim-ocr'].map((name) => {
            const record = data?.agents.find((a) => a.name === name)
            return (
              <Paper key={name} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" fontFamily="monospace">{name}</Typography>
                  {record?.service_account_id && (
                    <Chip label={record.service_account_id} size="small" sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', fontSize: '0.6rem', height: 18 }} />
                  )}
                </Box>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => deploy.mutate(name)}
                  disabled={deploy.isPending}
                  startIcon={deploy.isPending && deploy.variables === name ? <CircularProgress size={11} color="inherit" /> : undefined}
                >
                  {record?.status === 'deployed' ? 'Redeploy' : 'Deploy'}
                </Button>
              </Paper>
            )
          })}
        </Stack>
      </Box>
    </Stack>
  )
}

// ── Edit YAML mode ───────────────────────────────────────────────────────────

function YAMLMode() {
  const qc = useQueryClient()
  const [template, setTemplate] = useState('kyc')
  const [yamlVal, setYamlVal] = useState(TEMPLATES.kyc)
  const [validateResult, setValidateResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [deployResult, setDeployResult] = useState<AgentRecord | null>(null)

  const validate = useMutation({
    mutationFn: () => builderApi.validateSpec(yamlVal),
    onSuccess: (d) => { setValidateResult(d as Record<string, unknown>); setError('') },
    onError: (e: unknown) => setError(String(e)),
  })

  const agentName = yamlVal.match(/\s+name:\s+(\S+)/)?.[1] ?? ''
  const deploy = useMutation({
    mutationFn: () => builderApi.deployAgent(agentName),
    onSuccess: (d) => { setDeployResult(d); qc.invalidateQueries({ queryKey: ['agents'] }) },
    onError: (e: unknown) => setError(String(e)),
  })

  return (
    <Stack spacing={2}>
      <Select
        size="small"
        value={template}
        onChange={(e) => { setTemplate(e.target.value); setYamlVal(TEMPLATES[e.target.value]) }}
        sx={{ width: 220 }}
      >
        <MenuItem value="kyc">KYC Refresh template</MenuItem>
        <MenuItem value="recon">Asset Recon template</MenuItem>
      </Select>

      <Paper variant="outlined" sx={{ height: 256, overflow: 'hidden' }}>
        <MonacoEditor height="100%" language="yaml" value={yamlVal} onChange={(v) => setYamlVal(v ?? '')} theme="vs-dark" options={{ fontSize: 11, minimap: { enabled: false } }} />
      </Paper>

      <Box sx={{ display: 'flex', gap: 1.5 }}>
        <Button size="small" variant="outlined" onClick={() => validate.mutate()} disabled={validate.isPending}
          startIcon={validate.isPending ? <CircularProgress size={12} /> : undefined}>
          Validate
        </Button>
        <Button size="small" variant="contained" onClick={() => deploy.mutate()} disabled={deploy.isPending || !agentName}
          startIcon={deploy.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
          Deploy
        </Button>
      </Box>

      {validateResult && <Alert severity="success" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>Valid — {JSON.stringify(validateResult)}</Alert>}
      {deployResult && (
        <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleOutlineIcon color="success" fontSize="small" />
          <Typography variant="body2">Deployed <Box component="span" fontFamily="monospace" sx={{ color: '#a78bfa' }}>{deployResult.service_account_id}</Box></Typography>
        </Paper>
      )}
      {error && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{error}</Alert>}
    </Stack>
  )
}

// ── Test Mode (chat + inline trace) ──────────────────────────────────────────

interface TestMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  raw?: Record<string, unknown>
  runId?: string
  isError?: boolean
  durationMs?: number
}

function formatResult(raw: Record<string, unknown>): string {
  if (typeof raw.raw_output === 'string') return raw.raw_output
  if (raw.confidence != null && raw.recommendation) {
    const lines = [`**Confidence:** ${(Number(raw.confidence) * 100).toFixed(0)}%  **Recommendation:** \`${raw.recommendation}\``]
    if (raw.customer_id) lines.push(`**Customer:** ${raw.customer_id}`)
    if (Array.isArray(raw.issues_found) && raw.issues_found.length)
      lines.push(`**Issues:** ${(raw.issues_found as Record<string, string>[]).map((i) => `${i.code}(${i.severity})`).join(', ')}`)
    if (raw.notes_for_reviewer) lines.push(`**Notes:** ${raw.notes_for_reviewer}`)
    return lines.join('\n')
  }
  return JSON.stringify(raw, null, 2)
}

function RichText({ text }: { text: string }) {
  if (!text.includes('**')) return <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}>{text}</Typography>
  return (
    <Box>
      {text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <div key={i}>
            {parts.map((p, j) => p.startsWith('**') && p.endsWith('**')
              ? <strong key={j}>{p.slice(2, -2)}</strong>
              : <span key={j}>{p}</span>)}
          </div>
        )
      })}
    </Box>
  )
}

function TracePane({ runId, agentName }: { runId: string; agentName: string }) {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['trace', agentName, runId],
    queryFn: () => builderApi.getRunEvents(agentName, runId),
    enabled: open,
    staleTime: Infinity,
  })
  const events: TraceEvent[] = data?.events ?? []
  const llmCount = events.filter((e) => e.event_type === 'llm_call').length
  const toolCount = events.filter((e) => e.event_type === 'tool_call').length
  const totalMs = events.reduce((s, e) => s + (e.duration_ms ?? 0), 0)

  return (
    <Box sx={{ mt: 0.75 }}>
      <Box
        component="button"
        onClick={() => setOpen((v) => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'text.secondary', fontSize: '0.72rem', p: 0,
          '&:hover': { color: 'text.primary' },
        }}
      >
        {open ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        Trace
        {(llmCount > 0 || toolCount > 0) && (
          <Typography variant="caption" color="text.secondary">
            · {llmCount} LLM call{llmCount !== 1 ? 's' : ''} · {toolCount} tool call{toolCount !== 1 ? 's' : ''}{totalMs > 0 ? ` · ${(totalMs / 1000).toFixed(1)}s` : ''}
          </Typography>
        )}
      </Box>
      <Collapse in={open}>
        {isLoading && <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>Loading trace…</Typography>}
        {!isLoading && events.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ pl: 2 }}>
            No trace events found (run may be too recent or MinIO indexing in progress).
          </Typography>
        )}
        <Box sx={{ mt: 0.75, display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
          {events.map((ev, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', py: 0.5, px: 1, borderLeft: 2, borderColor: ev.event_type === 'tool_call' ? 'primary.light' : 'secondary.light', bgcolor: 'action.hover', borderRadius: '0 4px 4px 0' }}>
              <Chip
                label={ev.event_type === 'tool_call' ? 'TOOL' : 'LLM'}
                size="small"
                color={ev.event_type === 'tool_call' ? 'primary' : 'secondary'}
                variant="outlined"
                sx={{ height: 18, fontSize: '0.6rem', flexShrink: 0 }}
              />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" fontFamily="monospace" sx={{ display: 'block' }}>
                  {ev.event_type === 'tool_call' ? ev.tool_name ?? 'tool' : ev.model ?? 'llm'}
                </Typography>
                {(ev.input_tokens != null || ev.output_tokens != null) && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {ev.input_tokens ?? '?'} in · {ev.output_tokens ?? '?'} out
                  </Typography>
                )}
              </Box>
              {ev.duration_ms != null && (
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontSize: '0.65rem' }}>
                  {ev.duration_ms}ms
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

function TestMode({ initialAgent }: { initialAgent?: string }) {
  const { data } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const deployed = (data?.agents ?? []).filter((a) => a.status === 'deployed')
  const [selectedName, setSelectedName] = useState(initialAgent ?? deployed[0]?.name ?? '')
  const selected = deployed.find((a) => a.name === selectedName) ?? null

  useEffect(() => {
    if (!selectedName && deployed.length > 0) setSelectedName(deployed[0].name)
  }, [deployed, selectedName])

  const [messages, setMessages] = useState<TestMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  // Clear history when agent changes
  useEffect(() => { setMessages([]) }, [selectedName])

  const send = async (text: string) => {
    if (!text.trim() || !selected || loading) return
    setMessages((prev) => [...prev, { id: Date.now().toString(), role: 'user', content: text }])
    setInput('')
    setLoading(true)
    const t0 = Date.now()
    try {
      const { result, run_id } = await builderApi.invokeAgent(selected.name, { text })
      const raw = result as Record<string, unknown>
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: formatResult(raw),
        raw,
        runId: run_id,
        durationMs: Date.now() - t0,
      }])
    } catch (e) {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `Error: ${String(e)}`,
        isError: true,
        durationMs: Date.now() - t0,
      }])
    } finally {
      setLoading(false)
    }
  }

  const studioUrl = `${window.location.protocol}//${window.location.hostname}:3000`
  const reasoningMode = (selected as AgentRecord & { reasoning_mode?: string })?.reasoning_mode ?? 'prescribed'
  const samplePrompts: string[] = (selected as AgentRecord & { sample_prompts?: string[] })?.sample_prompts ?? []

  if (deployed.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          No deployed agents yet. Use AI Builder or CLI Scaffold to deploy one first.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: 520 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
        <Select
          size="small"
          value={selectedName}
          onChange={(e) => setSelectedName(e.target.value)}
          sx={{ minWidth: 200, fontSize: '0.8rem' }}
        >
          {deployed.map((a) => (
            <MenuItem key={a.name} value={a.name} sx={{ fontSize: '0.8rem' }}>
              {a.name}
            </MenuItem>
          ))}
        </Select>
        {selected && (
          <>
            <Chip
              label={reasoningMode}
              size="small"
              variant="outlined"
              sx={{
                fontSize: '0.65rem', height: 20,
                color: reasoningMode === 'guided' ? 'primary.main' : 'text.secondary',
                borderColor: reasoningMode === 'guided' ? 'primary.main' : 'divider',
              }}
            />
            <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize: '0.62rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selected.service_account_id}
            </Typography>
            <Tooltip title="Open in AgentScope Studio (engineer view)">
              <IconButton size="small" component="a" href={studioUrl} target="_blank" rel="noopener">
                <OpenInNewIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Box>

      {/* Sample prompts */}
      {samplePrompts.length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
          {samplePrompts.map((p) => (
            <Chip
              key={p}
              label={p}
              size="small"
              variant="outlined"
              onClick={() => send(p)}
              sx={{ cursor: 'pointer', fontSize: '0.7rem', height: 22, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
          ))}
        </Box>
      )}

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
        {messages.length === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 1.5, textAlign: 'center' }}>
            <Avatar sx={{ width: 40, height: 40, bgcolor: 'primary.dark' }}>
              <SmartToyIcon sx={{ fontSize: 20 }} />
            </Avatar>
            <Typography variant="caption" color="text.secondary">
              Type a message or click a sample prompt to invoke this agent.
            </Typography>
          </Box>
        )}
        {messages.map((msg) => (
          <Box key={msg.id}>
            {msg.role === 'user' ? (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Paper sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1, borderRadius: '16px 16px 4px 16px', maxWidth: '72%' }}>
                  <Typography variant="body2">{msg.content}</Typography>
                </Paper>
              </Box>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'flex-start' }}>
                <Avatar sx={{ width: 26, height: 26, bgcolor: msg.isError ? 'error.dark' : 'primary.dark', flexShrink: 0 }}>
                  <SmartToyIcon sx={{ fontSize: 14 }} />
                </Avatar>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="caption" fontWeight={600}>{selected?.name ?? 'agent'}</Typography>
                    <Chip
                      label={reasoningMode}
                      size="small"
                      sx={{ height: 16, fontSize: '0.58rem', color: reasoningMode === 'guided' ? 'primary.main' : 'text.secondary', bgcolor: reasoningMode === 'guided' ? 'primary.50' : 'action.hover' }}
                    />
                    {msg.durationMs != null && (
                      <Typography variant="caption" color="text.secondary">{msg.durationMs}ms</Typography>
                    )}
                  </Box>
                  <Paper
                    variant="outlined"
                    sx={{ px: 2, py: 1.25, borderRadius: '4px 16px 16px 16px', bgcolor: msg.isError ? '#fef2f2' : 'background.paper', borderColor: msg.isError ? 'error.light' : 'divider' }}
                  >
                    <Typography variant="body2" component="div"><RichText text={msg.content} /></Typography>
                  </Paper>
                  {msg.runId && selected && (
                    <TracePane runId={msg.runId} agentName={selected.name} />
                  )}
                </Box>
              </Box>
            )}
          </Box>
        ))}
        {loading && (
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <Avatar sx={{ width: 26, height: 26, bgcolor: 'primary.dark' }}>
              <CircularProgress size={12} color="inherit" />
            </Avatar>
            <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: '4px 16px 16px 16px', display: 'flex', gap: 0.5 }}>
              {[0, 120, 240].map((d) => (
                <Box key={d} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'bounce 1s ease-in-out infinite', animationDelay: `${d}ms`, '@keyframes bounce': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } } }} />
              ))}
            </Paper>
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      {/* Input */}
      <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.5, py: 0.75, borderRadius: 2.5, mt: 1 }}>
        <InputBase
          multiline
          maxRows={3}
          fullWidth
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
          placeholder={selected ? `Ask ${selected.name} anything… (Enter to send)` : 'Select an agent above'}
          disabled={!selected || loading}
          sx={{ fontSize: '0.875rem' }}
        />
        <IconButton size="small" color="primary" onClick={() => send(input)} disabled={!input.trim() || !selected || loading}>
          <SendIcon fontSize="small" />
        </IconButton>
      </Paper>
    </Box>
  )
}

// ── Main Builder ─────────────────────────────────────────────────────────────

export default function Builder() {
  const [mode, setMode] = useState<Mode>('ai')

  return (
    <Box sx={{ p: 4, maxWidth: 800 }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>Agent Builder</Typography>

      <ToggleButtonGroup
        value={mode}
        exclusive
        onChange={(_, v) => { if (v) setMode(v) }}
        size="small"
        sx={{ mb: 3 }}
      >
        <ToggleButton value="ai" sx={{ gap: 0.75, px: 2 }}>
          <AutoFixHighIcon fontSize="small" /> AI Builder
        </ToggleButton>
        <ToggleButton value="cli" sx={{ gap: 0.75, px: 2 }}>
          <TerminalIcon fontSize="small" /> CLI Scaffold
        </ToggleButton>
        <ToggleButton value="yaml" sx={{ gap: 0.75, px: 2 }}>
          <CodeIcon fontSize="small" /> Edit YAML
        </ToggleButton>
        <ToggleButton value="test" sx={{ gap: 0.75, px: 2 }}>
          <SmartToyIcon fontSize="small" /> Test ▶
        </ToggleButton>
      </ToggleButtonGroup>

      {mode === 'ai' && <AIMode />}
      {mode === 'cli' && <CLIMode />}
      {mode === 'yaml' && <YAMLMode />}
      {mode === 'test' && <TestMode />}
    </Box>
  )
}
