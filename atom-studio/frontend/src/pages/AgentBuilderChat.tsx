import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Rocket, Loader2 } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConversationPanel } from '@/components/builder/ConversationPanel'
import { AgentSpecPanel } from '@/components/builder/AgentSpecPanel'
import { DeployProgressFeed } from '@/components/builder/DeployProgressFeed'
import { AgentReadyCard } from '@/components/builder/AgentReadyCard'
import { useBuilderChat } from '@/hooks/useBuilderChat'
import { useBuilderDeploy } from '@/hooks/useBuilderDeploy'

interface Domain { id: string; name: string }

export function AgentBuilderChat() {
  const [ciTarget, setCiTarget] = useState<'gitlab' | 'local'>('gitlab')
  const [selectedDomainId, setSelectedDomainId] = useState<string>('')

  const { data: domains = [] } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: async () => (await api.get('/api/domains/')).data,
  })

  // Auto-select first domain
  useEffect(() => {
    if (domains.length && !selectedDomainId) setSelectedDomainId(domains[0].id)
  }, [domains, selectedDomainId])

  const { messages, spec, stage, sessionId, loading, sendMessage } =
    useBuilderChat(selectedDomainId, ciTarget)

  const { steps, deploying, chatUrl, agentPy, error, deploy } = useBuilderDeploy()

  const canDeploy = ['confirming', 'confirmed'].includes(stage) && !!sessionId && !deploying && !chatUrl

  const handleDeploy = () => {
    if (sessionId) deploy(sessionId)
  }

  return (
    <div className="flex flex-col h-full gap-0">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 shrink-0">
        <h2 className="text-xl font-bold tracking-tight">Agent Builder</h2>

        <div className="flex items-center gap-3">
          {domains.length > 1 && (
            <select
              className="text-sm border rounded px-2 py-1 bg-background"
              value={selectedDomainId}
              onChange={e => setSelectedDomainId(e.target.value)}
            >
              {domains.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="flex text-xs rounded-md border overflow-hidden">
            {(['gitlab', 'local'] as const).map(t => (
              <button
                key={t}
                onClick={() => setCiTarget(t)}
                className={`px-3 py-1.5 transition-colors ${ciTarget === t ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent'}`}
              >
                {t === 'gitlab' ? 'GitLab CI' : 'Local'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Split panel */}
      <div className="flex-1 min-h-0 grid grid-cols-[1fr_320px] gap-4">
        {/* Left — conversation */}
        <div className="border rounded-lg overflow-hidden flex flex-col">
          <div className="px-4 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
            💬 Builder
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <ConversationPanel messages={messages} loading={loading} onSend={sendMessage} />
          </div>

          {/* Deploy progress in chat area */}
          {(steps.length > 0 || deploying) && (
            <div className="border-t px-4 py-3 bg-muted/20 space-y-2">
              <DeployProgressFeed steps={steps} deploying={deploying} error={error} />
              {chatUrl && <AgentReadyCard agentName={spec.agentName} chatUrl={chatUrl} />}
              {agentPy && !chatUrl && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground mb-1">Generated <code>agent.py</code> — run <code>atom deploy</code> to deploy:</p>
                  <pre className="text-xs bg-background border rounded p-2 overflow-auto max-h-48 font-mono">{agentPy}</pre>
                </div>
              )}
            </div>
          )}

          {/* Deploy CTA */}
          {canDeploy && (
            <div className="border-t px-4 py-3 flex items-center justify-between bg-muted/20">
              <span className="text-xs text-muted-foreground">
                Ready to build and deploy?
              </span>
              <Button size="sm" onClick={handleDeploy} disabled={deploying}>
                {deploying
                  ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Deploying…</>
                  : <><Rocket className="mr-1.5 h-3.5 w-3.5" />Build & Deploy</>}
              </Button>
            </div>
          )}
        </div>

        {/* Right — spec */}
        <div className="border rounded-lg overflow-y-auto">
          <div className="px-4 py-2 border-b bg-muted/40 text-xs font-medium text-muted-foreground">
            📋 Agent Spec
          </div>
          <div className="p-4 space-y-4">
            <AgentSpecPanel spec={spec} stage={stage} ciTarget={ciTarget} />

            {chatUrl && (
              <AgentReadyCard agentName={spec.agentName} chatUrl={chatUrl} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
