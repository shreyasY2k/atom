/**
 * ATOM Agent Platform — Chat (session-aware)
 *
 * Three-panel layout:
 *
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │ Agent panel (260px) │ Session panel (200px) │ Chat (flex-1) │
 *  │ Deployed agents     │ Sessions for agent    │ Messages       │
 *  │ Name, status, SA id │ + New Session button  │ + Input bar    │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * On xs screens the agent panel collapses to icons.
 * On < md the session panel is hidden behind a toggle drawer.
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import SendIcon from '@mui/icons-material/Send'
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined'
import SearchIcon from '@mui/icons-material/Search'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined'
import { builderApi } from '../../api/builder'
import type { SessionRecord, MessageRecord } from '../../api/builder'
import type { AgentRecord } from '../../types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Deterministic hsl color from a string — avoids hard-coded hex in avatar backgrounds */
function nameToHsl(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff
  return `hsl(${h % 360}, 55%, 42%)`
}

function AgentAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <Avatar
      sx={{
        width: size,
        height: size,
        bgcolor: nameToHsl(name),
        flexShrink: 0,
        fontSize: size * 0.45,
        fontWeight: 700,
      }}
    >
      {name.slice(0, 2).toUpperCase()}
    </Avatar>
  )
}

// ── Typing indicator ──────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, py: 0.5, px: 0.5 }}>
      {[0, 150, 300].map(delay => (
        <Box
          key={delay}
          sx={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            bgcolor: 'text.disabled',
            animation: 'chatBounce 1.1s ease-in-out infinite',
            animationDelay: `${delay}ms`,
            '@keyframes chatBounce': {
              '0%, 100%': { transform: 'translateY(0)' },
              '50%': { transform: 'translateY(-5px)' },
            },
          }}
        />
      ))}
    </Box>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

interface BubbleProps {
  msg: MessageRecord
  agentName: string
  isLoading?: boolean
}

function MessageBubble({ msg, agentName, isLoading }: BubbleProps) {
  const isUser = msg.role === 'user'

  if (isUser) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, alignItems: 'flex-end', mb: 1.5 }}>
        <Paper
          sx={{
            maxWidth: '70%',
            px: 2,
            py: 1.25,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            borderRadius: '18px 18px 4px 18px',
            boxShadow: 'none',
          }}
        >
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {msg.content}
          </Typography>
        </Paper>
        <Avatar sx={{ width: 28, height: 28, bgcolor: 'action.active', flexShrink: 0, fontSize: 14 }}>
          👤
        </Avatar>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', mb: 2 }}>
      <AgentAvatar name={agentName} size={28} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" fontWeight={700} display="block" sx={{ mb: 0.5 }}>
          {agentName}
        </Typography>
        {isLoading ? (
          <Paper
            variant="outlined"
            sx={{ display: 'inline-flex', px: 1.5, py: 0.5, borderRadius: '4px 18px 18px 18px', bgcolor: 'background.paper' }}
          >
            <TypingDots />
          </Paper>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              px: 2,
              py: 1.5,
              borderRadius: '4px 18px 18px 18px',
              bgcolor: 'background.paper',
              borderColor: 'divider',
              maxWidth: '70%',
            }}
          >
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {msg.content}
            </Typography>
            {msg.run_id && (
              <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.5, fontSize: '0.6rem' }}>
                run: {msg.run_id.slice(0, 16)}…
              </Typography>
            )}
          </Paper>
        )}
      </Box>
    </Box>
  )
}

// ── Agent panel ───────────────────────────────────────────────────────────────

interface AgentPanelProps {
  agents: AgentRecord[]
  selected: AgentRecord | null
  filter: string
  onFilterChange: (v: string) => void
  onSelect: (a: AgentRecord) => void
  collapsed: boolean
}

