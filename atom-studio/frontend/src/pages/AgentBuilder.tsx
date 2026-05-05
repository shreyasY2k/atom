import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Loader2, Shield, ClipboardList, ChevronLeft, ChevronRight, Rocket } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
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
      toast({ title: 'Agent provisioning started', description: 'Check Agents for status updates.' })
      navigate({ to: '/agents' })
    },
    onError: (e: any) => {
      toast({ title: 'Build failed', description: e.response?.data?.detail ?? 'Unknown error', variant: 'destructive' })
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agent Builder</h2>
        <div className="flex gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className={`h-2 w-12 rounded-full transition-colors ${i <= step ? 'bg-primary' : 'bg-muted'}`} />
          ))}
        </div>
      </div>

      {/* Step 0: Intent */}
      {step === 0 && (
        <div className="space-y-4">
          <div>
            <Label className="text-base font-semibold">Step 1 — What should this agent do?</Label>
            <p className="text-sm text-muted-foreground mt-1">Describe the agent's purpose in plain language.</p>
          </div>

          {domains.length > 1 && (
            <div className="space-y-1.5">
              <Label>Domain</Label>
              <select
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
                value={data.domainId || selectedDomainId}
                onChange={e => setData(d => ({ ...d, domainId: e.target.value }))}
              >
                {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}

          <Textarea
            placeholder="Monitor credit applications, flag high-risk ones and escalate to a human reviewer…"
            rows={5}
            value={data.intent}
            onChange={e => setData(d => ({ ...d, intent: e.target.value }))}
          />
          <Button onClick={analyseIntent} disabled={!data.intent.trim() || analysing}>
            {analysing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Analysing…</> : 'Analyse Intent →'}
          </Button>
        </div>
      )}

      {/* Step 1: Capabilities */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <Label className="text-base font-semibold">Step 2 — Suggested Capabilities</Label>
            <p className="text-sm text-muted-foreground mt-1">Review and edit the AI-generated suggestions.</p>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">LLM Model</Label>
            <ModelPicker value={data.model} onChange={m => setData(d => ({ ...d, model: m }))} />
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">Skills</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
            </div>
            <p className="text-xs text-muted-foreground">
              atom-gate-calls and atom-audit are always active.
            </p>
          </div>

          {tools.length > 0 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">MCP Tools</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {tools.map(t => (
                  <ToolCard
                    key={t.name}
                    tool={t}
                    selected={data.tools.includes(t.name)}
                    onToggle={name => setData(d => ({ ...d, tools: toggle(d.tools, name) }))}
                  />
                ))}
              </div>
            </div>
          )}

          {a2aAgents.length >= 2 && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">A2A Agents</Label>
              <p className="text-xs text-muted-foreground">All A2A calls are routed via GATE and audited.</p>
              <div className="flex flex-wrap gap-2">
                {a2aAgents.map(a => (
                  <button
                    key={a.id}
                    onClick={() => setData(d => ({ ...d, a2aAgents: toggle(d.a2aAgents, a.id) }))}
                    className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
                      data.a2aAgents.includes(a.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border hover:border-primary/60'
                    }`}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={() => setStep(2)}>
              Review & Deploy <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Build & Deploy */}
      {step === 2 && (
        <div className="space-y-6">
          <div>
            <Label className="text-base font-semibold">Step 3 — Build & Deploy</Label>
          </div>

          <Card>
            <CardContent className="pt-4 space-y-3 text-sm">
              <div><span className="font-medium">Model:</span> {data.model}</div>
              <div><span className="font-medium">Skills:</span> {data.skills.join(', ')}</div>
              {data.tools.length > 0 && <div><span className="font-medium">Tools:</span> {data.tools.join(', ')}</div>}
              {data.a2aAgents.length > 0 && <div><span className="font-medium">A2A:</span> {data.a2aAgents.length} agent(s)</div>}
            </CardContent>
          </Card>

          <div className="space-y-2">
            <Label>Build destination</Label>
            <div className="flex gap-3">
              {(['gitlab', 'local'] as const).map(target => (
                <button
                  key={target}
                  onClick={() => setData(d => ({ ...d, ciTarget: target }))}
                  className={`flex-1 px-4 py-3 rounded-md text-sm border transition-colors text-left ${
                    data.ciTarget === target ? 'border-primary bg-primary/5' : 'border-border'
                  }`}
                >
                  <div className="font-medium">{target === 'gitlab' ? 'GitLab (private)' : 'Local Docker'}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {target === 'gitlab' ? 'CI pipeline + approval flow' : 'Generate code locally'}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 border rounded-md p-3 bg-muted/40">
            <Shield className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs">Guardrails always active</span>
            <ClipboardList className="h-4 w-4 text-primary shrink-0 ml-2" />
            <span className="text-xs">Audit always on</span>
            <span className="text-xs text-muted-foreground ml-auto">JWT + Agent ID auto-provisioned</span>
          </div>

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(1)}>
              <ChevronLeft className="mr-1 h-4 w-4" /> Back
            </Button>
            <Button onClick={handleDeploy} disabled={buildMutation.isPending}>
              {buildMutation.isPending
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building…</>
                : <><Rocket className="mr-2 h-4 w-4" /> Approve + Deploy</>}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
