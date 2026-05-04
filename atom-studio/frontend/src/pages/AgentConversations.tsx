import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import {
  ChevronLeft, ChevronRight, ExternalLink,
  Wrench, Brain, Circle, Send, Bot, User,
  MessageSquare, Clock, Zap, Trash2, Terminal,
  ShieldAlert, AlertCircle, Lock, RefreshCw,
  AlertTriangle, CheckCircle2,
} from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

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

type ErrorType =
  | 'policy_violation'
  | 'rate_limit_exceeded'
  | 'AuthenticationError'
  | 'PermissionDeniedError'
  | 'RateLimitError'
  | 'ServiceUnavailableError'
  | 'InternalServerError'
  | string

interface ChatMessage {
  role: 'user' | 'agent'
  text: string
  ts: Date
  isError?: boolean
  errorType?: ErrorType
  errorCode?: string
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

// Parse a LiteLLM/OpenAI-compatible error response from GATE or atom-llm.
// Shape: { error: { message, type, param, code } }  — or fallback plain strings.
async function parseLiteLLMError(
  resp: Response,
): Promise<{ text: string; errorType?: ErrorType; errorCode?: string }> {
  try {
    const data = await resp.json()
    if (data.error && typeof data.error === 'object') {
      return {
        text: data.error.message || 'Request was blocked',
        errorType: data.error.type as ErrorType,
        errorCode: String(data.error.code ?? ''),
      }
    }
    // Old plain-string fallback
    if (typeof data.error === 'string') {
      return { text: data.reason || data.error, errorType: data.error as ErrorType }
    }
  } catch { /* non-JSON body */ }
  return { text: `Error ${resp.status}: ${resp.statusText}`, errorType: 'InternalServerError' }
}

function errorMeta(errorType?: ErrorType): {
  Icon: typeof AlertCircle
  label: string
  classes: string
  iconClasses: string
} {
  if (errorType === 'policy_violation' || errorType === 'PermissionDeniedError') {
    return {
      Icon: ShieldAlert,
      label: 'Blocked by Policy',
      classes: 'bg-red-500/8 border border-red-500/25 text-red-700 dark:text-red-400',
      iconClasses: 'text-red-500',
    }
  }
  if (errorType === 'rate_limit_exceeded' || errorType === 'RateLimitError') {
    return {
      Icon: Clock,
      label: 'Rate Limit Reached',
      classes: 'bg-amber-500/8 border border-amber-500/25 text-amber-700 dark:text-amber-400',
      iconClasses: 'text-amber-500',
    }
  }
  if (errorType === 'AuthenticationError') {
    return {
      Icon: Lock,
      label: 'Authentication Error',
      classes: 'bg-orange-500/8 border border-orange-500/25 text-orange-700 dark:text-orange-400',
      iconClasses: 'text-orange-500',
    }
  }
  if (errorType === 'ServiceUnavailableError') {
    return {
      Icon: AlertTriangle,
      label: 'Service Unavailable',
      classes: 'bg-zinc-500/8 border border-zinc-500/25 text-zinc-700 dark:text-zinc-400',
      iconClasses: 'text-zinc-500',
    }
  }
  return {
    Icon: AlertCircle,
    label: 'Error',
    classes: 'bg-red-500/8 border border-red-500/25 text-red-700 dark:text-red-400',
    iconClasses: 'text-red-500',
  }
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
      } catch { /* ignore parse errors */ }
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

