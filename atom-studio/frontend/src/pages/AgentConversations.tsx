import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  ChevronLeft, ChevronRight, ExternalLink,
  Wrench, Brain, Circle, Send, Bot, User,
  MessageSquare, Clock, Zap,
} from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  type: 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  name?: string
  input?: Record<string, unknown>
  content?: string
}

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool'
  name?: string
  content: string
  url?: string
}

interface Run {
  id: string
  run_id: string
  run_name: string | null
  trace_id: string | null
  user_msg: string
  reply: string
  steps: Step[]
  messages: Message[]
  latency_ms: number | null
  status: 'running' | 'complete' | 'error'
  created_at: string
}

interface RunPage {
  total: number
  page: number
  page_size: number
  items: Run[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TEMPO_BASE =
  'http://grafana.atom.local:8088/explore?orgId=1&left={"datasource":"tempo","queries":[{"refId":"A","queryType":"traceql","query":"{trace_id=\\"$ID\\"}"}],"range":{"from":"now-1h","to":"now"}}'

function traceLink(traceId: string) {
  return TEMPO_BASE.replace('$ID', traceId)
}

function safeSteps(steps: Step[] | string | null | undefined): Step[] {
  if (Array.isArray(steps)) return steps
  if (typeof steps === 'string') {
    try { const p = JSON.parse(steps); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

function safeMessages(messages: Message[] | string | null | undefined): Message[] {
  if (Array.isArray(messages)) return messages
  if (typeof messages === 'string') {
    try { const p = JSON.parse(messages); return Array.isArray(p) ? p : [] } catch { return [] }
  }
  return []
}

// ── Live run WebSocket hook ────────────────────────────────────────────────────

function useLiveRun(agentId: string, runId: string | null, enabled: boolean) {
  const [liveMessages, setLiveMessages] = useState<Message[]>([])
  const [status, setStatus] = useState<'running' | 'complete'>('running')
  const wsRef = useRef<WebSocket | null>(null)
  const token = useAuthStore(s => s.accessToken)

  useEffect(() => {
    if (!enabled || !runId || !token) return
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/agents/${agentId}/runs/${runId}?token=${token}`
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.__status === 'complete') {
          setStatus('complete')
        } else {
          setLiveMessages(prev => [...prev, msg as Message])
        }
      } catch {}
    }
    ws.onerror = () => setStatus('complete')
    return () => { ws.close(); wsRef.current = null }
  }, [agentId, runId, enabled, token])

  return { liveMessages, status }
}

// ── Main component ─────────────────────────────────────────────────────────────

interface AgentConversationsProps {
  domainId: string
  agentId: string
  gateUrl?: string
}

export function AgentConversations({ domainId, agentId, gateUrl }: AgentConversationsProps) {
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const pageSize = 20
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<RunPage>({
    queryKey: ['runs', agentId, page],
    queryFn: async () =>
      (await api.get(`/api/agents/${agentId}/runs/?page=${page}&page_size=${pageSize}`)).data,
    refetchInterval: 5000,
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1

  // Find any currently running run
  const runningRun = data?.items.find(r => r.status === 'running') ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/domains/$domainId/agents/$agentId" params={{ domainId, agentId }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Agent
        </Link>
        <h2 className="text-xl font-bold">Conversations</h2>
        <span className="text-sm text-muted-foreground">{data?.total ?? '…'} total</span>
        {runningRun && (
          <Badge variant="destructive" className="flex items-center gap-1 text-xs animate-pulse">
            <Circle className="h-2 w-2 fill-current" /> Live
          </Badge>
        )}
      </div>

      {/* ── Live chat panel ─────────────────────────────────────────────── */}
      <LiveChatPanel agentId={agentId} gateUrl={gateUrl} onRunCreated={() => queryClient.invalidateQueries({ queryKey: ['runs', agentId] })} />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {/* ── Run list ────────────────────────────────────────────────────── */}
      <div className="space-y-3">
        {(data?.items ?? []).map(run => (
          <RunCard
            key={run.id}
            run={run}
            agentId={agentId}
            expanded={expanded === run.id}
            onToggle={() => setExpanded(expanded === run.id ? null : run.id)}
          />
        ))}

        {data?.items.length === 0 && (
          <div className="text-center py-12 space-y-2">
            <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No conversations yet. Use the chat above to talk to this agent.
            </p>
            <p className="text-xs text-muted-foreground">
              Or: agents using <code className="font-mono bg-muted px-1 rounded">agentscope.init(studio_url=...)</code> will appear here automatically.
            </p>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Live chat panel (send messages to a deployed agent) ───────────────────────

interface LiveChatPanelProps {
  agentId: string
  gateUrl?: string
  onRunCreated: () => void
}

function LiveChatPanel({ agentId, gateUrl, onRunCreated }: LiveChatPanelProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'agent'; text: string; ts: Date }[]>([])
  const [agentInfo, setAgentInfo] = useState<{ domain_id?: string; status?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const token = useAuthStore(s => s.accessToken)

  // Load agent info to get domain_id and status
  useEffect(() => {
    api.get(`/api/agents/`).then(r => {
      const agent = (r.data as { id: string; domain_id?: string; status?: string }[]).find((a) => a.id === agentId)
      if (agent) setAgentInfo({ domain_id: agent.domain_id, status: agent.status })
    }).catch(() => {})
  }, [agentId])

  const effectiveGateUrl = gateUrl ?? (window.location.hostname.endsWith('.atom.local')
    ? `${window.location.protocol}//gate.atom.local:${window.location.port || '8088'}`
    : 'http://localhost:8080')

  const canChat = agentInfo?.status === 'deployed'

  async function send() {
    if (!input.trim() || sending || !canChat) return
    const msg = input.trim()
    setInput('')
    setSending(true)
    setChatHistory(h => [...h, { role: 'user', text: msg, ts: new Date() }])

    try {
      const resp = await fetch(
        `${effectiveGateUrl}/domain/${agentInfo?.domain_id}/agent/${agentId}/run`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: msg }),
        }
      )
      if (resp.ok) {
        const data = await resp.json()
        const reply = data.reply ?? data.response ?? data.content ?? JSON.stringify(data)
        setChatHistory(h => [...h, { role: 'agent', text: reply, ts: new Date() }])
        onRunCreated()
      } else {
        setChatHistory(h => [...h, { role: 'agent', text: `Error ${resp.status}: ${resp.statusText}`, ts: new Date() }])
      }
    } catch (err) {
      setChatHistory(h => [...h, { role: 'agent', text: `Could not reach agent: ${err}`, ts: new Date() }])
    } finally {
      setSending(false)
      setTimeout(() => scrollRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 50)
    }
  }

  if (!canChat && agentInfo) {
    return (
      <Card className="bg-muted/30 border-dashed">
        <CardContent className="py-4 text-center text-sm text-muted-foreground">
          <Bot className="h-5 w-5 mx-auto mb-1 opacity-50" />
          Agent not deployed — deploy it first to enable live chat.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="py-2 px-4 border-b flex flex-row items-center gap-2">
        <Zap className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Live Chat</span>
        {canChat && (
          <Badge variant="outline" className="text-xs text-green-600 border-green-600 ml-auto">
            Agent online
          </Badge>
        )}
      </CardHeader>

      {/* Message history */}
      <div ref={scrollRef} className="max-h-64 overflow-y-auto px-4 py-3 space-y-2">
        {chatHistory.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Send a message to start a live conversation with this agent.
          </p>
        )}
        {chatHistory.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'agent' && <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
              m.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-tr-sm'
                : 'bg-muted rounded-tl-sm'
            }`}>
              <p className="whitespace-pre-wrap">{m.text}</p>
              <p className="text-xs opacity-50 mt-1">{format(m.ts, 'HH:mm:ss')}</p>
            </div>
            {m.role === 'user' && <User className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
          </div>
        ))}
        {sending && (
          <div className="flex gap-2 justify-start">
            <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
            <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-sm text-muted-foreground animate-pulse">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <CardContent className="px-4 pb-3 pt-2 border-t">
        <div className="flex gap-2">
          <Input
            placeholder={canChat ? 'Message the agent…' : 'Deploy agent to enable chat'}
            value={input}
            disabled={!canChat || sending}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
            className="text-sm"
          />
          <Button size="sm" disabled={!canChat || sending || !input.trim()} onClick={send}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Run card with live WebSocket support ──────────────────────────────────────

interface RunCardProps {
  run: Run
  agentId: string
  expanded: boolean
  onToggle: () => void
}

function RunCard({ run, agentId, expanded, onToggle }: RunCardProps) {
  const { liveMessages, status: wsStatus } = useLiveRun(
    agentId,
    run.run_id,
    expanded && run.status === 'running',
  )

  const isRunning = run.status === 'running'
  const displayMessages = safeMessages(run.messages)
  const allMessages = [...displayMessages, ...liveMessages]
  const steps = safeSteps(run.steps)

  const title = run.run_name || run.user_msg || run.run_id.slice(0, 12)

  return (
    <Card className={`overflow-hidden ${isRunning ? 'ring-1 ring-primary/40' : ''}`}>
      <CardHeader
        className="py-3 px-4 cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isRunning && (
                <Circle className="h-2 w-2 fill-primary text-primary shrink-0 animate-pulse" />
              )}
              <p className="text-sm font-medium text-foreground truncate">{title}</p>
            </div>
            {run.reply && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{run.reply}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {run.latency_ms != null && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />{run.latency_ms}ms
              </span>
            )}
            {allMessages.length > 0 && (
              <Badge variant="secondary" className="text-xs">
                <MessageSquare className="h-2.5 w-2.5 mr-1" />{allMessages.length}
              </Badge>
            )}
            {steps.length > 0 && (
              <Badge variant="secondary" className="text-xs">{steps.length} steps</Badge>
            )}
            <Badge
              variant={isRunning ? 'destructive' : run.status === 'error' ? 'destructive' : 'outline'}
              className="text-xs"
            >
              {isRunning ? 'live' : run.status}
            </Badge>
            {run.trace_id && (
              <a
                href={traceLink(run.trace_id)}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="text-blue-500 hover:text-blue-400"
                title="View trace in Grafana Tempo"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              {format(new Date(run.created_at), 'MMM d HH:mm:ss')}
            </span>
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="px-4 pb-4 pt-0 space-y-2 border-t">
          {/* agentscope tRPC messages (role-based timeline) */}
          {allMessages.length > 0 && (
            <div className="space-y-2 pt-2">
              {allMessages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))}
              {isRunning && wsStatus === 'running' && (
                <div className="flex gap-2 justify-start">
                  <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2 text-xs text-muted-foreground animate-pulse">
                    Thinking…
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Legacy atom SDK: user → steps → reply */}
          {allMessages.length === 0 && (
            <>
              {run.user_msg && (
                <div className="flex justify-end pt-2">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%] text-sm">
                    {run.user_msg}
                  </div>
                </div>
              )}
              {steps.map((step, i) => <StepBlock key={i} step={step} />)}
              {run.reply && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap">
                    {run.reply}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1 border-t mt-2">
            <span>run_id: <code className="font-mono">{run.run_id.slice(0, 12)}…</code></span>
            {run.trace_id && (
              <a href={traceLink(run.trace_id)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 text-blue-500 hover:text-blue-400">
                <ExternalLink className="h-3 w-3" /> trace
              </a>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}

// ── Message bubble (for agentscope tRPC messages) ─────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <div className="text-center">
        <span className="text-xs text-muted-foreground bg-muted rounded px-2 py-0.5">
          {message.content}
        </span>
      </div>
    )
  }

  if (isTool) {
    return (
      <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
        <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-600" />
        <div>
          {message.name && <span className="font-medium text-yellow-700 dark:text-yellow-400">{message.name}</span>}
          <pre className="mt-1 text-muted-foreground font-mono whitespace-pre-wrap">{message.content}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-tr-sm'
          : 'bg-muted rounded-tl-sm'
      }`}>
        {message.name && !isUser && (
          <p className="text-xs opacity-60 mb-1 font-medium">{message.name}</p>
        )}
        {message.content}
        {message.url && (
          <a href={message.url} target="_blank" rel="noreferrer"
            className="block mt-1 text-xs underline opacity-70">
            {message.url}
          </a>
        )}
      </div>
      {isUser && <User className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
    </div>
  )
}

// ── Step block (legacy atom SDK steps) ────────────────────────────────────────

function StepBlock({ step }: { step: Step }) {
  if (step.type === 'thinking') {
    return (
      <div className="flex items-start gap-2 text-xs text-muted-foreground italic border-l-2 border-muted pl-3 py-1">
        <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap">{step.text}</span>
      </div>
    )
  }
  if (step.type === 'tool_use') {
    return (
      <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
        <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-600" />
        <div>
          <span className="font-medium text-yellow-700 dark:text-yellow-400">{step.name}</span>
          {step.input && Object.keys(step.input).length > 0 && (
            <pre className="mt-1 text-muted-foreground font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          )}
        </div>
      </div>
    )
  }
  if (step.type === 'tool_result') {
    return (
      <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 font-mono whitespace-pre-wrap">
        {step.content}
      </div>
    )
  }
  return null
}
