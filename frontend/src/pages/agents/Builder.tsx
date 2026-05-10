import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import MonacoEditor from '@monaco-editor/react'
import {
  Alert, Box, Button, Chip, CircularProgress,
  MenuItem, Paper, Select, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Typography, useTheme,
} from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TerminalIcon from '@mui/icons-material/Terminal'
import CodeIcon from '@mui/icons-material/Code'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ChatIcon from '@mui/icons-material/Chat'
import { builderApi, type DeploymentRecord } from '../../api/builder'
import { useAuth } from '../../context/AuthContext'
import type { AgentRecord } from '../../types'

type Mode = 'ai' | 'cli' | 'yaml'

const TEMPLATES: Record<string, string> = {
  kyc: `apiVersion: atom.platform/v1
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
  recon: `apiVersion: atom.platform/v1
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
  const navigate = useNavigate()
  const qc = useQueryClient()
  const theme = useTheme()
  const monacoTheme = theme.palette.mode === 'dark' ? 'vs-dark' : 'vs'

  const [prose, setProse] = useState('')
  const [specYaml, setSpecYaml] = useState('')
  const [skillContent, setSkillContent] = useState('')
  const [agentName, setAgentName] = useState('')
  const [deployResult, setDeployResult] = useState<AgentRecord | DeploymentRecord | null>(null)
  const [error, setError] = useState('')
  const { role } = useAuth()

  const generate = useMutation({
    mutationFn: () => builderApi.generateSpec(prose),
    onSuccess: (d) => { setSpecYaml(d.spec_yaml); setSkillContent(d.skill_content ?? ''); setAgentName(d.name); setError('') },
    onError: (e: unknown) => setError(String(e)),
  })

  const deploy = useMutation({
    mutationFn: (): Promise<AgentRecord | DeploymentRecord> => {
      if (role === 'builder') return builderApi.submitDeployRequest(agentName)
      if (role === 'platform_admin') return builderApi.deployDirect(agentName)
      return builderApi.deployAgent(agentName)
    },
    onSuccess: (d) => { setDeployResult(d); qc.invalidateQueries({ queryKey: ['agents'] }); setError('') },
    onError: (e: unknown) => setError(String(e)),
  })

  const deployLabel = role === 'builder'
    ? 'Compile & Submit for Approval'
    : role === 'platform_admin'
      ? 'Compile & Deploy (bypass)'
      : 'Compile & Deploy'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>
      {/* Input row — fixed height */}
      <Box sx={{ flexShrink: 0 }}>
        <TextField
          multiline
          rows={3}
          label="Describe the agent you want to build"
          placeholder="e.g. An agent that refreshes KYC for a bank customer before a securities transfer — it pulls their profile, checks document staleness, runs adverse media screening, and returns a confidence score."
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          fullWidth
          variant="outlined"
          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
        />
      </Box>

      <Box sx={{ flexShrink: 0 }}>
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
          {/* Editor grid — grows to fill remaining space */}
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, flex: 1, minHeight: 0 }}>
            <Paper variant="outlined" sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                <Typography variant="caption" fontFamily="monospace">agent-spec.yaml</Typography>
                <Typography variant="caption" color="primary.main">editable</Typography>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <MonacoEditor
                  height="100%"
                  language="yaml"
                  value={specYaml}
                  onChange={(v) => setSpecYaml(v ?? '')}
                  theme={monacoTheme}
                  options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 8 } }}
                />
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ overflow: 'hidden', display: 'flex', flexDirection: 'column', borderColor: 'rgba(124,58,237,0.4)' }}>
              <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
                <Typography variant="caption" fontFamily="monospace" sx={{ color: '#a78bfa' }}>skill file (auto-generated)</Typography>
                <Typography variant="caption" color="text.secondary">editable</Typography>
              </Box>
              <Box sx={{ flex: 1, minHeight: 0 }}>
                <MonacoEditor
                  height="100%"
                  language="markdown"
                  value={skillContent}
                  onChange={(v) => setSkillContent(v ?? '')}
                  theme={monacoTheme}
                  options={{ fontSize: 13, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: 'on', padding: { top: 8 } }}
                />
              </Box>
            </Paper>
          </Box>

          {/* Deploy bar — fixed */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
            <Button
              variant="contained"
              color={role === 'builder' ? 'primary' : 'success'}
              startIcon={deploy.isPending ? <CircularProgress size={14} color="inherit" /> : <CheckCircleOutlineIcon />}
              onClick={() => deploy.mutate()}
              disabled={deploy.isPending || !agentName}
            >
              {deployLabel}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {role === 'builder'
                ? <>Submits <Box component="span" fontFamily="monospace">{agentName}</Box> for approval</>
                : <>Deploys <Box component="span" fontFamily="monospace">{agentName}</Box> — issues a service-account identity</>
              }
            </Typography>
          </Box>
        </>
      )}

      {/* Alerts — fixed */}
      {error && (
        <Alert severity="error" sx={{ flexShrink: 0, fontFamily: 'monospace', fontSize: '0.75rem' }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{error}</pre>
        </Alert>
      )}

      {deployResult && (
        <Paper variant="outlined" sx={{ p: 2, flexShrink: 0 }}>
          {'deployment_id' in deployResult ? (
            // Deployment request submitted
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CheckCircleOutlineIcon color="primary" fontSize="small" />
                <Typography variant="body2" fontWeight={600}>Deployment request submitted</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                Request ID: <Box component="span" fontFamily="monospace">{deployResult.deployment_id}</Box>
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                Waiting for approver to review. Check the Approvals tab for status updates.
              </Typography>
            </>
          ) : (
            // Deployed directly
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <CheckCircleOutlineIcon color="success" fontSize="small" />
                <Typography variant="body2" fontWeight={600}>Agent deployed</Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                <Box component="span" fontFamily="monospace">{(deployResult as AgentRecord).name}</Box> v{(deployResult as AgentRecord).version}
              </Typography>
              {(deployResult as AgentRecord).service_account_id && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">Non-human identity:</Typography>
                  <Chip label={(deployResult as AgentRecord).service_account_id} size="small" sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', fontSize: '0.65rem' }} />
                </Box>
              )}
              <Button
                size="small" variant="outlined" startIcon={<ChatIcon />}
                onClick={() => navigate(`/chat?agent=${(deployResult as AgentRecord).name}`)}
                sx={{ mt: 1.5 }}
              >
                Test in Chat →
              </Button>
            </>
          )}
        </Paper>
      )}
    </Box>
  )
}