  const runningRun = data?.items.find(r => r.status === 'running') ?? null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link to="/domains/$domainId/agents/$agentId" params={{ domainId, agentId }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ChevronLeft className="h-4 w-4" /> Agent
        </Link>
        <h2 className="text-xl font-semibold tracking-tight">Conversations</h2>
        <span className="text-sm text-muted-foreground">{data?.total ?? '…'} total</span>
        {runningRun && (
          <Badge variant="destructive" className="flex items-center gap-1 text-xs animate-pulse">
            <Circle className="h-2 w-2 fill-current" /> Live
          </Badge>
        )}
      </div>

      {/* ── Live chat panel ─────────────────────────────────────────────── */}
      <LiveChatPanel
        agentId={agentId}
        gateUrl={gateUrl}
        onRunCreated={() => queryClient.invalidateQueries({ queryKey: ['runs', agentId] })}
      />

      {/* ── Live agent logs ─────────────────────────────────────────────── */}
      <LiveLogsPanel agentId={agentId} />

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
          <div className="text-center py-16 space-y-3">
            <div className="flex justify-center">
              <div className="rounded-full bg-muted p-4">
                <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">No conversations yet</p>
              <p className="text-xs text-muted-foreground/70">
                Use the chat panel above to start a live conversation with this agent.
              </p>
            </div>
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

// ── Live chat panel ────────────────────────────────────────────────────────────

interface LiveChatPanelProps {
  agentId: string
  gateUrl?: string
  onRunCreated: () => void
}

const CHAT_STORAGE_KEY = (id: string) => `atom-chat-${id}`

function LiveChatPanel({ agentId, gateUrl, onRunCreated }: LiveChatPanelProps) {
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>(() => {
    try {
      const stored = localStorage.getItem(CHAT_STORAGE_KEY(agentId))
      if (!stored) return []
      return JSON.parse(stored).map((m: ChatMessage & { ts: string }) => ({ ...m, ts: new Date(m.ts) }))
    } catch { return [] }
  })
  const [agentInfo, setAgentInfo] = useState<{ domain_id?: string; status?: string; name?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const token = useAuthStore(s => s.accessToken)

  useEffect(() => {
    api.get(`/api/agents/`).then(r => {
      const agent = (r.data as { id: string; name?: string; domain_id?: string; status?: string }[]).find((a) => a.id === agentId)
      if (agent) setAgentInfo({ domain_id: agent.domain_id, status: agent.status, name: agent.name })
    }).catch(() => {})
  }, [agentId])

  // Auto-scroll when history changes
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 50)
  }, [chatHistory, sending])

  const effectiveGateUrl = gateUrl ?? (window.location.hostname.endsWith('.atom.local')
    ? `${window.location.protocol}//gate.atom.local:${window.location.port || '8088'}`
    : 'http://localhost:8080')

  const canChat = agentInfo?.status === 'deployed'

  function persist(h: ChatMessage[]) {
    localStorage.setItem(CHAT_STORAGE_KEY(agentId), JSON.stringify(h))
    return h
  }

