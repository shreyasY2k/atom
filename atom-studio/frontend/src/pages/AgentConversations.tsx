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
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import api from '@/lib/api'
import { useAuthStore } from '@/lib/auth'

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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          component={Link}
          to="/domains/$domainId/agents/$agentId"
          params={{ domainId, agentId } as never}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', textDecoration: 'none', fontSize: 14, '&:hover': { color: 'text.primary' } }}
        >
          <ChevronLeft size={16} /> Agent
        </Box>
        <Typography variant="h6" sx={{ fontWeight: 600 }}>Conversations</Typography>
        <Typography variant="body2" color="text.secondary">{data?.total ?? '…'} total</Typography>
        {runningRun && (
          <Chip
            icon={<Circle size={8} className="fill-current" />}
            label="Live"
            color="error"
            size="small"
            sx={{ animation: 'pulse 2s infinite', fontSize: 11 }}
          />
        )}
      </Box>

      <LiveChatPanel
        agentId={agentId}
        gateUrl={gateUrl}
        onRunCreated={() => queryClient.invalidateQueries({ queryKey: ['runs', agentId] })}
      />

      <LiveLogsPanel agentId={agentId} />

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
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
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
              <Box sx={{ borderRadius: '50%', bgcolor: 'grey.100', p: 2 }}>
                <MessageSquare size={32} style={{ color: '#9ca3af' }} />
              </Box>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>No conversations yet</Typography>
            <Typography variant="caption" color="text.secondary">
              Use the chat panel above to start a live conversation with this agent.
            </Typography>
          </Box>
        )}
      </Box>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">Page {page} of {totalPages}</Typography>
          <IconButton size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <IconButton size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={16} />
          </IconButton>
        </Box>
      )}
    </Box>
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
  const token = useAuthStore(s => s.accessToken)

  useEffect(() => {
    api.get(`/api/agents/`).then(r => {
      const agent = (r.data as { id: string; name?: string; domain_id?: string; status?: string }[]).find((a) => a.id === agentId)
      if (agent) setAgentInfo({ domain_id: agent.domain_id, status: agent.status, name: agent.name })
    }).catch(() => {})
  }, [agentId])

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

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  if (!canChat && agentInfo) {
    return (
      <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 2, p: 6, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1.5 }}>
          <Box sx={{ borderRadius: '50%', bgcolor: 'grey.100', p: 1.5 }}>
            <Bot size={24} style={{ color: '#9ca3af' }} />
          </Box>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>Agent not deployed</Typography>
        <Typography variant="caption" color="text.secondary">Deploy this agent to enable live chat.</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 0 }}>
          <Box sx={{ position: 'relative', flexShrink: 0 }}>
            <Bot size={16} style={{ color: '#1976d2' }} />
            {canChat && (
              <Box sx={{
                position: 'absolute', bottom: -2, right: -2, width: 8, height: 8,
                borderRadius: '50%', bgcolor: '#22c55e', border: '1px solid white'
              }} />
            )}
          </Box>
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
            {agentInfo?.name ?? 'Agent'} — Live Chat
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
          {canChat && (
            <Chip
              icon={<CheckCircle2 size={12} />}
              label="Online"
              size="small"
              variant="outlined"
              sx={{ color: '#16a34a', borderColor: '#86efac', fontSize: 11 }}
            />
          )}
          {chatHistory.length > 0 && (
            <IconButton size="small" onClick={clearHistory} title="Clear conversation">
              <Trash2 size={14} />
            </IconButton>
          )}
        </Box>
      </Box>

      {/* Message area */}
      <Box
        ref={scrollRef}
        sx={{ height: 420, overflowY: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        {chatHistory.length === 0 && (
          <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, userSelect: 'none' }}>
            <Box sx={{ borderRadius: '50%', bgcolor: 'primary.50', p: 2, border: '1px solid', borderColor: 'primary.100' }}>
              <Zap size={24} style={{ color: '#1976d2', opacity: 0.7 }} />
            </Box>
            <Box sx={{ textAlign: 'center' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>Start a conversation</Typography>
              <Typography variant="caption" color="text.secondary">
                Send a message to interact with this agent in real time.
              </Typography>
            </Box>
          </Box>
        )}

        {chatHistory.map((m, i) => (
          <ChatBubble key={i} message={m} />
        ))}

        {sending && <ThinkingBubble />}
      </Box>

      {/* Input area */}
      <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 2, py: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            multiline
            maxRows={5}
            placeholder={canChat ? 'Message the agent… (Enter to send, Shift+Enter for newline)' : 'Deploy agent to enable chat'}
            value={input}
            disabled={!canChat || sending}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            size="small"
            fullWidth
            sx={{ '& .MuiInputBase-input': { fontSize: 14 } }}
          />
          <IconButton
            size="small"
            disabled={!canChat || sending || !input.trim()}
            onClick={send}
            color="primary"
            sx={{ flexShrink: 0, border: 1, borderColor: 'divider' }}
          >
            {sending ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
          </IconButton>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'right', mt: 0.5 }}>
          {input.length > 0 ? `${input.length} chars` : 'Guardrail rejections show inline as policy alerts'}
        </Typography>
      </Box>
    </Box>
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
          <Bot size={14} style={{ color: '#6b7280' }} />
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
      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
        <Box sx={{ borderRadius: '16px 16px 4px 16px', px: 2, py: 1.5, bgcolor: 'primary.main', color: 'primary.contrastText', maxWidth: '82%', fontSize: 14 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'inherit' }}>{message.text}</Typography>
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', opacity: 0.6, mt: 0.5, fontSize: 10 }}>
            {format(message.ts, 'HH:mm:ss')}
          </Typography>
        </Box>
        <Box sx={{ borderRadius: '50%', bgcolor: 'primary.50', p: 0.5, flexShrink: 0 }}>
          <User size={14} style={{ color: '#1976d2' }} />
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
      <Box sx={{ borderRadius: '50%', bgcolor: 'grey.100', p: 0.5, flexShrink: 0 }}>
        <Bot size={14} style={{ color: '#6b7280' }} />
      </Box>
      <Box sx={{ borderRadius: '16px 16px 16px 4px', px: 2, py: 1.5, bgcolor: 'grey.100', border: 1, borderColor: 'divider', maxWidth: '82%', fontSize: 14 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{message.text}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontSize: 10 }}>
          {format(message.ts, 'HH:mm:ss')}
        </Typography>
      </Box>
    </Box>
  )
}

