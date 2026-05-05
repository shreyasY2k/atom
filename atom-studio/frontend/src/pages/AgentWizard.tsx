import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import FormLabel from '@mui/material/FormLabel'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import LinearProgress from '@mui/material/LinearProgress'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import api from '@/lib/api'
import { useSnackbar } from '@/hooks/use-snackbar'
import { TokenRevealModal } from '@/components/app/TokenRevealModal'

const TOTAL_STEPS = 7

const ALLOWED_MODEL_OPTIONS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gpt-4o', label: 'GPT-4o' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
]

type WizardData = {
  name: string
  description: string
  domainId: string
  allowedModels: string[]
  toolIds: string[]
  skillIds: string[]
  shortTermTtlS: number
  maxVectors: number
  embeddingModel: string
  hitlTimeoutSeconds: number
  hitlFallback: 'ABORT' | 'CONTINUE' | 'ESCALATE'
}

const initial: WizardData = {
  name: '',
  description: '',
  domainId: '',
  allowedModels: ['gemini-2.5-flash'],
  toolIds: [],
  skillIds: [],
  shortTermTtlS: 3600,
  maxVectors: 100000,
  embeddingModel: 'text-embedding-3-small',
  hitlTimeoutSeconds: 300,
  hitlFallback: 'ABORT',
}

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val]
}