  async function send() {
    if (!input.trim() || sending || !canChat) return
    const msg = input.trim()
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setSending(true)

    setChatHistory(h => persist([...h, { role: 'user', text: msg, ts: new Date() }]))

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
        setChatHistory(h => persist([...h, { role: 'agent', text: reply, ts: new Date() }]))
        onRunCreated()
      } else {
        const { text, errorType, errorCode } = await parseLiteLLMError(resp)
        setChatHistory(h => persist([...h, {
          role: 'agent',
          text,
          ts: new Date(),
          isError: true,
          errorType,
          errorCode,
        }]))
      }
    } catch (err) {
      setChatHistory(h => persist([...h, {
        role: 'agent',
        text: `Could not reach agent: ${err}`,
        ts: new Date(),
        isError: true,
        errorType: 'ServiceUnavailableError',
      }]))
    } finally {
      setSending(false)
    }
  }

  function clearHistory() {
    localStorage.removeItem(CHAT_STORAGE_KEY(agentId))
    setChatHistory([])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    // Auto-resize textarea
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px'
  }

  if (!canChat && agentInfo) {
    return (
      <div className="rounded-xl border border-dashed border-muted-foreground/25 bg-muted/20 p-8 text-center">
        <div className="flex justify-center mb-3">
          <div className="rounded-full bg-muted p-3">
            <Bot className="h-6 w-6 text-muted-foreground/50" />
          </div>
        </div>
        <p className="text-sm font-medium text-muted-foreground">Agent not deployed</p>
        <p className="text-xs text-muted-foreground/60 mt-1">Deploy this agent to enable live chat.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border/60 bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative shrink-0">
            <Bot className="h-4 w-4 text-primary" />
            {canChat && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-1 ring-background" />
            )}
          </div>
          <span className="text-sm font-medium truncate">
            {agentInfo?.name ?? 'Agent'} — Live Chat
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {canChat && (
            <Badge variant="outline" className="text-xs gap-1 text-emerald-600 border-emerald-500/40 bg-emerald-500/5">
              <CheckCircle2 className="h-3 w-3" /> Online
            </Badge>
          )}
          {chatHistory.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={clearHistory}
              title="Clear conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Message area */}
      <div
        ref={scrollRef}
        className="h-[420px] overflow-y-auto px-4 py-4 space-y-3 scroll-smooth"
        style={{ scrollbarWidth: 'thin' }}
      >
        {chatHistory.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 select-none">
            <div className="rounded-full bg-primary/8 p-4 ring-1 ring-primary/15">
              <Zap className="h-6 w-6 text-primary/70" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Start a conversation</p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Send a message to interact with this agent in real time. Responses stream live.
              </p>
            </div>
            <p className="text-xs text-muted-foreground/50">
              Press <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Enter</kbd> to send &nbsp;·&nbsp; <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">Shift+Enter</kbd> for new line
            </p>
          </div>
        )}

        {chatHistory.map((m, i) => (
          <ChatBubble key={i} message={m} />
        ))}

        {sending && <ThinkingBubble />}
      </div>

      {/* Input area */}
      <div className="border-t border-border/60 bg-background/50 px-4 py-3">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            placeholder={canChat ? 'Message the agent… (Enter to send, Shift+Enter for newline)' : 'Deploy agent to enable chat'}
            value={input}
            disabled={!canChat || sending}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            rows={1}
            className="min-h-[38px] max-h-[140px] resize-none text-sm leading-relaxed py-2 overflow-y-auto field-sizing-content"
            style={{ fieldSizing: 'content' } as React.CSSProperties}
          />
          <Button
            size="sm"
            disabled={!canChat || sending || !input.trim()}
            onClick={send}
            className="h-[38px] w-[38px] shrink-0 p-0"
          >
            {sending
              ? <RefreshCw className="h-4 w-4 animate-spin" />
              : <Send className="h-4 w-4" />
            }
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/50 text-right">
          {input.length > 0 ? `${input.length} chars` : 'Guardrail rejections show inline as policy alerts'}
        </p>
      </div>
    </div>
  )
}

// ── Chat bubble ────────────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'

  if (!isUser && message.isError) {
    const { Icon, label, classes, iconClasses } = errorMeta(message.errorType)
    return (
      <div className="flex gap-2.5 items-start">
        <div className="shrink-0 mt-0.5 rounded-full bg-muted p-1">
          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className={`rounded-xl px-3.5 py-2.5 max-w-[82%] text-sm ${classes}`}>
          <div className="flex items-center gap-1.5 mb-1 font-medium text-xs">
            <Icon className={`h-3.5 w-3.5 shrink-0 ${iconClasses}`} />
            {label}
            {message.errorCode && (
              <code className="ml-auto font-mono text-[10px] opacity-60">{message.errorCode}</code>
            )}
          </div>
          <p className="text-[13px] leading-relaxed whitespace-pre-wrap">{message.text}</p>
          <p className="text-[10px] opacity-50 mt-1.5">{format(message.ts, 'HH:mm:ss')}</p>
        </div>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex gap-2.5 items-end justify-end">
        <div className="rounded-2xl rounded-br-sm px-3.5 py-2.5 bg-primary text-primary-foreground max-w-[82%] text-sm shadow-sm">
          <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
          <p className="text-[10px] opacity-60 mt-1 text-right">{format(message.ts, 'HH:mm:ss')}</p>
        </div>
        <div className="shrink-0 rounded-full bg-primary/15 p-1">
          <User className="h-3.5 w-3.5 text-primary" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2.5 items-end">
      <div className="shrink-0 rounded-full bg-muted p-1">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="rounded-2xl rounded-bl-sm px-3.5 py-2.5 bg-muted/70 border border-border/40 max-w-[82%] text-sm shadow-sm">
        <p className="whitespace-pre-wrap leading-relaxed">{message.text}</p>
        <p className="text-[10px] text-muted-foreground/60 mt-1">{format(message.ts, 'HH:mm:ss')}</p>
      </div>
    </div>
  )
}