function ThinkingBubble() {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-end' }}>
      <Box sx={{ borderRadius: '50%', bgcolor: 'grey.100', p: 0.5, flexShrink: 0 }}>
        <Bot size={14} style={{ color: '#6b7280' }} />
      </Box>
      <Box sx={{ borderRadius: '16px 16px 16px 4px', px: 2, py: 1.5, bgcolor: 'grey.100', border: 1, borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', height: 16 }}>
          {[0, 150, 300].map(delay => (
            <Box
              key={delay}
              sx={{
                width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled',
                animation: 'bounce 1s infinite',
                animationDelay: `${delay}ms`,
              }}
            />
          ))}
        </Box>
      </Box>
    </Box>
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
    <Card
      variant="outlined"
      sx={{
        overflow: 'hidden',
        transition: 'box-shadow 0.2s',
        ...(isRunning ? { boxShadow: '0 0 0 1px rgba(25,118,210,0.3)' } : { '&:hover': { boxShadow: 1 } }),
      }}
    >
      <Box
        sx={{ py: 1.5, px: 2, cursor: 'pointer', '&:hover': { bgcolor: 'grey.50' } }}
        onClick={onToggle}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {isRunning && <Circle size={8} style={{ fill: '#1976d2', color: '#1976d2', animation: 'pulse 2s infinite', flexShrink: 0 }} />}
              <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>{title}</Typography>
            </Box>
            {run.reply && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                {run.reply}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            {run.latency_ms != null && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <Clock size={12} />{run.latency_ms}ms
              </Typography>
            )}
            {allMessages.length > 0 && (
              <Chip icon={<MessageSquare size={10} />} label={allMessages.length} size="small" />
            )}
            {steps.length > 0 && (
              <Chip label={`${steps.length} steps`} size="small" />
            )}
            <Chip
              label={isRunning ? 'live' : run.status}
              color={isRunning || run.status === 'error' ? 'error' : 'default'}
              size="small"
            />
            {run.trace_id && (
              <a
                href={traceLink(run.trace_id)}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                style={{ color: '#3b82f6' }}
                title="View trace in Grafana Tempo"
              >
                <ExternalLink size={14} />
              </a>
            )}
            <Typography variant="caption" color="text.secondary" noWrap>
              {format(new Date(run.created_at), 'MMM d HH:mm:ss')}
            </Typography>
          </Box>
        </Box>
      </Box>

      {expanded && (
        <CardContent sx={{ px: 2, pb: 2, pt: 0, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', gap: 1 }}>
          {allMessages.length > 0 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pt: 1 }}>
              {allMessages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))}
              {isRunning && wsStatus === 'running' && (
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Bot size={16} style={{ marginTop: 4, flexShrink: 0, color: '#6b7280' }} />
                  <Box sx={{ bgcolor: 'grey.100', borderRadius: 1, px: 1.5, py: 0.75, fontSize: 12, color: 'text.secondary', animation: 'pulse 2s infinite' }}>
                    Thinking…
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {allMessages.length === 0 && (
            <>
              {run.user_msg && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
                  <Box sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', borderRadius: '16px 16px 4px 16px', px: 2, py: 1, maxWidth: '80%', fontSize: 14 }}>
                    {run.user_msg}
                  </Box>
                </Box>
              )}
              {steps.map((step, i) => <StepBlock key={i} step={step} />)}
              {run.reply && (
                <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <Box sx={{ bgcolor: 'grey.100', borderRadius: '16px 16px 16px 4px', px: 2, py: 1, maxWidth: '80%', fontSize: 14, whiteSpace: 'pre-wrap' }}>
                    {run.reply}
                  </Box>
                </Box>
              )}
            </>
          )}

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 12, color: 'text.secondary', pt: 0.5, borderTop: 1, borderColor: 'divider', mt: 1 }}>
            <Typography variant="caption">run_id: <code>{run.run_id.slice(0, 12)}…</code></Typography>
            {run.trace_id && (
              <a href={traceLink(run.trace_id)} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#3b82f6', fontSize: 12 }}>
                <ExternalLink size={12} /> trace
              </a>
            )}
          </Box>
        </CardContent>
      )}
    </Card>
  )
}

