import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, IconButton, Paper, Stack, Tab, Tabs,
  TextField, Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import SendIcon from '@mui/icons-material/Send'
import AddIcon from '@mui/icons-material/Add'
import DownloadIcon from '@mui/icons-material/Download'
import SecurityIcon from '@mui/icons-material/Security'
import GppBadIcon from '@mui/icons-material/GppBad'
import EditIcon from '@mui/icons-material/Edit'
import { builderApi, type DeploymentRecord, type SessionRecord, type MessageRecord } from '../../api/builder'
import { useAuth } from '../../context/AuthContext'
import DeploymentThread from '../../components/DeploymentThread'
import type { AgentRecord, GuardrailViolationError, GuardrailLayerResult } from '../../types'
import { isGuardrailViolation } from '../../types'

const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending: 'warning', approved: 'success', rejected: 'error',
  bypassed: 'info', changes_requested: 'warning',
  deploying: 'warning', deployed: 'success', failed: 'error',
}

function fmt(ts?: string | null) {
  return ts ? ts.slice(0, 19).replace('T', ' ') : '—'
}

function DeploymentCard({ rec }: { rec: DeploymentRecord }) {
  const [open, setOpen] = useState(false)

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box
        sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
        onClick={() => setOpen(v => !v)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">
              {rec.deployment_id}
            </Typography>
            <Typography variant="body2" fontWeight={600}>v{rec.target_version}</Typography>
            <Chip size="small" label={rec.approval_status.replace('_', ' ')}
              color={STATUS_COLOR[rec.approval_status] ?? 'default'}
              sx={{ height: 18, fontSize: '0.65rem' }} />
            <Chip size="small" label={rec.deploy_status} variant="outlined"
              color={STATUS_COLOR[rec.deploy_status] ?? 'default'}
              sx={{ height: 18, fontSize: '0.65rem' }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">{fmt(rec.requested_at)}</Typography>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          Requested by {rec.requested_by}
          {rec.approved_by && ` · ${rec.approval_status === 'rejected' ? 'Rejected' : 'Reviewed'} by ${rec.approved_by}`}
          {rec.service_account_id && ` · NHI: ${rec.service_account_id}`}
        </Typography>
      </Box>

      <Collapse in={open}>
        <Divider />
        <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" sx={{ mb: 1.5, letterSpacing: '0.06em' }}>
            APPROVAL THREAD
          </Typography>
          <DeploymentThread record={rec} />
          {rec.spec_hash && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 2 }}>
              spec {rec.spec_hash.slice(0, 30)}…
              {rec.code_hash ? ` · code ${rec.code_hash.slice(0, 20)}…` : ''}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

function OverviewTab({ agent }: { agent: AgentRecord }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()

  const deployMut = useMutation({
    mutationFn: (): Promise<AgentRecord | DeploymentRecord> => {
      if (role === 'builder') return builderApi.submitDeployRequest(agent.name)
      if (role === 'platform_admin') return builderApi.deployDirect(agent.name)
      return builderApi.deployAgent(agent.name)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agent.name] }),
  })

  const delMut = useMutation({
    mutationFn: () => builderApi.deleteAgent(agent.name),
    onSuccess: () => navigate('/agents'),
  })

  const editMut = useMutation({
    mutationFn: () => builderApi.startEdit(agent.name),
    onSuccess: () => navigate(`/agents/build?edit=${encodeURIComponent(agent.name)}`),
  })

  const deployLabel = role === 'builder' ? 'Submit for Approval'
    : role === 'platform_admin' ? 'Redeploy (bypass)' : 'Redeploy'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 1 }}>
          {[
            ['Status', <Chip key="s" label={agent.status} size="small"
              color={agent.status === 'deployed' ? 'success' : 'default'}
              variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />],
            ['Version', `v${agent.version}`],
            ['Owner', agent.owner],
            ['Deployed', fmt(agent.deployed_at)],
            ['Endpoint', agent.endpoint || '—'],
            ['Spec hash', agent.spec_hash?.slice(0, 24) + '…'],
          ].map(([k, v]) => (
            <React.Fragment key={String(k)}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{k}</Typography>
              {typeof v === 'string'
                ? <Typography variant="caption" fontFamily="monospace">{v}</Typography>
                : v}
            </React.Fragment>
          ))}
        </Box>
        {agent.service_account_id && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>NHI</Typography>
            <Chip label={agent.service_account_id} size="small"
              sx={{ fontFamily: 'monospace', bgcolor: 'action.selected', color: 'secondary.main', fontSize: '0.65rem' }} />
          </Box>
        )}
        <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <SecurityIcon sx={{ fontSize: 14, color: 'primary.main' }} />
          <Typography variant="caption" color="text.secondary" fontWeight={600}>Guardrails</Typography>
          <Chip
            icon={<SecurityIcon sx={{ fontSize: '0.7rem !important' }} />}
            label="AgentArmor: Active"
            size="small"
            color="primary"
            variant="outlined"
            sx={{ height: 18, fontSize: '0.65rem' }}
          />
        </Box>
      </Paper>

      {deployMut.isSuccess && 'deployment_id' in (deployMut.data as object) && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          Request submitted: {(deployMut.data as DeploymentRecord).deployment_id}
        </Alert>
      )}
      {deployMut.isSuccess && !('deployment_id' in (deployMut.data as object)) && (
        <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
          Redeployed — new NHI: {(deployMut.data as AgentRecord).service_account_id}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" variant="contained"
          startIcon={deployMut.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlineIcon />}
          onClick={() => deployMut.mutate()} disabled={deployMut.isPending}>
          {deployLabel}
        </Button>
        <Tooltip title="Edit spec, role and behavior, then regenerate and redeploy">
          <Button size="small" variant="outlined"
            startIcon={editMut.isPending ? <CircularProgress size={12} /> : <EditIcon />}
            onClick={() => editMut.mutate()} disabled={editMut.isPending}>
            Edit Agent
          </Button>
        </Tooltip>
        <Button size="small" variant="outlined" color="primary"
          onClick={() => navigate(`/chat?agent=${agent.name}`)}>
          Test in Chat
        </Button>
        <Button size="small" variant="outlined" color="error"
          onClick={() => delMut.mutate()} disabled={delMut.isPending}>
          Undeploy
        </Button>
      </Box>
    </Stack>
  )
}

