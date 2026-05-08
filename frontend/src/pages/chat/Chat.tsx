import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Avatar, Box, Chip, CircularProgress, Divider,
  IconButton, InputBase, List, ListItemButton,
  ListItemText, Paper, Tooltip, Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import CodeIcon from '@mui/icons-material/Code'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  raw?: Record<string, unknown>
  agentName?: string
  svcId?: string
  confidence?: number
  recommendation?: string
  reasoningMode?: string
  isError?: boolean
  durationMs?: number
  attachmentName?: string
  attachmentPreview?: string | null
}

function formatAgentResponse(raw: Record<string, unknown>): string {
  if (typeof raw.raw_output === 'string') return raw.raw_output
  if (raw.document_type) {
    const lines = [`**Document type:** \`${raw.document_type}\``]
    if (raw.confidence != null) lines.push(`**Confidence:** ${(Number(raw.confidence) * 100).toFixed(0)}%`)
    if (Array.isArray(raw.signals_found) && raw.signals_found.length)
      lines.push(`**Signals:** ${(raw.signals_found as string[]).join(', ')}`)
    if (raw.notes) lines.push(`**Notes:** ${raw.notes}`)
    return lines.join('\n')
  }
  if (raw.confidence != null && raw.recommendation) {
    const lines = [`**Confidence:** ${(Number(raw.confidence) * 100).toFixed(0)}%  **Recommendation:** \`${raw.recommendation}\``]
    if (raw.customer_id) lines.push(`**Customer:** ${raw.customer_id}`)
    if (Array.isArray(raw.issues_found) && raw.issues_found.length)
      lines.push(`**Issues:** ${(raw.issues_found as Record<string, unknown>[]).map((i) => `${i.code}(${i.severity})`).join(', ')}`)
    if (raw.notes_for_reviewer) lines.push(`**Notes:** ${raw.notes_for_reviewer}`)
    return lines.join('\n')
  }
  return JSON.stringify(raw, null, 2)
}

function RichText({ text }: { text: string }) {
  if (!text.includes('**')) return <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', m: 0 }}>{text}</Typography>
  return (
    <Box sx={{ '& > div': { mb: 0.25 } }}>
      {text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <div key={i}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**')
                ? <strong key={j}>{p.slice(2, -2)}</strong>
                : <span key={j}>{p}</span>
            )}
          </div>
        )
      })}
    </Box>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const [showRaw, setShowRaw] = useState(false)

  if (msg.role === 'user') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
        <Box sx={{ maxWidth: '70%' }}>
          {msg.attachmentPreview && (
            <Box sx={{ mb: 0.5, textAlign: 'right' }}>
              <Box component="img" src={msg.attachmentPreview} alt={msg.attachmentName} sx={{ maxWidth: 200, maxHeight: 150, borderRadius: 1, border: 1, borderColor: 'divider' }} />
            </Box>
          )}
          {msg.attachmentName && !msg.attachmentPreview && (
            <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
              <Chip icon={<AttachFileIcon />} label={msg.attachmentName} size="small" variant="outlined" />
            </Box>
          )}
          <Paper sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: '18px 18px 4px 18px' }}>
            <Typography variant="body2">{msg.content}</Typography>
          </Paper>
        </Box>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', gap: 1.5, mb: 1.5, alignItems: 'flex-start' }}>
      <Avatar sx={{ width: 28, height: 28, bgcolor: msg.isError ? 'error.dark' : 'primary.dark', flexShrink: 0 }}>
        <SmartToyIcon sx={{ fontSize: 16 }} />
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {msg.agentName && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
            <Typography variant="caption" fontWeight={600}>{msg.agentName}</Typography>
            {msg.reasoningMode && (
              <Chip
                label={msg.reasoningMode}
                size="small"
                variant="outlined"
                sx={{ height: 18, fontSize: '0.6rem', color: msg.reasoningMode === 'guided' ? 'primary.main' : 'text.secondary', borderColor: msg.reasoningMode === 'guided' ? 'primary.light' : 'divider' }}
              />
            )}
            {msg.svcId && (
              <Chip label={msg.svcId} size="small" sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', height: 18, fontSize: '0.6rem' }} />
            )}
            {msg.durationMs && (
              <Typography variant="caption" color="text.secondary">{msg.durationMs}ms</Typography>
            )}
          </Box>
        )}
        <Paper
          variant="outlined"
          sx={{
            px: 2, py: 1.5,
            borderRadius: '4px 18px 18px 18px',
            bgcolor: msg.isError ? 'error.dark' : 'background.paper',
            borderColor: msg.isError ? 'error.main' : 'divider',
          }}
        >
          <Typography variant="body2" component="div">
            <RichText text={msg.content} />
          </Typography>
        </Paper>
        {msg.raw && (
          <Box sx={{ mt: 0.75 }}>
            <Box
              component="button"
              onClick={() => setShowRaw(!showRaw)}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.5,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'text.secondary', fontSize: '0.7rem', p: 0,
                '&:hover': { color: 'text.primary' },
              }}
            >
              <CodeIcon sx={{ fontSize: 12 }} />
              {showRaw ? 'Hide' : 'Show'} raw JSON
              {showRaw ? <ExpandLessIcon sx={{ fontSize: 12 }} /> : <ExpandMoreIcon sx={{ fontSize: 12 }} />}
            </Box>
            {showRaw && (
              <Box component="pre" sx={{ mt: 0.75, fontSize: '0.65rem', fontFamily: 'monospace', color: 'text.secondary', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, overflow: 'auto', maxHeight: 192, m: 0 }}>
                {JSON.stringify(msg.raw, null, 2)}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Box>
  )
}