// ── CLI Scaffold mode ────────────────────────────────────────────────────────

function CLIMode() {
  const navigate = useNavigate()
  const { data } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const qc = useQueryClient()
  const deploy = useMutation({
    mutationFn: builderApi.deployAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pr: 1 }}>
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
                  <Box sx={{ display: 'flex', gap: 0.75 }}>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => deploy.mutate(name)}
                      disabled={deploy.isPending}
                      startIcon={deploy.isPending && deploy.variables === name ? <CircularProgress size={11} color="inherit" /> : undefined}
                    >
                      {record?.status === 'deployed' ? 'Redeploy' : 'Deploy'}
                    </Button>
                    {record?.status === 'deployed' && (
                      <Button size="small" variant="outlined" startIcon={<ChatIcon />}
                        onClick={() => navigate(`/chat?agent=${name}`)}>
                        Test
                      </Button>
                    )}
                  </Box>
                </Paper>
              )
            })}
          </Stack>
        </Box>
      </Stack>
    </Box>
  )
}

// ── Edit YAML mode ───────────────────────────────────────────────────────────

function YAMLMode() {
  const qc = useQueryClient()
  const theme = useTheme()
  const monacoTheme = theme.palette.mode === 'dark' ? 'vs-dark' : 'vs'

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
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, gap: 2 }}>
      {/* Template selector — fixed */}
      <Box sx={{ flexShrink: 0 }}>
        <Select
          size="small"
          value={template}
          onChange={(e) => { setTemplate(e.target.value); setYamlVal(TEMPLATES[e.target.value]) }}
          sx={{ width: 220 }}
        >
          <MenuItem value="kyc">KYC Refresh template</MenuItem>
          <MenuItem value="recon">Asset Recon template</MenuItem>
        </Select>
      </Box>

      {/* Editor — fills remaining space */}
      <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <Typography variant="caption" fontFamily="monospace">agent-spec.yaml</Typography>
          <Typography variant="caption" color="primary.main">editable</Typography>
        </Box>
        <Box sx={{ flex: 1, minHeight: 0 }}>
          <MonacoEditor
            height="100%"
            language="yaml"
            value={yamlVal}
            onChange={(v) => setYamlVal(v ?? '')}
            theme={monacoTheme}
            options={{ fontSize: 13, minimap: { enabled: false }, padding: { top: 8 } }}
          />
        </Box>
      </Paper>

      {/* Actions — fixed */}
      <Box sx={{ display: 'flex', gap: 1.5, flexShrink: 0 }}>
        <Button size="small" variant="outlined" onClick={() => validate.mutate()} disabled={validate.isPending}
          startIcon={validate.isPending ? <CircularProgress size={12} /> : undefined}>
          Validate
        </Button>
        <Button size="small" variant="contained" onClick={() => deploy.mutate()} disabled={deploy.isPending || !agentName}
          startIcon={deploy.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}>
          Deploy
        </Button>
      </Box>

      {/* Results — fixed */}
      {validateResult && <Alert severity="success" sx={{ flexShrink: 0, fontFamily: 'monospace', fontSize: '0.75rem' }}>Valid — {JSON.stringify(validateResult)}</Alert>}
      {deployResult && (
        <Paper variant="outlined" sx={{ p: 1.5, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
          <CheckCircleOutlineIcon color="success" fontSize="small" />
          <Typography variant="body2">Deployed <Box component="span" fontFamily="monospace" sx={{ color: '#a78bfa' }}>{deployResult.service_account_id}</Box></Typography>
        </Paper>
      )}
      {error && <Alert severity="error" sx={{ flexShrink: 0, fontSize: '0.75rem' }}>{error}</Alert>}
    </Box>
  )
}

// ── Main Builder ─────────────────────────────────────────────────────────────

export default function Builder() {
  const [mode, setMode] = useState<Mode>('ai')

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', p: 3, overflow: 'hidden' }}>
      {/* Header — fixed */}
      <Box sx={{ flexShrink: 0, mb: 2 }}>
        <Typography variant="h6" fontWeight={600} gutterBottom>Agent Builder</Typography>
        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={(_, v) => { if (v) setMode(v) }}
          size="small"
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
        </ToggleButtonGroup>
      </Box>

      {/* Mode content — fills remaining height */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {mode === 'ai' && <AIMode />}
        {mode === 'cli' && <CLIMode />}
        {mode === 'yaml' && <YAMLMode />}
      </Box>
    </Box>
  )
}