export function AgentWizard() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [data, setData] = useState<WizardData>(initial)
  const [submitting, setSubmitting] = useState(false)
  const [revealToken, setRevealToken] = useState<{ token: string; agentId: string; domainId: string } | null>(null)
  const { state: snack, show: showSnack, hide: hideSnack } = useSnackbar()

  const up = (patch: Partial<WizardData>) => setData(d => ({ ...d, ...patch }))

  const { data: domains = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['domains'],
    queryFn: async () => (await api.get('/api/domains/')).data,
  })

  const { data: tools = [] } = useQuery<{ id: string; name: string; description: string | null }[]>({
    queryKey: ['tools'],
    queryFn: async () => (await api.get('/api/tools/')).data,
    enabled: step >= 3,
  })

  const { data: skills = [] } = useQuery<{ id: string; name: string; description: string | null }[]>({
    queryKey: ['skills'],
    queryFn: async () => (await api.get('/api/skills/')).data,
    enabled: step >= 4,
  })

  const canNext = () => {
    if (step === 0) return data.name.trim().length > 0
    if (step === 1) return data.domainId.length > 0
    if (step === 2) return data.allowedModels.length > 0
    return true
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const { data: result } = await api.post(
        `/api/domains/${data.domainId}/agents/`,
        {
          name: data.name,
          description: data.description || undefined,
          allowed_models: data.allowedModels,
          tool_ids: data.toolIds,
          skill_ids: data.skillIds,
          hitl_timeout_seconds: data.hitlTimeoutSeconds,
          hitl_fallback: data.hitlFallback,
          memory_config:
            data.maxVectors > 0
              ? {
                  short_term_ttl_s: data.shortTermTtlS,
                  max_vectors: data.maxVectors,
                  embedding_model: data.embeddingModel,
                }
              : undefined,
        },
      )
      setRevealToken({
        token: result.token,
        agentId: result.agent.id,
        domainId: data.domainId,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Agent creation failed.'
      showSnack(msg, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const stepTitles = [
    'Basic info',
    'Select domain',
    'Allowed models',
    'Tools',
    'Skills',
    'Memory',
    'HITL & Review',
  ]

  const renderStep = () => {
    switch (step) {
      case 0:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Agent name *"
              value={data.name}
              onChange={e => up({ name: e.target.value })}
              placeholder="my-agent"
              size="small"
              fullWidth
            />
            <TextField
              label="Description"
              value={data.description}
              onChange={e => up({ description: e.target.value })}
              placeholder="Optional description"
              size="small"
              fullWidth
            />
          </Box>
        )

      case 1:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormLabel>Domain</FormLabel>
            {domains.length === 0 ? (
              <Typography variant="body2" color="text.secondary">No domains yet. Create one first.</Typography>
            ) : (
              domains.map(d => (
                <Box
                  key={d.id}
                  component="label"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    border: 1,
                    borderColor: data.domainId === d.id ? 'primary.main' : 'divider',
                    borderRadius: 1,
                    p: 1.5,
                    cursor: 'pointer',
                    bgcolor: data.domainId === d.id ? 'primary.50' : 'transparent',
                  }}
                >
                  <input
                    type="radio"
                    name="domain"
                    value={d.id}
                    checked={data.domainId === d.id}
                    onChange={() => up({ domainId: d.id })}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{d.name}</Typography>
                </Box>
              ))
            )}
          </Box>
        )

      case 2:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormLabel>Allowed models</FormLabel>
            <Typography variant="caption" color="text.secondary">Select at least one.</Typography>
            {ALLOWED_MODEL_OPTIONS.map(m => (
              <Box
                key={m.id}
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  border: 1,
                  borderColor: data.allowedModels.includes(m.id) ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={data.allowedModels.includes(m.id)}
                  onChange={() => up({ allowedModels: toggle(data.allowedModels, m.id) })}
                />
                <Typography variant="body2">{m.label}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                  <code>{m.id}</code>
                </Typography>
              </Box>
            ))}
          </Box>
        )

      case 3:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormLabel>Tools</FormLabel>
            <Typography variant="caption" color="text.secondary">
              {tools.length === 0 ? 'No tools registered yet.' : 'Select tools to attach.'}
            </Typography>
            {tools.map(t => (
              <Box
                key={t.id}
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  border: 1,
                  borderColor: data.toolIds.includes(t.id) ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={data.toolIds.includes(t.id)}
                  onChange={() => up({ toolIds: toggle(data.toolIds, t.id) })}
                />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography>
                  {t.description && <Typography variant="caption" color="text.secondary">{t.description}</Typography>}
                </Box>
              </Box>
            ))}
          </Box>
        )

      case 4:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <FormLabel>Skills</FormLabel>
            <Typography variant="caption" color="text.secondary">
              {skills.length === 0 ? 'No skills registered yet.' : 'Select skills to attach.'}
            </Typography>
            {skills.map(s => (
              <Box
                key={s.id}
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  border: 1,
                  borderColor: data.skillIds.includes(s.id) ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  p: 1.5,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={data.skillIds.includes(s.id)}
                  onChange={() => up({ skillIds: toggle(data.skillIds, s.id) })}
                />
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{s.name}</Typography>
                  {s.description && <Typography variant="caption" color="text.secondary">{s.description}</Typography>}
                </Box>
              </Box>
            ))}
          </Box>
        )

      case 5:
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <FormLabel>Short-term TTL: {data.shortTermTtlS}s</FormLabel>
              <input
                type="range"
                min={60}
                max={86400}
                step={60}
                value={data.shortTermTtlS}
                onChange={e => up({ shortTermTtlS: Number(e.target.value) })}
                style={{ width: '100%' }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">1 min</Typography>
                <Typography variant="caption" color="text.secondary">24 hrs</Typography>
              </Box>
            </Box>
            <TextField
              label="Max vectors"
              type="number"
              slotProps={{ htmlInput: { min: 1000, max: 10000000 } }}
              value={data.maxVectors}
              onChange={e => up({ maxVectors: Number(e.target.value) })}
              size="small"
              fullWidth
            />
            <TextField
              label="Embedding model"
              value={data.embeddingModel}
              onChange={e => up({ embeddingModel: e.target.value })}
              placeholder="text-embedding-3-small"
              size="small"
              fullWidth
            />
          </Box>
        )

      case 6: {
        const domainName = domains.find(d => d.id === data.domainId)?.name ?? data.domainId
        return (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="HITL timeout (seconds)"
              type="number"
              slotProps={{ htmlInput: { min: 30, max: 3600 } }}
              value={data.hitlTimeoutSeconds}
              onChange={e => up({ hitlTimeoutSeconds: Number(e.target.value) })}
              size="small"
              fullWidth
            />
            <Box>
              <FormLabel sx={{ mb: 0.5, display: 'block' }}>HITL fallback</FormLabel>
              <select
                value={data.hitlFallback}
                onChange={e => up({ hitlFallback: e.target.value as WizardData['hitlFallback'] })}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14 }}
              >
                <option value="ABORT">ABORT</option>
                <option value="CONTINUE">CONTINUE</option>
                <option value="ESCALATE">ESCALATE</option>
              </select>
            </Box>

            {/* Review summary */}
            <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2 }}>
              <Typography variant="subtitle2" gutterBottom>Review</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, fontSize: 13 }}>
                <Typography variant="caption" color="text.secondary">Name</Typography>
                <Typography variant="caption" sx={{ fontWeight: 500 }}>{data.name}</Typography>
                <Typography variant="caption" color="text.secondary">Domain</Typography>
                <Typography variant="caption" sx={{ fontWeight: 500 }}>{domainName}</Typography>
                <Typography variant="caption" color="text.secondary">Models</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {data.allowedModels.map(m => (
                    <Chip key={m} label={m} size="small" sx={{ fontSize: 10 }} />
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary">Tools</Typography>
                <Typography variant="caption">{data.toolIds.length} selected</Typography>
                <Typography variant="caption" color="text.secondary">Skills</Typography>
                <Typography variant="caption">{data.skillIds.length} selected</Typography>
                <Typography variant="caption" color="text.secondary">HITL</Typography>
                <Typography variant="caption">{data.hitlTimeoutSeconds}s / {data.hitlFallback}</Typography>
              </Box>
            </Box>
          </Box>
        )
      }

      default:
        return null
    }
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto' }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>New Agent</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Configure and provision a new ATOM agent.
        </Typography>
      </Box>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{stepTitles[step]}</Typography>
          <Box sx={{ mt: 1, mb: 2 }}>
            <LinearProgress
              variant="determinate"
              value={((step + 1) / TOTAL_STEPS) * 100}
            />
            <Typography variant="caption" color="text.secondary">
              {step + 1} / {TOTAL_STEPS}
            </Typography>
          </Box>

          {renderStep()}

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3 }}>
            <Button
              variant="outlined"
              startIcon={<ChevronLeftIcon />}
              onClick={() => (step === 0 ? navigate({ to: '/agents' }) : setStep(s => s - 1))}
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>

            {step < TOTAL_STEPS - 1 ? (
              <Button
                variant="contained"
                endIcon={<ChevronRightIcon />}
                onClick={() => setStep(s => s + 1)}
                disabled={!canNext()}
              >
                Next
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={submitting}
              >
                {submitting ? 'Creating…' : 'Create Agent'}
              </Button>
            )}
          </Box>
        </CardContent>
      </Card>

      {revealToken && (
        <TokenRevealModal
          open={true}
          token={revealToken.token}
          agentId={revealToken.agentId}
          domainId={revealToken.domainId}
        />
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
