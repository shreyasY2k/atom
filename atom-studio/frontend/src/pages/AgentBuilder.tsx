import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import ShieldIcon from '@mui/icons-material/Shield'
import ListAltIcon from '@mui/icons-material/ListAlt'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import api from '@/lib/api'
import { useSnackbar } from '@/hooks/use-snackbar'
import { ModelPicker } from '@/components/ModelPicker'
import { SkillCard } from '@/components/SkillCard'
import { ToolCard } from '@/components/ToolCard'

interface Skill {
  id: string
  name: string
  description: string | null
  dir: string | null
  builtin: boolean
  is_active: boolean
}

interface Tool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

interface A2AAgent {
  id: string
  name: string
  description: string | null
}

type BuilderState = {
  intent: string
  model: string
  skills: string[]
  tools: string[]
  a2aAgents: string[]
  domainId: string
  ciTarget: 'gitlab' | 'local'
}

const ALWAYS_ON_SKILLS = ['atom-gate-calls', 'atom-audit']

const initial: BuilderState = {
  intent: '',
  model: 'gemini-2.5-flash',
  skills: [...ALWAYS_ON_SKILLS],
  tools: [],
  a2aAgents: [],
  domainId: '',
  ciTarget: 'gitlab',
}

function toggle(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]
}

export function AgentBuilder() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [data, setData] = useState<BuilderState>(initial)
  const [analysing, setAnalysing] = useState(false)
  const { state: snack, show: showSnack, hide: hideSnack } = useSnackbar()

  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: async () => (await api.get('/api/skills/')).data,
  })

  const { data: tools = [] } = useQuery<Tool[]>({
    queryKey: ['tools'],
    queryFn: async () => {
      const resp = await api.get('/api/tools/')
      return Array.isArray(resp.data) ? resp.data : []
    },
  })

  const { data: domains = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['domains'],
    queryFn: async () => (await api.get('/api/domains/')).data,
  })

  const selectedDomainId = data.domainId || domains[0]?.id || ''

  const { data: a2aAgents = [] } = useQuery<A2AAgent[]>({
    queryKey: ['a2a-agents', selectedDomainId],
    queryFn: async () =>
      selectedDomainId
        ? (await api.get(`/api/builder/a2a-agents?domain_id=${selectedDomainId}`)).data
        : [],
    enabled: !!selectedDomainId,
  })

  const buildMutation = useMutation({
    mutationFn: async (payload: object) =>
      (await api.post('/api/agents/build-and-deploy', payload)).data,
    onSuccess: () => {
      showSnack('Agent provisioning started — check Agents for status updates.', 'success')
      navigate({ to: '/agents' })
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Unknown error'
      showSnack(`Build failed: ${msg}`, 'error')
    },
  })

  const analyseIntent = async () => {
    if (!data.intent.trim()) return
    setAnalysing(true)
    try {
      const resp = await api.post('/api/builder/analyse-intent', {
        intent: data.intent,
        domain_id: selectedDomainId,
      })
      const suggestion = resp.data
      setData(d => ({
        ...d,
        model: suggestion.model ?? d.model,
        skills: [...new Set([...ALWAYS_ON_SKILLS, ...(suggestion.skills ?? [])])],
        tools: suggestion.tools ?? d.tools,
      }))
      setStep(1)
    } catch {
      setStep(1)
    } finally {
      setAnalysing(false)
    }
  }

  const handleDeploy = () => {
    buildMutation.mutate({
      intent: data.intent,
      model: data.model,
      mcp_tools: data.tools,
      skills: data.skills,
      a2a_links: data.a2aAgents,
      domain_id: selectedDomainId,
      ci_config: { target: data.ciTarget },
    })
  }

  return (
    <Box sx={{ maxWidth: 680, mx: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Agent Builder</Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {[0, 1, 2].map(i => (
            <Box
              key={i}
              sx={{
                height: 8,
                width: 48,
                borderRadius: 4,
                bgcolor: i <= step ? 'primary.main' : 'grey.300',
                transition: 'background-color 0.2s',
              }}
            />
          ))}
        </Box>
      </Box>

      {/* Step 0: Intent */}
      {step === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Step 1 — What should this agent do?</Typography>
            <Typography variant="body2" color="text.secondary">Describe the agent's purpose in plain language.</Typography>
          </Box>

          {domains.length > 1 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5 }}>Domain</Typography>
              <select
                style={{ width: '100%', border: '1px solid #ccc', borderRadius: 8, padding: '8px 12px', fontSize: 14 }}
                value={data.domainId || selectedDomainId}
                onChange={e => setData(d => ({ ...d, domainId: e.target.value }))}
              >
                {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Box>
          )}

          <TextField
            placeholder="Monitor credit applications, flag high-risk ones and escalate to a human reviewer…"
            multiline
            rows={5}
            value={data.intent}
            onChange={e => setData(d => ({ ...d, intent: e.target.value }))}
            fullWidth
          />
          <Button
            variant="contained"
            onClick={analyseIntent}
            disabled={!data.intent.trim() || analysing}
            startIcon={analysing ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {analysing ? 'Analysing…' : 'Analyse Intent →'}
          </Button>
        </Box>
      )}

      {/* Step 1: Capabilities */}
      {step === 1 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Step 2 — Suggested Capabilities</Typography>
            <Typography variant="body2" color="text.secondary">Review and edit the AI-generated suggestions.</Typography>
          </Box>

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>LLM Model</Typography>
            <ModelPicker value={data.model} onChange={m => setData(d => ({ ...d, model: m }))} />
          </Box>

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>Skills</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
              {skills.map(s => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  selected={data.skills.includes(s.name)}
                  onToggle={name => {
                    if (ALWAYS_ON_SKILLS.includes(name)) return
                    setData(d => ({ ...d, skills: toggle(d.skills, name) }))
                  }}
                />
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary">
              atom-gate-calls and atom-audit are always active.
            </Typography>
          </Box>

          {tools.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>MCP Tools</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
                {tools.map(t => (
                  <ToolCard
                    key={t.name}
                    tool={t}
                    selected={data.tools.includes(t.name)}
                    onToggle={name => setData(d => ({ ...d, tools: toggle(d.tools, name) }))}
                  />
                ))}
              </Box>
            </Box>
          )}

          {a2aAgents.length >= 2 && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>A2A Agents</Typography>
              <Typography variant="caption" color="text.secondary">All A2A calls are routed via GATE and audited.</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
                {a2aAgents.map(a => (
                  <Button
                    key={a.id}
                    size="small"
                    variant={data.a2aAgents.includes(a.id) ? 'contained' : 'outlined'}
                    onClick={() => setData(d => ({ ...d, a2aAgents: toggle(d.a2aAgents, a.id) }))}
                  >
                    {a.name}
                  </Button>
                ))}
              </Box>
            </Box>
          )}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1 }}>
            <Button variant="outlined" startIcon={<ChevronLeftIcon />} onClick={() => setStep(0)}>Back</Button>
            <Button variant="contained" endIcon={<ChevronRightIcon />} onClick={() => setStep(2)}>
              Review & Deploy
            </Button>
          </Box>
        </Box>
      )}

      {/* Step 2: Build & Deploy */}
      {step === 2 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Step 3 — Build & Deploy</Typography>

          <Card variant="outlined">
            <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2"><strong>Model:</strong> {data.model}</Typography>
              <Typography variant="body2"><strong>Skills:</strong> {data.skills.join(', ')}</Typography>
              {data.tools.length > 0 && <Typography variant="body2"><strong>Tools:</strong> {data.tools.join(', ')}</Typography>}
              {data.a2aAgents.length > 0 && <Typography variant="body2"><strong>A2A:</strong> {data.a2aAgents.length} agent(s)</Typography>}
            </CardContent>
          </Card>

          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 1 }}>Build destination</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              {(['gitlab', 'local'] as const).map(target => (
                <Box
                  key={target}
                  component="button"
                  onClick={() => setData(d => ({ ...d, ciTarget: target }))}
                  sx={{
                    border: 1,
                    borderColor: data.ciTarget === target ? 'primary.main' : 'divider',
                    bgcolor: data.ciTarget === target ? 'primary.50' : 'transparent',
                    borderRadius: 1,
                    p: 2,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {target === 'gitlab' ? 'GitLab (private)' : 'Local Docker'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {target === 'gitlab' ? 'CI pipeline + approval flow' : 'Generate code locally'}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, bgcolor: 'grey.50' }}>
            <ShieldIcon fontSize="small" color="primary" />
            <Typography variant="caption">Guardrails always active</Typography>
            <ListAltIcon fontSize="small" color="primary" />
            <Typography variant="caption">Audit always on</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
              JWT + Agent ID auto-provisioned
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1 }}>
            <Button variant="outlined" startIcon={<ChevronLeftIcon />} onClick={() => setStep(1)}>Back</Button>
            <Button
              variant="contained"
              startIcon={buildMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
              onClick={handleDeploy}
              disabled={buildMutation.isPending}
            >
              {buildMutation.isPending ? 'Building…' : 'Approve + Deploy'}
            </Button>
          </Box>
        </Box>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={hideSnack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={hideSnack} severity={snack.severity} variant="filled">
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