function AgentPanel({ agents, selected, filter, onFilterChange, onSelect, collapsed }: AgentPanelProps) {
  const visible = agents.filter(a =>
    !filter || a.name.toLowerCase().includes(filter.toLowerCase())
  )

  if (collapsed) {
    return (
      <Box
        sx={{
          width: 52,
          flexShrink: 0,
          borderRight: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          py: 1,
          gap: 0.5,
          overflowY: 'auto',
        }}
      >
        {visible.map(a => (
          <Tooltip key={a.name} title={a.name} placement="right">
            <Box
              component="button"
              onClick={() => onSelect(a)}
              sx={{
                background: 'none',
                border: '2px solid',
                borderColor: selected?.name === a.name ? 'primary.main' : 'transparent',
                borderRadius: '50%',
                p: 0,
                cursor: 'pointer',
                mb: 0.25,
              }}
            >
              <AgentAvatar name={a.name} size={34} />
            </Box>
          </Tooltip>
        ))}
      </Box>
    )
  }

  return (
    <Box
      sx={{
        width: 260,
        flexShrink: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.62rem', display: 'block', mb: 1 }}>
          Deployed Agents
        </Typography>
        <TextField
          size="small"
          placeholder="Filter agents…"
          value={filter}
          onChange={e => onFilterChange(e.target.value)}
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
              </InputAdornment>
            ),
            sx: { fontSize: '0.8rem' },
          }}
          sx={{ '& .MuiOutlinedInput-root': { borderRadius: 1.5 } }}
        />
      </Box>

      <List dense disablePadding sx={{ flex: 1, overflowY: 'auto' }}>
        {visible.length === 0 && (
          <Box sx={{ px: 2, py: 3, textAlign: 'center' }}>
            <Typography variant="caption" color="text.disabled">
              {agents.length === 0 ? 'No deployed agents.' : 'No agents match filter.'}
            </Typography>
          </Box>
        )}
        {visible.map(a => (
          <ListItemButton
            key={a.name}
            selected={selected?.name === a.name}
            onClick={() => onSelect(a)}
            sx={{ px: 1.5, py: 1, gap: 1.25 }}
          >
            <AgentAvatar name={a.name} size={30} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                <Typography variant="body2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0, fontSize: '0.82rem' }}>
                  {a.name}
                </Typography>
                <Chip
                  label={a.status}
                  size="small"
                  color={a.status === 'deployed' ? 'success' : 'default'}
                  sx={{ height: 16, fontSize: '0.58rem', flexShrink: 0 }}
                />
              </Box>
              {a.service_account_id && (
                <Typography
                  variant="caption"
                  color="text.disabled"
                  noWrap
                  sx={{ fontFamily: 'monospace', fontSize: '0.62rem', display: 'block' }}
                >
                  {a.service_account_id.slice(-16)}
                </Typography>
              )}
            </Box>
          </ListItemButton>
        ))}
      </List>
    </Box>
  )
}

// ── Session panel ─────────────────────────────────────────────────────────────

interface SessionPanelProps {
  sessions: SessionRecord[]
  selected: SessionRecord | null
  loading: boolean
  onSelect: (s: SessionRecord) => void
  onNew: () => void
  onEnd: () => void
  creatingSession: boolean
}