function DeploymentsTab({ name }: { name: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-deployments', name],
    queryFn: () => builderApi.listAgentDeployments(name),
    refetchInterval: 5000,
  })
  const records = data?.deployments ?? []

  if (isLoading) return <CircularProgress size={20} />
  if (!records.length) return (
    <Typography variant="body2" color="text.secondary">No deployment history yet.</Typography>
  )

  return (
    <Stack spacing={1.5}>
      {records.map(r => <DeploymentCard key={r.deployment_id} rec={r} />)}
    </Stack>
  )
}

// ---- Sessions tab ----

interface NewSessionDialogProps {
  open: boolean
  onClose: () => void
  onCreate: (workspaceId?: string) => void
  loading: boolean
}

function NewSessionDialog({ open, onClose, onCreate, loading }: NewSessionDialogProps) {
  const [workspaceId, setWorkspaceId] = useState('')

  function handleCreate() {
    onCreate(workspaceId.trim() || undefined)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '0.95rem', fontWeight: 600 }}>New Session</DialogTitle>
      <DialogContent>
        <TextField
          label="Workspace ID (optional)"
          value={workspaceId}
          onChange={e => setWorkspaceId(e.target.value)}
          fullWidth
          size="small"
          sx={{ mt: 1 }}
          placeholder="e.g. ws-customer-123"
          disabled={loading}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose} disabled={loading}>Cancel</Button>
        <Button size="small" variant="contained" onClick={handleCreate} disabled={loading}
          startIcon={loading ? <CircularProgress size={12} color="inherit" /> : undefined}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function GuardrailViolationBubble({ violation }: { violation: GuardrailViolationError }) {
  const [open, setOpen] = useState(false)
  const phaseLabel = violation.phase === 'pre_call' ? 'input' : 'output'

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          maxWidth: '80%',
          px: 1.5,
          py: 1,
          borderRadius: 2,
          bgcolor: 'error.50',
          border: 1,
          borderColor: 'error.light',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
          <GppBadIcon sx={{ fontSize: 16, color: 'error.main' }} />
          <Typography variant="caption" fontWeight={700} color="error.main">
            Blocked by AgentArmor
          </Typography>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block">
          Phase: <strong>{phaseLabel}</strong> · Threat: <strong>{violation.threat_level}</strong> · Layer: <strong>{violation.blocked_by}</strong>
        </Typography>
        {violation.layers.length > 0 && (
          <Box sx={{ mt: 0.75 }}>
            <Typography
              variant="caption"
              color="primary"
              sx={{ cursor: 'pointer', textDecoration: 'underline', textDecorationStyle: 'dotted' }}
              onClick={() => setOpen(v => !v)}
            >
              {open ? 'Hide' : 'Show'} layer detail ({violation.layers.length} layers)
            </Typography>
            {open && (
              <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {violation.layers.map((l: GuardrailLayerResult, i: number) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                    <Chip
                      label={l.verdict}
                      size="small"
                      color={l.verdict === 'deny' ? 'error' : l.verdict === 'allow' ? 'success' : 'warning'}
                      sx={{ height: 14, fontSize: '0.58rem' }}
                    />
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
                      {l.layer}{l.message ? ` — ${l.message}` : ''}
                    </Typography>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

interface ChatPanelProps {
  agentName: string
  session: SessionRecord & { messages: MessageRecord[] }
  onEnd: () => void
  onMessageSent: () => void
}

type ChatItem =
  | { kind: 'message'; msg: MessageRecord }
  | { kind: 'guardrail'; violation: GuardrailViolationError; id: string }

function ChatPanel({ agentName, session, onEnd, onMessageSent }: ChatPanelProps) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageRecord[]>(session.messages)
  const [chatItems, setChatItems] = useState<ChatItem[]>(
    session.messages.map(msg => ({ kind: 'message' as const, msg }))
  )
  const bottomRef = useRef<HTMLDivElement>(null)

  // Keep messages in sync when session prop changes (e.g., after reload)
  useEffect(() => {
    setMessages(session.messages)
    setChatItems(session.messages.map(msg => ({ kind: 'message' as const, msg })))
  }, [session.session_id, session.messages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    setSendError(null)
    setText('')

    const optimisticId = `opt-${Date.now()}`
    const optimisticUser: MessageRecord = {
      message_id: optimisticId,
      session_id: session.session_id,
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    }
    setMessages(prev => [...prev, optimisticUser])
    setChatItems(prev => [...prev, { kind: 'message', msg: optimisticUser }])

    try {
      const resp = await builderApi.sendMessage(agentName, session.session_id, trimmed)
      const respRole = resp.role as MessageRecord['role']
      const assistantMsg: MessageRecord = {
        message_id: `resp-${Date.now()}`,
        session_id: session.session_id,
        role: respRole === 'user' || respRole === 'system' ? respRole : 'assistant',
        content: resp.content,
        created_at: new Date().toISOString(),
        run_id: resp.run_id,
      }
      setMessages(prev => [...prev, assistantMsg])
      setChatItems(prev => [...prev, { kind: 'message', msg: assistantMsg }])
      onMessageSent()
    } catch (err) {
      if (isGuardrailViolation(err)) {
        // Keep the user message visible; add a guardrail violation bubble
        setChatItems(prev => [
          ...prev,
          { kind: 'guardrail', violation: err, id: `gv-${Date.now()}` },
        ])
      } else {
        const msg = err instanceof Error ? err.message : JSON.stringify(err)
        setSendError(msg)
        // Remove optimistic message on generic failure
        setMessages(prev => prev.filter(m => m.message_id !== optimisticId))
        setChatItems(prev => prev.filter(i => !(i.kind === 'message' && i.msg.message_id === optimisticId)))
      }
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isEnded = session.status === 'ended'

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* Session header */}
      <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          label={session.session_id.slice(0, 18) + '…'}
          size="small"
          sx={{ fontFamily: 'monospace', fontSize: '0.65rem' }}
        />
        <Chip
          label={session.status}
          size="small"
          color={session.status === 'active' ? 'success' : 'default'}
          sx={{ height: 18, fontSize: '0.65rem' }}
        />
        {session.reme_context && (
          <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
            workspace: {session.reme_context}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          color="error"
          onClick={onEnd}
          disabled={isEnded}
          sx={{ fontSize: '0.72rem', py: 0.25 }}
        >
          End Session
        </Button>
      </Box>

      {/* Messages */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {session.reme_context && (
          <Typography variant="caption" color="text.disabled" sx={{ fontStyle: 'italic', display: 'block', textAlign: 'center', mb: 1 }}>
            ReMe context loaded for workspace: {session.reme_context}
          </Typography>
        )}
        {chatItems.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 4 }}>
            No messages yet. Send a message to start the conversation.
          </Typography>
        )}
        {chatItems.map(item => {
          if (item.kind === 'guardrail') {
            return <GuardrailViolationBubble key={item.id} violation={item.violation} />
          }
          const msg = item.msg
          return (
            <Box
              key={msg.message_id}
              sx={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <Box
                sx={{
                  maxWidth: '75%',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: msg.role === 'user' ? 'primary.main' : 'action.hover',
                  color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                }}
              >
                {msg.role !== 'user' && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.25, fontWeight: 600 }}>
                    {agentName}
                  </Typography>
                )}
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {msg.content}
                </Typography>
                {msg.run_id && (
                  <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 0.25, fontSize: '0.62rem' }}>
                    run: {msg.run_id.slice(0, 16)}…
                  </Typography>
                )}
              </Box>
            </Box>
          )
        })}
        {sending && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
            <Box sx={{ px: 1.5, py: 1, borderRadius: 2, bgcolor: 'action.hover' }}>
              <CircularProgress size={14} />
            </Box>
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      {sendError && (
        <Alert severity="error" onClose={() => setSendError(null)} sx={{ mx: 2, mb: 1, fontSize: '0.8rem' }}>
          {sendError}
        </Alert>
      )}

      {/* Input area */}
      <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isEnded ? 'Session ended' : 'Type a message… (Enter to send, Shift+Enter for newline)'}
          multiline
          maxRows={3}
          fullWidth
          size="small"
          disabled={isEnded || sending}
          sx={{ '& .MuiInputBase-root': { fontSize: '0.85rem' } }}
        />
        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={!text.trim() || isEnded || sending}
          sx={{ mb: 0.25 }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  )
}

function SessionsTab({ name }: { name: string }) {
  const qc = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const [endError, setEndError] = useState<string | null>(null)

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ['agent-sessions', name],
    queryFn: () => builderApi.listSessions(name),
    refetchInterval: 10000,
  })

  const { data: sessionDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['agent-session-detail', name, selectedId],
    queryFn: () => builderApi.getSession(name, selectedId!),
    enabled: !!selectedId,
  })

  const createMut = useMutation({
    mutationFn: (workspaceId?: string) => builderApi.createSession(name, workspaceId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['agent-sessions', name] })
      setSelectedId(data.session_id)
      setDialogOpen(false)
      setCreateError(null)
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      setCreateError(msg)
    },
  })

  const endMut = useMutation({
    mutationFn: (sessionId: string) => builderApi.endSession(name, sessionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent-sessions', name] })
      qc.invalidateQueries({ queryKey: ['agent-session-detail', name, selectedId] })
      setEndError(null)
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      setEndError(msg)
    },
  })

  const sessions = sessionsData?.sessions ?? []

  function handleMessageSent() {
    qc.invalidateQueries({ queryKey: ['agent-session-detail', name, selectedId] })
    qc.invalidateQueries({ queryKey: ['agent-sessions', name] })
  }

  return (
    <Box sx={{ display: 'flex', gap: 2, height: 520, minHeight: 0 }}>
      {/* Left panel: session list */}
      <Box sx={{ width: 280, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Button
          size="small"
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setDialogOpen(true)}
          fullWidth
        >
          New Session
        </Button>
        {createError && (
          <Alert severity="error" onClose={() => setCreateError(null)} sx={{ fontSize: '0.78rem' }}>
            {createError}
          </Alert>
        )}
        {endError && (
          <Alert severity="error" onClose={() => setEndError(null)} sx={{ fontSize: '0.78rem' }}>
            {endError}
          </Alert>
        )}
        {sessionsLoading && <CircularProgress size={16} sx={{ mt: 1 }} />}
        {!sessionsLoading && sessions.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontSize: '0.8rem' }}>
            No sessions yet.
          </Typography>
        )}
        <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {sessions.map(s => (
            <Paper
              key={s.session_id}
              variant="outlined"
              onClick={() => setSelectedId(s.session_id)}
              sx={{
                p: 1.25,
                cursor: 'pointer',
                borderRadius: 1.5,
                borderColor: selectedId === s.session_id ? 'primary.main' : 'divider',
                bgcolor: selectedId === s.session_id ? 'action.selected' : 'background.paper',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                <Typography variant="caption" fontFamily="monospace" color="text.secondary" noWrap sx={{ flex: 1, fontSize: '0.68rem' }}>
                  {s.session_id.slice(0, 22)}…
                </Typography>
                <Chip
                  label={s.status}
                  size="small"
                  color={s.status === 'active' ? 'success' : 'default'}
                  sx={{ height: 16, fontSize: '0.6rem' }}
                />
              </Box>
              <Typography variant="caption" color="text.disabled" display="block" sx={{ fontSize: '0.68rem' }}>
                {fmt(s.created_at)}
                {s.message_count !== undefined ? ` · ${s.message_count} msg` : ''}
              </Typography>
            </Paper>
          ))}
        </Box>
      </Box>

      {/* Divider */}
      <Divider orientation="vertical" flexItem />

      {/* Right panel: chat */}
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
        {!selectedId && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" color="text.secondary">
              Select a session or create a new one
            </Typography>
          </Box>
        )}
        {selectedId && detailLoading && (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <CircularProgress size={24} />
          </Box>
        )}
        {selectedId && !detailLoading && sessionDetail && (
          <ChatPanel
            agentName={name}
            session={sessionDetail}
            onEnd={() => endMut.mutate(selectedId)}
            onMessageSent={handleMessageSent}
          />
        )}
      </Box>

      <NewSessionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreate={(wid) => createMut.mutate(wid)}
        loading={createMut.isPending}
      />
    </Box>
  )
}