// ── Message bubble ─────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'
  const isSystem = message.role === 'system'

  if (isSystem) {
    return (
      <Box sx={{ textAlign: 'center' }}>
        <Typography variant="caption" sx={{ bgcolor: 'grey.100', borderRadius: 0.5, px: 1, py: 0.25 }}>
          {message.content}
        </Typography>
      </Box>
    )
  }

  if (isTool) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, bgcolor: '#fffbeb', border: 1, borderColor: '#fde68a', borderRadius: 1, px: 1.5, py: 1.25, fontSize: 12 }}>
        <Wrench size={14} style={{ marginTop: 2, flexShrink: 0, color: '#d97706' }} />
        <Box sx={{ minWidth: 0 }}>
          {message.name && <Typography variant="caption" sx={{ fontWeight: 600, color: '#92400e', display: 'block' }}>{message.name}</Typography>}
          <pre style={{ margin: 0, fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#6b7280' }}>{message.content}</pre>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1, justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      {!isUser && <Bot size={16} style={{ marginTop: 4, flexShrink: 0, color: '#6b7280' }} />}
      <Box sx={{
        maxWidth: '80%', borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
        px: 2, py: 1, fontSize: 14, whiteSpace: 'pre-wrap',
        bgcolor: isUser ? 'primary.main' : 'grey.100',
        color: isUser ? 'primary.contrastText' : 'text.primary',
        border: isUser ? 0 : 1, borderColor: 'divider',
      }}>
        {message.name && !isUser && (
          <Typography variant="caption" sx={{ display: 'block', opacity: 0.6, mb: 0.5, fontWeight: 500 }}>
            {message.name}
          </Typography>
        )}
        {message.content}
        {message.url && (
          <a href={message.url} target="_blank" rel="noreferrer"
            style={{ display: 'block', marginTop: 4, fontSize: 12, opacity: 0.7, textDecoration: 'underline' }}>
            {message.url}
          </a>
        )}
      </Box>
      {isUser && <User size={16} style={{ marginTop: 4, flexShrink: 0, color: '#6b7280' }} />}
    </Box>
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
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <Box
        component="button"
        onClick={() => setExpanded(v => !v)}
        sx={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25,
          bgcolor: 'grey.50', border: 0, cursor: 'pointer', textAlign: 'left',
          '&:hover': { bgcolor: 'grey.100' },
        }}
      >
        <Terminal size={14} style={{ color: '#6b7280' }} />
        <Typography variant="caption" sx={{ fontWeight: 500 }} color="text.secondary">Agent Logs</Typography>
        <Box sx={{
          ml: 0.5, width: 6, height: 6, borderRadius: '50%',
          bgcolor: connected ? '#22c55e' : 'grey.400',
        }} />
        {logs.length > 0 && (
          <Chip label={logs.length} size="small" sx={{ fontSize: 10, height: 16 }} />
        )}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {logs.length > 0 && (
            <Typography
              variant="caption"
              color="text.secondary"
              onClick={e => { e.stopPropagation(); setLogs([]) }}
              sx={{ px: 0.5, '&:hover': { color: 'text.primary' } }}
            >
              Clear
            </Typography>
          )}
          <ChevronRight size={14} style={{ color: '#9ca3af', transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 0.2s' }} />
        </Box>
      </Box>

      {expanded && (
        <Box
          ref={scrollRef}
          sx={{
            maxHeight: 208, overflowY: 'auto', bgcolor: '#0d0d0d', px: 2, py: 1.5,
            fontFamily: 'monospace', fontSize: 12,
          }}
        >
          {logs.length === 0 ? (
            <Typography sx={{ color: '#52525b', textAlign: 'center', py: 1.5, fontSize: 12, fontFamily: 'monospace' }}>
              {connected ? 'Waiting for log events…' : 'Connecting to log stream…'}
            </Typography>
          ) : (
            logs.map((l, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1.5, lineHeight: 1.6 }}>
                <Box component="span" sx={{ color: '#52525b', flexShrink: 0, userSelect: 'none' }}>{l.ts.slice(11, 23)}</Box>
                {l.source && <Box component="span" sx={{ color: '#60a5fa', opacity: 0.7, flexShrink: 0 }}>[{l.source}]</Box>}
                <Box component="span" sx={{ color: '#4ade80', opacity: 0.9, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{l.msg}</Box>
              </Box>
            ))
          )}
        </Box>
      )}
    </Box>
  )
}

// ── Step block (legacy atom SDK steps) ────────────────────────────────────────

function StepBlock({ step }: { step: Step }) {
  if (step.type === 'thinking') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, fontSize: 12, color: 'text.secondary', fontStyle: 'italic', borderLeft: 2, borderColor: 'grey.300', pl: 1.5, py: 0.5 }}>
        <Brain size={14} style={{ marginTop: 2, flexShrink: 0 }} />
        <Typography variant="caption" sx={{ whiteSpace: 'pre-wrap' }}>{step.text}</Typography>
      </Box>
    )
  }
  if (step.type === 'tool_use') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, bgcolor: '#fffbeb', border: 1, borderColor: '#fde68a', borderRadius: 1, px: 1.5, py: 1.25 }}>
        <Wrench size={14} style={{ marginTop: 2, flexShrink: 0, color: '#d97706' }} />
        <Box>
          <Typography variant="caption" sx={{ fontWeight: 600, color: '#92400e' }}>{step.name}</Typography>
          {step.input && Object.keys(step.input).length > 0 && (
            <pre style={{ margin: '4px 0 0', fontSize: 11, fontFamily: 'monospace', whiteSpace: 'pre-wrap', color: '#6b7280' }}>
              {JSON.stringify(step.input, null, 2)}
            </pre>
          )}
        </Box>
      </Box>
    )
  }
  if (step.type === 'tool_result') {
    return (
      <Box sx={{ fontSize: 12, color: 'text.secondary', bgcolor: 'grey.100', borderRadius: 1, px: 1.5, py: 1, fontFamily: 'monospace', whiteSpace: 'pre-wrap', border: 1, borderColor: 'divider' }}>
        {step.content}
      </Box>
    )
  }
  return null
}