function SessionPanel({
  sessions, selected, loading, onSelect, onNew, onEnd, creatingSession,
}: SessionPanelProps) {
  return (
    <Box
      sx={{
        width: 200,
        flexShrink: 0,
        borderRight: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.default',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* Header */}
      <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" fontWeight={700} color="text.secondary"
          sx={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.07em', fontSize: '0.62rem' }}>
          Sessions
        </Typography>
        <Tooltip title="New Session">
          <span>
            <IconButton
              size="small"
              onClick={onNew}
              disabled={creatingSession}
              sx={{ color: 'primary.main' }}
            >
              {creatingSession ? <CircularProgress size={14} /> : <AddIcon sx={{ fontSize: 16 }} />}
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {selected && (
        <Box sx={{ px: 1.5, pb: 0.75 }}>
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<StopCircleOutlinedIcon sx={{ fontSize: 14 }} />}
            onClick={onEnd}
            disabled={selected.status === 'ended'}
            fullWidth
            sx={{ fontSize: '0.7rem', py: 0.25 }}
          >
            End Session
          </Button>
        </Box>
      )}

      <Divider />

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <CircularProgress size={16} />
        </Box>
      )}

      {!loading && sessions.length === 0 && (
        <Box sx={{ px: 1.5, py: 2, textAlign: 'center' }}>
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.72rem' }}>
            No sessions yet.{'\n'}Send a message to start one.
          </Typography>
        </Box>
      )}

      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {sessions.map(s => (
          <Box
            key={s.session_id}
            component="button"
            onClick={() => onSelect(s)}
            sx={{
              width: '100%',
              textAlign: 'left',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              px: 1.5,
              py: 0.875,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: selected?.session_id === s.session_id ? 'action.selected' : 'transparent',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
              <Typography
                variant="caption"
                fontFamily="monospace"
                noWrap
                sx={{ flex: 1, fontSize: '0.68rem', color: 'text.primary' }}
              >
                {s.session_id.slice(0, 12)}…
              </Typography>
              <Chip
                label={s.status}
                size="small"
                color={s.status === 'active' ? 'success' : 'default'}
                sx={{ height: 14, fontSize: '0.56rem', flexShrink: 0 }}
              />
            </Box>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.62rem', display: 'block' }}>
              {timeAgo(s.created_at)}
              {s.message_count !== undefined ? ` · ${s.message_count} msg` : ''}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Optimistic message type ───────────────────────────────────────────────────

interface OptimisticMessage extends MessageRecord {
  _loading?: boolean
  _error?: boolean
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Chat() {
  const theme = useTheme()
  const isMd = useMediaQuery(theme.breakpoints.up('md'))
  const isXs = useMediaQuery(theme.breakpoints.down('sm'))

  // ── State ──────────────────────────────────────────────────────────────────
  const [agents, setAgents] = useState<AgentRecord[]>([])
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null)
  const [agentFilter, setAgentFilter] = useState('')

  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null)

  const [messages, setMessages] = useState<OptimisticMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)

  const [input, setInput] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [showWorkspace, setShowWorkspace] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Mobile: session drawer open
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)

  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Load deployed agents ───────────────────────────────────────────────────
  useEffect(() => {
    builderApi.listAgents()
      .then(d => {
        const deployed = (d.agents ?? []).filter(a => a.status === 'deployed')
        setAgents(deployed)
        if (deployed.length > 0 && !selectedAgent) {
          setSelectedAgent(deployed[0])
        }
      })
      .catch(() => setError('Failed to load agents'))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load sessions when agent changes ──────────────────────────────────────
  useEffect(() => {
    if (!selectedAgent) { setSessions([]); setSelectedSession(null); setMessages([]); return }
    setSessionsLoading(true)
    setSelectedSession(null)
    setMessages([])
    builderApi.listSessions(selectedAgent.name)
      .then(d => {
        const list = d.sessions ?? []
        setSessions(list)
        // Auto-select the most recent active session
        const active = list.find(s => s.status === 'active') ?? list[0] ?? null
        setSelectedSession(active)
      })
      .catch(() => setError('Failed to load sessions'))
      .finally(() => setSessionsLoading(false))
  }, [selectedAgent?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load messages when session changes ────────────────────────────────────
  useEffect(() => {
    if (!selectedAgent || !selectedSession) { setMessages([]); return }
    setMessagesLoading(true)
    builderApi.getSession(selectedAgent.name, selectedSession.session_id)
      .then(d => setMessages(d.messages ?? []))
      .catch(() => setError('Failed to load messages'))
      .finally(() => setMessagesLoading(false))
  }, [selectedSession?.session_id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-scroll on new messages ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // ── Refresh sessions list ─────────────────────────────────────────────────
  async function refreshSessions() {
    if (!selectedAgent) return
    const d = await builderApi.listSessions(selectedAgent.name)
    setSessions(d.sessions ?? [])
  }

  // ── Create session ─────────────────────────────────────────────────────────
  async function handleNewSession() {
    if (!selectedAgent) return
    setCreatingSession(true)
    setError(null)
    try {
      const d = await builderApi.createSession(selectedAgent.name, workspaceId || undefined)
      await refreshSessions()
      // Select the new session
      const newSession: SessionRecord = {
        session_id: d.session_id,
        agent_name: selectedAgent.name,
        owner: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        status: 'active',
        message_count: 0,
      }
      setSelectedSession(newSession)
      setMessages([])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session')
    } finally {
      setCreatingSession(false)
    }
  }

  // ── End session ────────────────────────────────────────────────────────────
  async function handleEndSession() {
    if (!selectedAgent || !selectedSession) return
    setError(null)
    try {
      await builderApi.endSession(selectedAgent.name, selectedSession.session_id)
      await refreshSessions()
      setSelectedSession(prev => prev ? { ...prev, status: 'ended' } : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to end session')
    }
  }

  // ── Send message ───────────────────────────────────────────────────────────
  async function handleSend() {
    const text = input.trim()
    if (!text || !selectedAgent || sending) return
    setInput('')
    setSending(true)
    setError(null)

    let sessionId = selectedSession?.session_id ?? null

    // Auto-create session if none selected
    if (!sessionId) {
      setCreatingSession(true)
      try {
        const d = await builderApi.createSession(selectedAgent.name, workspaceId || undefined)
        sessionId = d.session_id
        await refreshSessions()
        const newSession: SessionRecord = {
          session_id: d.session_id,
          agent_name: selectedAgent.name,
          owner: '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          status: 'active',
          message_count: 0,
        }
        setSelectedSession(newSession)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create session')
        setSending(false)
        setCreatingSession(false)
        setInput(text)
        return
      } finally {
        setCreatingSession(false)
      }
    }

    // Optimistic user message
    const optimisticUser: OptimisticMessage = {
      message_id: `opt-u-${Date.now()}`,
      session_id: sessionId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    }
    // Loading placeholder for assistant
    const loadingAssistant: OptimisticMessage = {
      message_id: `opt-a-${Date.now()}`,
      session_id: sessionId,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString(),
      _loading: true,
    }
    setMessages(prev => [...prev, optimisticUser, loadingAssistant])

    try {
      const resp = await builderApi.sendMessage(
        selectedAgent.name,
        sessionId,
        text,
        workspaceId || undefined,
      )
      const assistantMsg: OptimisticMessage = {
        message_id: `resp-${Date.now()}`,
        session_id: sessionId,
        role: 'assistant',
        content: resp.content,
        created_at: new Date().toISOString(),
        run_id: resp.run_id,
      }
      setMessages(prev => prev
        .filter(m => m.message_id !== loadingAssistant.message_id)
        .concat(assistantMsg)
      )
      await refreshSessions()
    } catch (e) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e)
      const errorMsg: OptimisticMessage = {
        message_id: `err-${Date.now()}`,
        session_id: sessionId,
        role: 'assistant',
        content: `Error: ${msg}`,
        created_at: new Date().toISOString(),
        _error: true,
      }
      setMessages(prev => prev
        .filter(m => m.message_id !== loadingAssistant.message_id)
        .concat(errorMsg)
      )
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const isSessionEnded = selectedSession?.status === 'ended'
  const inputDisabled = !selectedAgent || sending || isSessionEnded
  const saId = selectedAgent?.service_account_id ?? ''

  // ── Session panel (used in both desktop and mobile drawer) ────────────────
  const sessionPanelContent = selectedAgent ? (
    <SessionPanel
      sessions={sessions}
      selected={selectedSession}
      loading={sessionsLoading}
      onSelect={s => { setSelectedSession(s); if (!isMd) setSessionDrawerOpen(false) }}
      onNew={handleNewSession}
      onEnd={handleEndSession}
      creatingSession={creatingSession}
    />
  ) : null

  return (
    <Box sx={{ display: 'flex', height: '100%', overflow: 'hidden', bgcolor: 'background.default' }}>

      {/* ── Agent Panel ──────────────────────────────────────────────────── */}
      <AgentPanel
        agents={agents}
        selected={selectedAgent}
        filter={agentFilter}
        onFilterChange={setAgentFilter}
        onSelect={a => { setSelectedAgent(a); setAgentFilter('') }}
        collapsed={isXs}
      />

      {/* ── Session Panel — desktop ───────────────────────────────────────── */}
      {isMd && sessionPanelContent}

      {/* ── Session Panel — mobile drawer ────────────────────────────────── */}
      {!isMd && (
        <Drawer
          open={sessionDrawerOpen}
          onClose={() => setSessionDrawerOpen(false)}
          anchor="left"
          PaperProps={{ sx: { width: 220, left: isXs ? 52 : 260, top: 64, height: 'calc(100% - 64px)' } }}
          ModalProps={{ keepMounted: true }}
        >
          {sessionPanelContent}
        </Drawer>
      )}

      {/* ── Chat area ────────────────────────────────────────────────────── */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Chat header bar */}
        <Box sx={{
          px: 2,
          py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          flexShrink: 0,
        }}>
          {selectedAgent ? (
            <>
              <AgentAvatar name={selectedAgent.name} size={24} />
              <Typography variant="subtitle2" fontWeight={600} noWrap sx={{ flex: 1, minWidth: 0 }}>
                {selectedAgent.name}
              </Typography>
              {saId && (
                <Chip
                  label={saId.slice(-16)}
                  size="small"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.6rem',
                    bgcolor: 'action.selected',
                    color: 'secondary.main',
                    flexShrink: 0,
                  }}
                />
              )}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Select an agent to start chatting</Typography>
          )}

          {/* Mobile: sessions toggle */}
          {!isMd && selectedAgent && (
            <Tooltip title="Sessions">
              <IconButton size="small" onClick={() => setSessionDrawerOpen(v => !v)} sx={{ ml: 'auto' }}>
                <ForumOutlinedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          )}

          {/* Selected session chip */}
          {selectedSession && (
            <Chip
              label={selectedSession.session_id.slice(0, 10) + '…'}
              size="small"
              variant="outlined"
              color={selectedSession.status === 'active' ? 'success' : 'default'}
              sx={{ fontFamily: 'monospace', fontSize: '0.6rem', flexShrink: 0 }}
            />
          )}
        </Box>

        {/* Error banner */}
        {error && (
          <Alert severity="error" onClose={() => setError(null)} sx={{ mx: 2, mt: 1, fontSize: '0.8rem' }}>
            {error}
          </Alert>
        )}

        {/* Messages scroll area */}
        <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 1.5, sm: 3, md: 4 }, py: 3, bgcolor: 'background.default' }}>

          {/* Empty state — no agent */}
          {!selectedAgent && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
              <Typography variant="body2" color="text.secondary">
                Select a deployed agent from the left panel.
              </Typography>
            </Box>
          )}

          {/* Empty state — agent but no session */}
          {selectedAgent && !selectedSession && !sessionsLoading && (
            <Box sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: 2,
              textAlign: 'center',
            }}>
              <AgentAvatar name={selectedAgent.name} size={52} />
              <Typography variant="h6" fontWeight={600}>{selectedAgent.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '60%', textAlign: 'center' }}>
                No session selected. Type a message and it will create a session automatically,
                or use the Sessions panel to create one first.
              </Typography>
            </Box>
          )}

          {/* Session ended notice */}
          {selectedSession?.status === 'ended' && (
            <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
              <Chip label="Session ended" size="small" color="default" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            </Box>
          )}

          {/* Messages loading */}
          {messagesLoading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={24} />
            </Box>
          )}

          {/* Messages */}
          {!messagesLoading && messages.map(msg => (
            <MessageBubble
              key={msg.message_id}
              msg={msg}
              agentName={selectedAgent?.name ?? 'agent'}
              isLoading={msg._loading}
            />
          ))}

          <div ref={bottomRef} />
        </Box>

        {/* Workspace ID toggle */}
        <Box sx={{ px: { xs: 1.5, sm: 2 }, pt: 0.5, bgcolor: 'background.paper', borderTop: '1px solid', borderColor: 'divider' }}>
          <Box
            component="button"
            onClick={() => setShowWorkspace(v => !v)}
            sx={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              py: 0.5,
              color: 'text.secondary',
              fontSize: '0.7rem',
            }}
          >
            {showWorkspace ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
            Workspace ID (optional)
          </Box>
          <Collapse in={showWorkspace}>
            <TextField
              size="small"
              placeholder="e.g. customer-acct-123"
              value={workspaceId}
              onChange={e => setWorkspaceId(e.target.value)}
              sx={{ mb: 1, '& .MuiInputBase-root': { fontSize: '0.8rem', height: 32 } }}
              fullWidth
            />
          </Collapse>
        </Box>

        {/* Input bar */}
        <Box sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, bgcolor: 'background.paper' }}>
          <Paper
            variant="outlined"
            sx={{ display: 'flex', flexDirection: 'column', borderRadius: 2, overflow: 'hidden' }}
          >
            <Box
              component="textarea"
              ref={textareaRef}
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={inputDisabled}
              rows={3}
              placeholder={
                !selectedAgent
                  ? 'Select an agent first…'
                  : isSessionEnded
                  ? 'Session ended — create a new session to continue'
                  : creatingSession
                  ? 'Creating session…'
                  : 'Message… (Enter to send, Shift+Enter for newline)'
              }
              sx={{
                width: '100%',
                border: 'none',
                outline: 'none',
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: '0.875rem',
                px: 1.5,
                pt: 1.25,
                pb: 0.5,
                bgcolor: 'transparent',
                lineHeight: 1.6,
                color: 'text.primary',
                '&::placeholder': { color: 'text.disabled' },
                '&:disabled': { color: 'text.disabled', cursor: 'not-allowed' },
              }}
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pb: 1, pt: 0.25 }}>
              <Box sx={{ flex: 1 }} />
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem', mr: 0.5 }}>
                {input.length > 0 ? `${input.length} chars` : ''}
              </Typography>
              <Tooltip title={sending ? 'Sending…' : isSessionEnded ? 'Session ended' : 'Send (Enter)'}>
                <span>
                  <IconButton
                    onClick={handleSend}
                    disabled={!input.trim() || inputDisabled}
                    sx={{
                      bgcolor: 'primary.main',
                      color: 'primary.contrastText',
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      '&:hover': { bgcolor: 'primary.dark' },
                      '&.Mui-disabled': { bgcolor: 'action.disabledBackground', color: 'action.disabled' },
                    }}
                  >
                    {sending ? (
                      <CircularProgress size={16} color="inherit" />
                    ) : (
                      <SendIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Paper>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', mt: 0.5, textAlign: 'center', fontSize: '0.65rem' }}>
            ↵ to send · Shift+↵ for new line
          </Typography>
        </Box>
      </Box>
    </Box>
  )
}