// ---- API Docs tab ----

interface OpenApiInfo {
  title?: string
  version?: string
  description?: string
}

interface OpenApiParameter {
  name?: string
  in?: string
  required?: boolean
  description?: string
  schema?: Record<string, unknown>
}

interface OpenApiResponse {
  description?: string
  content?: Record<string, { schema?: Record<string, unknown> }>
}

interface OpenApiRequestBody {
  description?: string
  required?: boolean
  content?: Record<string, { schema?: Record<string, unknown> }>
}

interface OpenApiOperation {
  summary?: string
  description?: string
  tags?: string[]
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses?: Record<string, OpenApiResponse>
}

type HttpMethod = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'head' | 'options'

type PathItem = Partial<Record<HttpMethod, OpenApiOperation>>

interface ParsedSpec {
  info: OpenApiInfo
  tagGroups: Record<string, { path: string; method: string; op: OpenApiOperation }[]>
}

const METHOD_COLOR: Record<string, string> = {
  get: '#2e7d32',
  post: '#1565c0',
  put: '#e65100',
  delete: '#c62828',
  patch: '#6a1b9a',
  head: '#37474f',
  options: '#37474f',
}

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options']

function parseSpec(raw: Record<string, unknown>): ParsedSpec {
  const info = (raw.info ?? {}) as OpenApiInfo
  const rawPaths = (raw.paths ?? {}) as Record<string, PathItem>
  const tagGroups: Record<string, { path: string; method: string; op: OpenApiOperation }[]> = {}

  for (const [path, pathItem] of Object.entries(rawPaths)) {
    for (const method of HTTP_METHODS) {
      const op = (pathItem as PathItem)[method]
      if (!op) continue
      const tags = op.tags?.length ? op.tags : ['default']
      for (const tag of tags) {
        if (!tagGroups[tag]) tagGroups[tag] = []
        tagGroups[tag].push({ path, method, op })
      }
    }
  }

  return { info, tagGroups }
}

