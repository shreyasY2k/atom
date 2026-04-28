import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1 mb-6">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 flex-1 rounded-full transition-colors ${
            i < current ? 'bg-primary' : i === current ? 'bg-primary/60' : 'bg-muted'
          }`}
        />
      ))}
      <span className="ml-2 text-xs text-muted-foreground whitespace-nowrap">
        {current + 1} / {total}
      </span>
    </div>
  )
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
      toast({ title: 'Error', description: msg, variant: 'destructive' })
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
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Agent name *</Label>
              <Input
                id="name"
                value={data.name}
                onChange={e => up({ name: e.target.value })}
                placeholder="my-agent"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Input
                id="desc"
                value={data.description}
                onChange={e => up({ description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
          </div>
        )

      case 1:
        return (
          <div className="space-y-2">
            <Label>Domain</Label>
            {domains.length === 0 ? (
              <p className="text-sm text-muted-foreground">No domains yet. Create one first.</p>
            ) : (
              <div className="space-y-2">
                {domains.map(d => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      data.domainId === d.id ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                    }`}
                  >
                    <input
                      type="radio"
                      name="domain"
                      value={d.id}
                      checked={data.domainId === d.id}
                      onChange={() => up({ domainId: d.id })}
                      className="accent-primary"
                    />
                    <span className="font-medium text-sm">{d.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )

      case 2:
        return (
          <div className="space-y-2">
            <Label>Allowed models</Label>
            <p className="text-xs text-muted-foreground">Select at least one.</p>
            <div className="space-y-2">
              {ALLOWED_MODEL_OPTIONS.map(m => (
                <label
                  key={m.id}
                  className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                    data.allowedModels.includes(m.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={data.allowedModels.includes(m.id)}
                    onChange={() => up({ allowedModels: toggle(data.allowedModels, m.id) })}
                    className="accent-primary"
                  />
                  <span className="text-sm">{m.label}</span>
                  <code className="ml-auto text-xs text-muted-foreground">{m.id}</code>
                </label>
              ))}
            </div>
          </div>
        )

      case 3:
        return (
          <div className="space-y-2">
            <Label>Tools</Label>
            <p className="text-xs text-muted-foreground">
              {tools.length === 0 ? 'No tools registered yet.' : 'Select tools to attach.'}
            </p>
            {tools.map(t => (
              <label
                key={t.id}
                className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${
                  data.toolIds.includes(t.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={data.toolIds.includes(t.id)}
                  onChange={() => up({ toolIds: toggle(data.toolIds, t.id) })}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">{t.name}</p>
                  {t.description && (
                    <p className="text-xs text-muted-foreground">{t.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )

      case 4:
        return (
          <div className="space-y-2">
            <Label>Skills</Label>
            <p className="text-xs text-muted-foreground">
              {skills.length === 0 ? 'No skills registered yet.' : 'Select skills to attach.'}
            </p>
            {skills.map(s => (
              <label
                key={s.id}
                className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer ${
                  data.skillIds.includes(s.id) ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={data.skillIds.includes(s.id)}
                  onChange={() => up({ skillIds: toggle(data.skillIds, s.id) })}
                  className="accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">{s.name}</p>
                  {s.description && (
                    <p className="text-xs text-muted-foreground">{s.description}</p>
                  )}
                </div>
              </label>
            ))}
          </div>
        )

      case 5:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Short-term TTL: {data.shortTermTtlS}s</Label>
              <input
                type="range"
                min={60}
                max={86400}
                step={60}
                value={data.shortTermTtlS}
                onChange={e => up({ shortTermTtlS: Number(e.target.value) })}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 min</span>
                <span>24 hrs</span>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vectors">Max vectors</Label>
              <Input
                id="vectors"
                type="number"
                min={1000}
                max={10000000}
                value={data.maxVectors}
                onChange={e => up({ maxVectors: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="embed">Embedding model</Label>
              <Input
                id="embed"
                value={data.embeddingModel}
                onChange={e => up({ embeddingModel: e.target.value })}
                placeholder="text-embedding-3-small"
              />
            </div>
          </div>
        )

      case 6: {
        const domainName = domains.find(d => d.id === data.domainId)?.name ?? data.domainId
        return (
          <div className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="hitl-timeout">HITL timeout (seconds)</Label>
                <Input
                  id="hitl-timeout"
                  type="number"
                  min={30}
                  max={3600}
                  value={data.hitlTimeoutSeconds}
                  onChange={e => up({ hitlTimeoutSeconds: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hitl-fallback">HITL fallback</Label>
                <select
                  id="hitl-fallback"
                  value={data.hitlFallback}
                  onChange={e =>
                    up({ hitlFallback: e.target.value as WizardData['hitlFallback'] })
                  }
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="ABORT">ABORT</option>
                  <option value="CONTINUE">CONTINUE</option>
                  <option value="ESCALATE">ESCALATE</option>
                </select>
              </div>
            </div>

            {/* Review summary */}
            <div className="rounded-md border p-4 space-y-2 text-sm">
              <p className="font-semibold text-base">Review</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{data.name}</span>
                <span className="text-muted-foreground">Domain</span>
                <span className="font-medium">{domainName}</span>
                <span className="text-muted-foreground">Models</span>
                <span className="flex flex-wrap gap-1">
                  {data.allowedModels.map(m => (
                    <Badge key={m} variant="secondary" className="text-xs">
                      {m}
                    </Badge>
                  ))}
                </span>
                <span className="text-muted-foreground">Tools</span>
                <span>{data.toolIds.length} selected</span>
                <span className="text-muted-foreground">Skills</span>
                <span>{data.skillIds.length} selected</span>
                <span className="text-muted-foreground">HITL</span>
                <span>
                  {data.hitlTimeoutSeconds}s / {data.hitlFallback}
                </span>
              </div>
            </div>
          </div>
        )
      }

      default:
        return null
    }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">New Agent</h2>
        <p className="text-muted-foreground text-sm mt-1">
          Configure and provision a new ATOM agent.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{stepTitles[step]}</CardTitle>
          <CardDescription>
            <StepIndicator current={step} total={TOTAL_STEPS} />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {renderStep()}

          <div className="flex justify-between pt-4">
            <Button
              variant="outline"
              onClick={() => (step === 0 ? navigate({ to: '/agents' }) : setStep(s => s - 1))}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>

            {step < TOTAL_STEPS - 1 ? (
              <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()}>
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Creating…' : 'Create Agent'}
              </Button>
            )}
          </div>
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
    </div>
  )
}