function ThinkingBubble() {
  return (
    <div className="flex gap-2.5 items-end">
      <div className="shrink-0 rounded-full bg-muted p-1">
        <Bot className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="rounded-2xl rounded-bl-sm px-4 py-3 bg-muted/70 border border-border/40 text-sm">
        <div className="flex gap-1 items-center h-4">
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:0ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:150ms]" />
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
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
    <Card className={`overflow-hidden transition-shadow ${isRunning ? 'ring-1 ring-primary/30 shadow-sm' : 'hover:shadow-sm'}`}>
      <CardHeader
        className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors"
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
                className="text-blue-500 hover:text-blue-400 transition-colors"
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

// ── Message bubble (for agentscope tRPC messages in run history) ──────────────

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
      <div className="flex items-start gap-2 text-xs bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5">
        <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          {message.name && (
            <span className="font-semibold text-amber-700 dark:text-amber-400">{message.name}</span>
          )}
          <pre className="mt-1 text-muted-foreground font-mono whitespace-pre-wrap break-all">{message.content}</pre>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <Bot className="h-4 w-4 mt-1 shrink-0 text-muted-foreground" />}
      <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap shadow-sm ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-tr-sm'
          : 'bg-muted/70 border border-border/40 rounded-tl-sm'
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

// ── Live logs panel ────────────────────────────────────────────────────────────

function LiveLogsPanel({ agentId }: { agentId: string }) {
  const [logs, setLogs] = useState<{ ts: string; msg: string; source: string }[]>([])
  const [connected, setConnected] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const token = useAuthStore(s => s.accessToken)

  useEffect(() => {
    if (!token) return
    const wsUrl = `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws/agents/${agentId}/logs?token=${token}`
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => setConnected(true)
    ws.onclose = () => setConnected(false)
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        setLogs(prev => {
          const next = [...prev.slice(-199), {
            ts: data.timestamp || new Date().toISOString(),
            msg: data.message || String(e.data),
            source: data.source || '',
          }]
          return next
        })
        setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 30)
      } catch { /* ignore */ }
    }
    return () => ws.close()
  }, [agentId, token])

  return (
    <div className="rounded-xl border border-border/50 overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Agent Logs</span>
        <div
          className={`ml-1 h-1.5 w-1.5 rounded-full transition-colors ${connected ? 'bg-emerald-500' : 'bg-muted-foreground/30'}`}
          title={connected ? 'Connected' : 'Disconnected'}
        />
        {logs.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-4 ml-0.5">{logs.length}</Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {logs.length > 0 && (
            <span
              className="text-xs text-muted-foreground/60 hover:text-muted-foreground px-1"
              onClick={e => { e.stopPropagation(); setLogs([]) }}
            >
              Clear
            </span>
          )}
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          className="max-h-52 overflow-y-auto bg-[#0d0d0d] px-4 py-3 font-mono text-xs"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 transparent' }}
        >
          {logs.length === 0 ? (
            <p className="text-zinc-600 text-center py-3">
              {connected ? 'Waiting for log events…' : 'Connecting to log stream…'}
            </p>
          ) : (
            logs.map((l, i) => (
              <div key={i} className="flex gap-3 leading-5 hover:bg-white/3 -mx-2 px-2 rounded">
                <span className="text-zinc-600 shrink-0 select-none">{l.ts.slice(11, 23)}</span>
                {l.source && (
                  <span className="text-blue-400/70 shrink-0">[{l.source}]</span>
                )}
                <span className="text-emerald-400/90 whitespace-pre-wrap break-all">{l.msg}</span>
              </div>
            ))
          )}
        </div>
      )}
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
      <div className="flex items-start gap-2 text-xs bg-amber-500/8 border border-amber-500/20 rounded-lg px-3 py-2.5">
        <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
        <div>
          <span className="font-semibold text-amber-700 dark:text-amber-400">{step.name}</span>
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
      <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg px-3 py-2 font-mono whitespace-pre-wrap border border-border/30">
        {step.content}
      </div>
    )
  }
  return null
}