function OperationRow({ path, method, op }: { path: string; method: string; op: OpenApiOperation }) {
  const [expanded, setExpanded] = useState(false)

  const reqBodySchema = op.requestBody?.content
    ? Object.values(op.requestBody.content)[0]?.schema
    : undefined

  return (
    <Box>
      <Box
        onClick={() => setExpanded(v => !v)}
        sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75, px: 1, cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: 'action.hover' } }}
      >
        <Chip
          label={method.toUpperCase()}
          size="small"
          sx={{
            bgcolor: METHOD_COLOR[method] ?? '#37474f',
            color: '#fff',
            fontFamily: 'monospace',
            fontWeight: 700,
            fontSize: '0.65rem',
            height: 20,
            minWidth: 54,
          }}
        />
        <Typography variant="body2" fontFamily="monospace" sx={{ flex: 1, fontSize: '0.82rem' }}>
          {path}
        </Typography>
        {op.summary && (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 260 }}>
            {op.summary}
          </Typography>
        )}
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ px: 2, pb: 1.5, pt: 0.5 }}>
          {op.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: '0.82rem' }}>
              {op.description}
            </Typography>
          )}
          {op.parameters && op.parameters.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.5, letterSpacing: '0.05em' }}>
                PARAMETERS
              </Typography>
              {op.parameters.map((p, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.25 }}>
                  <Typography variant="caption" fontFamily="monospace" fontWeight={600}>{p.name}</Typography>
                  <Typography variant="caption" color="text.disabled">({p.in}{p.required ? ', required' : ''})</Typography>
                  {p.description && <Typography variant="caption" color="text.secondary">{p.description}</Typography>}
                </Box>
              ))}
            </Box>
          )}
          {reqBodySchema && (
            <Box sx={{ mb: 1 }}>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.5, letterSpacing: '0.05em' }}>
                REQUEST BODY
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1,
                  fontSize: '0.72rem', fontFamily: 'monospace', overflowX: 'auto',
                  maxHeight: 200,
                }}
              >
                {JSON.stringify(reqBodySchema, null, 2)}
              </Box>
            </Box>
          )}
          {op.responses && Object.keys(op.responses).length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={700} color="text.secondary" display="block" sx={{ mb: 0.5, letterSpacing: '0.05em' }}>
                RESPONSES
              </Typography>
              {Object.entries(op.responses).map(([code, resp]) => {
                const schema = resp.content ? Object.values(resp.content)[0]?.schema : undefined
                return (
                  <Box key={code} sx={{ mb: 0.75 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <Chip
                        label={code}
                        size="small"
                        color={code.startsWith('2') ? 'success' : code.startsWith('4') ? 'warning' : 'default'}
                        sx={{ height: 18, fontSize: '0.62rem' }}
                      />
                      {resp.description && (
                        <Typography variant="caption" color="text.secondary">{resp.description}</Typography>
                      )}
                    </Box>
                    {schema && (
                      <Box
                        component="pre"
                        sx={{
                          m: 0, p: 1, bgcolor: 'action.hover', borderRadius: 1,
                          fontSize: '0.72rem', fontFamily: 'monospace', overflowX: 'auto',
                          maxHeight: 200,
                        }}
                      >
                        {JSON.stringify(schema, null, 2)}
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

function ApiDocsTab({ name, deployed }: { name: string; deployed: boolean }) {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [active, setActive] = useState(false)

  // Load only when tab becomes active
  useEffect(() => {
    if (!active || !deployed) return
    if (spec) return // already loaded

    setLoading(true)
    setLoadError(null)
    builderApi.getAgentSwagger(name)
      .then(data => setSpec(data))
      .catch(err => {
        const msg = err instanceof Error ? err.message : JSON.stringify(err)
        setLoadError(msg)
      })
      .finally(() => setLoading(false))
  }, [active, deployed, name, spec])

  // Signal activation
  useEffect(() => {
    setActive(true)
    return () => setActive(false)
  }, [])

  function handleDownload() {
    if (!spec) return
    const blob = new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}-openapi.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (!deployed) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <Typography variant="body2" color="text.secondary">
          Agent must be deployed to view API docs
        </Typography>
      </Box>
    )
  }

  if (loading) return <CircularProgress size={20} />

  if (loadError) {
    const isUnreachable = loadError.toLowerCase().includes('not reachable') ||
      loadError.toLowerCase().includes('503') ||
      loadError.toLowerCase().includes('container')
    return (
      <Alert
        severity={isUnreachable ? 'warning' : 'error'}
        sx={{ fontSize: '0.8rem' }}
        action={
          isUnreachable ? (
            <Button size="small" color="inherit" onClick={() => { setLoadError(null); setSpec(null) }}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {isUnreachable ? (
          <>
            <strong>Agent container is not running.</strong> The container may have stopped after a
            platform restart. Redeploy the agent from the Overview tab to restore it and view API docs.
          </>
        ) : (
          <>Failed to load OpenAPI spec: {loadError}</>
        )}
      </Alert>
    )
  }

  if (!spec) return null

  const parsed = parseSpec(spec)

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600} sx={{ fontSize: '1rem' }}>
            {parsed.info.title ?? name}
          </Typography>
          {parsed.info.version && (
            <Chip label={`v${parsed.info.version}`} size="small" sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }} />
          )}
          {parsed.info.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontSize: '0.82rem' }}>
              {parsed.info.description}
            </Typography>
          )}
        </Box>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
        >
          Download OpenAPI JSON
        </Button>
      </Box>

      <Divider sx={{ mb: 2 }} />

      {/* Paths grouped by tag */}
      {Object.keys(parsed.tagGroups).length === 0 && (
        <Typography variant="body2" color="text.secondary">No paths defined in spec.</Typography>
      )}
      {Object.entries(parsed.tagGroups).map(([tag, ops]) => (
        <Box key={tag} sx={{ mb: 3 }}>
          <Typography
            variant="caption"
            fontWeight={700}
            color="text.secondary"
            display="block"
            sx={{ mb: 1, letterSpacing: '0.08em', textTransform: 'uppercase' }}
          >
            {tag}
          </Typography>
          <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
            {ops.map((item, i) => (
              <React.Fragment key={`${item.method}-${item.path}`}>
                {i > 0 && <Divider />}
                <OperationRow path={item.path} method={item.method} op={item.op} />
              </React.Fragment>
            ))}
          </Paper>
        </Box>
      ))}
    </Box>
  )
}

// ---- Main page ----

export default function AgentDetail() {
  const { name = '' } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'overview' | 'deployments' | 'sessions' | 'apidocs'>('overview')

  const { data: agent, isLoading, error } = useQuery({
    queryKey: ['agent', name],
    queryFn: () => builderApi.getAgent(name),
  })

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', maxWidth: { sm: '100%', md: '100%', lg: 1200 }, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Tooltip title="Back to registry">
          <IconButton size="small" onClick={() => navigate('/agents')}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SmartToyIcon sx={{ color: 'primary.main', fontSize: 20 }} />
        <Typography variant="h6" fontWeight={600}>{name}</Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Overview" />
        <Tab value="deployments" label="Deployments"
          icon={<HistoryIcon sx={{ fontSize: 14 }} />} iconPosition="end" />
        <Tab value="sessions" label="Sessions" />
        <Tab value="apidocs" label="API Docs" />
      </Tabs>

      {isLoading && <CircularProgress size={20} />}
      {error && <Alert severity="error">Agent not found or not deployed</Alert>}

      {agent && tab === 'overview' && <OverviewTab agent={agent} />}
      {tab === 'deployments' && <DeploymentsTab name={name} />}
      {tab === 'sessions' && <SessionsTab name={name} />}
      {tab === 'apidocs' && (
        <ApiDocsTab name={name} deployed={agent?.status === 'deployed'} />
      )}
    </Box>
  )
}