function buildPayload(agentName: string, text: string, fileName?: string): Record<string, unknown> {
  if (agentName.includes('classifier') || agentName.includes('document'))
    return { input: { page_text: text, ...(fileName ? { file_name: fileName } : {}) } }
  if (agentName.includes('kyc')) {
    const custMatch = text.match(/CUST-\d+/i)
    return { input: { customer_id: custMatch ? custMatch[0].toUpperCase() : text } }
  }
  if (agentName.includes('recon') || agentName.includes('asset')) {
    const xferMatch = text.match(/XFER-[\w-]+/i)
    return { input: { transfer_id: xferMatch ? xferMatch[0].toUpperCase() : text, securities: [] } }
  }
  return { input: { query: text, text, ...(fileName ? { file_name: fileName } : {}) } }
}

export default function Chat() {
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const deployedAgents = (data?.agents ?? []).filter((a) => a.status === 'deployed')

  useEffect(() => {
    if (!selectedAgent && deployedAgents.length > 0) setSelectedAgent(deployedAgents[0])
  }, [deployedAgents, selectedAgent])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const switchAgent = (agent: AgentRecord) => { setSelectedAgent(agent); setMessages([]) }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAttachment(file)
    setAttachmentPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : null)
    // reset input so same file can be re-selected
    e.target.value = ''
  }

  const clearAttachment = () => { setAttachment(null); setAttachmentPreview(null) }

  const sendMessage = async () => {
    if ((!input.trim() && !attachment) || !selectedAgent || loading) return

    const displayText = input.trim() || (attachment ? `[${attachment.name}]` : '')
    let payloadText = input.trim()
    let fileName: string | undefined

    if (attachment) {
      fileName = attachment.name
      if (attachment.type.startsWith('image/')) {
        payloadText = `<image attached: ${attachment.name}>`
      } else if (attachment.type === 'application/pdf' || attachment.name.endsWith('.pdf')) {
        payloadText = `<pdf: ${attachment.name}>`
      } else {
        payloadText = input.trim() || `<file: ${attachment.name}>`
      }
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: displayText,
      attachmentName: attachment?.name,
      attachmentPreview,
    }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    clearAttachment()
    setLoading(true)

    const t0 = Date.now()
    try {
      const payload = buildPayload(selectedAgent.name, payloadText, fileName)
      const { result: rawResult } = await builderApi.invokeAgent(selectedAgent.name, payload)
      const result = rawResult as Record<string, unknown>
      const elapsed = Date.now() - t0
      const reasoningMode = (selectedAgent as AgentRecord & { reasoning_mode?: string }).reasoning_mode ?? 'prescribed'
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: formatAgentResponse(result),
        raw: result,
        agentName: selectedAgent.name,
        svcId: selectedAgent.service_account_id,
        confidence: result.confidence != null ? Number(result.confidence) : undefined,
        recommendation: result.recommendation as string | undefined,
        durationMs: elapsed,
        reasoningMode,
      }])
    } catch (e: unknown) {
      setMessages((prev) => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: `Error: ${String(e)}`,
        agentName: selectedAgent.name,
        svcId: selectedAgent.service_account_id,
        isError: true,
        durationMs: Date.now() - t0,
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      {/* Agent selector */}
      <Box sx={{ width: 200, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <Box sx={{ px: 1.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Deployed Agents
          </Typography>
        </Box>
        {deployedAgents.length === 0 && (
          <Box sx={{ p: 1.5 }}>
            <Typography variant="caption" color="text.secondary">No agents deployed. Go to Build first.</Typography>
          </Box>
        )}
        <List dense disablePadding sx={{ px: 1, py: 0.5, overflowY: 'auto', flex: 1 }}>
          {deployedAgents.map((a) => (
            <ListItemButton
              key={a.name}
              selected={selectedAgent?.name === a.name}
              onClick={() => switchAgent(a)}
              sx={{ borderRadius: 1.5, mb: 0.25, '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText' } }}
            >
              <ListItemText
                primary={a.name}
                secondary={a.service_account_id?.slice(-12)}
                primaryTypographyProps={{ fontSize: '0.75rem', fontWeight: 500 }}
                secondaryTypographyProps={{ fontSize: '0.6rem', fontFamily: 'monospace' }}
              />
            </ListItemButton>
          ))}
        </List>
      </Box>

      {/* Chat area */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        {selectedAgent && (
          <Box sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.dark' }}>
              <SmartToyIcon sx={{ fontSize: 16 }} />
            </Avatar>
            <Box>
              <Typography variant="body2" fontWeight={600}>{selectedAgent.name}</Typography>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                {selectedAgent.service_account_id}
              </Typography>
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Typography variant="caption" color="text.secondary">Enter to send · Shift+Enter for newline</Typography>
          </Box>
        )}

        {/* Messages */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {messages.length === 0 && selectedAgent && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', gap: 1.5 }}>
              <Avatar sx={{ width: 48, height: 48, bgcolor: 'primary.dark' }}>
                <SmartToyIcon sx={{ fontSize: 24 }} />
              </Avatar>
              <Typography variant="body1" fontWeight={500}>{selectedAgent.name}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 300 }}>
                Send a message or attach a file to invoke this agent. The response will appear here with the full JSON output and service-account attribution.
              </Typography>
            </Box>
          )}
          {messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)}
          {loading && (
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 1.5 }}>
              <Avatar sx={{ width: 28, height: 28, bgcolor: 'primary.dark' }}>
                <CircularProgress size={14} color="inherit" />
              </Avatar>
              <Paper variant="outlined" sx={{ px: 2, py: 1, borderRadius: '4px 18px 18px 18px', display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {[0, 150, 300].map((delay) => (
                  <Box key={delay} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'bounce 1s ease-in-out infinite', animationDelay: `${delay}ms`, '@keyframes bounce': { '0%, 100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } } }} />
                ))}
              </Paper>
            </Box>
          )}
          <div ref={bottomRef} />
        </Box>

        {/* Attachment preview */}
        {attachment && (
          <Box sx={{ px: 2, pt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            {attachmentPreview
              ? <Box component="img" src={attachmentPreview} alt={attachment.name} sx={{ height: 64, borderRadius: 1, border: 1, borderColor: 'divider' }} />
              : <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined" onDelete={clearAttachment} />
            }
            {attachmentPreview && (
              <Chip label={attachment.name} size="small" variant="outlined" onDelete={clearAttachment} />
            )}
          </Box>
        )}

        {/* Input */}
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Paper
            variant="outlined"
            sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.5, py: 0.75, borderRadius: 3 }}
          >
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept="image/*,.pdf"
              onChange={handleFileSelect}
            />
            <Tooltip title="Attach file (image or PDF)">
              <span>
                <IconButton
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!selectedAgent || loading}
                  sx={{ color: 'text.secondary' }}
                >
                  <AttachFileIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <InputBase
              multiline
              maxRows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={
                !selectedAgent ? 'Select an agent to start chatting…'
                : selectedAgent.name.includes('classifier') ? 'Paste document text to classify…'
                : selectedAgent.name.includes('kyc') ? 'Enter a customer ID, e.g. CUST-100442'
                : selectedAgent.name.includes('recon') ? 'Enter a transfer ID, e.g. XFER-100442-001'
                : 'Type a message…'
              }
              disabled={!selectedAgent || loading}
              sx={{ flex: 1, fontSize: '0.875rem' }}
            />
            <IconButton
              size="small"
              onClick={sendMessage}
              disabled={(!input.trim() && !attachment) || !selectedAgent || loading}
              color="primary"
            >
              <SendIcon fontSize="small" />
            </IconButton>
          </Paper>
        </Box>
      </Box>
    </Box>
  )
}
