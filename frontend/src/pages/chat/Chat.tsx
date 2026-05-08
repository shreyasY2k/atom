/**
 * ATOM Agent Platform — Chat Interface
 *
 * Layout matches AgentScope Studio:
 *  Left (220px)   : Deployed agent list
 *  Center (flex)  : Chat conversation, grouped by run
 *  Right (360px)  : Data View panel — opens on message click
 *                   Tabs: Statistics | Messages | Trace
 *
 * Features (matching Studio):
 *  - Content blocks: text/markdown, thinking (collapsible), tool_use, tool_result
 *  - Randomize avatar per agent
 *  - Voice input  (browser SpeechRecognition, no model)
 *  - Voice TTS    (browser speechSynthesis reads agent response aloud)
 *  - Template inputs from sample_prompts
 *  - Trace panel with statistics, full message context, span-style trace
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Avatar, Box, Chip, CircularProgress, Collapse,
  Divider, IconButton, InputBase, List, ListItemButton,
  ListItemText, Paper, Tab, Tabs, Tooltip, Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VolumeUpIcon from '@mui/icons-material/VolumeUp'
import VolumeOffIcon from '@mui/icons-material/VolumeOff'
import CloseIcon from '@mui/icons-material/Close'
import CasinoIcon from '@mui/icons-material/Casino'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import SparklesIcon from '@mui/icons-material/AutoAwesome'
import BuildIcon from '@mui/icons-material/Build'
import { builderApi } from '../../api/builder'
import type { AgentRecord, TraceEvent } from '../../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#534AB7', '#185FA5', '#854F0B', '#3B6D11', '#B54708', '#107569',
  '#6941C6', '#C11574', '#1570EF', '#0E9384',
]

const AVATAR_EMOJIS = ['🤖', '🦾', '🧠', '⚡', '🔬', '🛡️', '💡', '🔭', '🎯', '⚙️']

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  raw?: Record<string, unknown>
  runId?: string
  agentName?: string
  svcId?: string
  reasoningMode?: string
  durationMs?: number
  isError?: boolean
  attachmentName?: string
  attachmentPreview?: string | null
}

interface Run {
  runId: string
  messages: RunMessage[]
  startedAt: number
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function AgentAvatar({ name, colorIdx, emojiIdx, size = 32 }: {
  name: string; colorIdx: number; emojiIdx: number; size?: number
}) {
  const color = AVATAR_COLORS[colorIdx % AVATAR_COLORS.length]
  const emoji = AVATAR_EMOJIS[emojiIdx % AVATAR_EMOJIS.length]
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: color, flexShrink: 0, fontSize: size * 0.45 }}>
      {emoji}
    </Avatar>
  )
}

// ── Markdown ──────────────────────────────────────────────────────────────────

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  const inline = (s: string): React.ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={j}>{p.slice(2, -2)}</strong>
      if (p.startsWith('`') && p.endsWith('`'))
        return <Box key={j} component="code" sx={{ fontFamily: 'monospace', fontSize: '0.85em', bgcolor: 'action.selected', px: 0.4, borderRadius: 0.5 }}>{p.slice(1, -1)}</Box>
      return <span key={j}>{p}</span>
    })

  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const code: string[] = []; i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++ }
      out.push(<Box key={i} component="pre" sx={{ bgcolor: 'grey.100', p: 1.5, borderRadius: 1, my: 0.5, overflow: 'auto', fontSize: '0.78rem', fontFamily: 'monospace', m: 0 }}>{code.join('\n')}</Box>)
      i++; continue
    }
    if (l.startsWith('#')) {
      const lvl = l.match(/^#+/)?.[0].length ?? 1
      out.push(<Typography key={i} variant={lvl === 1 ? 'h6' : 'subtitle1'} fontWeight={600} sx={{ mt: 0.75, mb: 0.25 }}>{inline(l.replace(/^#+\s*/, ''))}</Typography>)
      i++; continue
    }
    if (l.match(/^[-*]\s/)) {
      out.push(<Box key={i} sx={{ display: 'flex', gap: 0.75, mb: 0.25 }}><Box component="span" sx={{ color: 'text.secondary' }}>•</Box><Typography variant="body2" component="span">{inline(l.replace(/^[-*]\s/, ''))}</Typography></Box>)
      i++; continue
    }
    if (l.trim() === '') { out.push(<Box key={i} sx={{ height: 4 }} />); i++; continue }
    out.push(<Typography key={i} variant="body2" component="div" sx={{ mb: 0.2 }}>{inline(l)}</Typography>)
    i++
  }
  return <Box>{out}</Box>
}

// ── Collapsible block (Thinking, Tool) ────────────────────────────────────────

function CollapsibleBlock({
  icon, title, defaultOpen = false, children,
}: {
  icon: React.ReactNode; title: string; defaultOpen?: boolean; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden', my: 0.5 }}>
      <Box
        component="button"
        onClick={() => setOpen(v => !v)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.75, width: '100%', textAlign: 'left',
          background: 'action.hover', border: 'none', cursor: 'pointer',
          px: 1.25, py: 0.75, bgcolor: 'action.hover',
          '&:hover': { bgcolor: 'action.selected' },
        }}
      >
        {icon}
        <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{title}</Typography>
        {open ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ p: 1.25, borderTop: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Format agent output ───────────────────────────────────────────────────────

function formatOutput(raw: Record<string, unknown>): string {
  if (typeof raw.raw_output === 'string') return raw.raw_output
  if (raw.confidence != null && raw.recommendation) {
    const c = (Number(raw.confidence) * 100).toFixed(0)
    const lines = [`**Confidence:** ${c}%  **Recommendation:** \`${raw.recommendation}\``]
    if (raw.customer_id) lines.push(`**Customer:** ${raw.customer_id}`)
    const issues = raw.issues_found as { code: string; severity: string }[] | undefined
    if (Array.isArray(issues) && issues.length) lines.push(`**Issues:** ${issues.map(i => `${i.code}(${i.severity})`).join(', ')}`)
    if (raw.notes_for_reviewer) lines.push(`**Notes:** ${raw.notes_for_reviewer}`)
    return lines.join('\n')
  }
  if (raw.transfer_id && raw.securities_count != null) {
    const lines = [`**Transfer:** \`${raw.transfer_id}\`  **Confidence:** ${(Number(raw.confidence ?? 0) * 100).toFixed(0)}%  **Rec:** \`${raw.recommendation}\``]
    const issues = raw.issues as { code: string; severity: string }[] | undefined
    if (Array.isArray(issues) && issues.length) lines.push(`**Issues:** ${issues.map(i => `${i.code}(${i.severity})`).join(', ')}`)
    return lines.join('\n')
  }
  return JSON.stringify(raw, null, 2)
}

// ── Data View: Statistics tab ─────────────────────────────────────────────────

function StatisticsTab({ events }: { events: TraceEvent[] }) {
  const llm = events.filter(e => e.event_type === 'llm_call')
  const tools = events.filter(e => e.event_type === 'tool_call')
  const totalIn = llm.reduce((s, e) => s + (e.input_tokens ?? 0), 0)
  const totalOut = llm.reduce((s, e) => s + (e.output_tokens ?? 0), 0)
  const totalMs = events.reduce((s, e) => s + (e.duration_ms ?? 0), 0)
  const models = [...new Set(llm.map(e => e.model).filter(Boolean))]

  const Row = ({ label, value }: { label: string; value: string | number }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="caption" fontWeight={600} fontFamily="monospace">{value}</Typography>
    </Box>
  )

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Box sx={{ mb: 2 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', mb: 0.5 }}>{title}</Typography>
      {children}
    </Box>
  )

  return (
    <Box sx={{ p: 2, overflowY: 'auto', height: '100%' }}>
      <Section title="Run">
        <Row label="LLM calls" value={llm.length} />
        <Row label="Tool calls" value={tools.length} />
        <Row label="Total latency" value={totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`} />
      </Section>
      <Section title="Tokens">
        <Row label="Input (prompt)" value={totalIn.toLocaleString()} />
        <Row label="Output (completion)" value={totalOut.toLocaleString()} />
        <Row label="Total" value={(totalIn + totalOut).toLocaleString()} />
      </Section>
      {models.length > 0 && (
        <Section title="Models">
          {models.map(m => <Row key={m} label={m ?? ''} value={llm.filter(e => e.model === m).length + ' calls'} />)}
        </Section>
      )}
    </Box>
  )
}

// ── Data View: Messages tab ───────────────────────────────────────────────────

function MessagesTab({ events }: { events: TraceEvent[] }) {
  const llmEvents = events.filter(e => e.event_type === 'llm_call')
  if (llmEvents.length === 0) return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography variant="caption" color="text.secondary">No message data — trace events may still be indexing.</Typography>
    </Box>
  )
  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      {llmEvents.map((ev, ci) => (
        <Box key={ci} sx={{ mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
            <Chip label={`Call ${ci + 1}`} size="small" sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'rgba(83,74,183,0.1)', color: '#534AB7' }} />
            <Typography variant="caption" color="text.secondary">{ev.model} · {ev.input_tokens ?? '?'}↑ {ev.output_tokens ?? '?'}↓ · {ev.duration_ms ?? '?'}ms</Typography>
          </Box>
          {ev.messages?.map((m, mi) => (
            <Box key={mi} sx={{ mb: 1 }}>
              {m.role === 'system' ? (
                <CollapsibleBlock icon={<SparklesIcon sx={{ fontSize: 13, color: '#534AB7' }} />} title={`System prompt`} defaultOpen={ci === 0 && mi === 0}>
                  <Typography variant="caption" fontFamily="monospace" sx={{ display: 'block', whiteSpace: 'pre-wrap', fontSize: '0.68rem', color: 'text.secondary', maxHeight: 180, overflow: 'auto' }}>
                    {m.content.slice(0, 600)}{m.content.length > 600 ? '…' : ''}
                  </Typography>
                </CollapsibleBlock>
              ) : (
                <Box>
                  <Chip label={m.role} size="small" sx={{ height: 14, fontSize: '0.58rem', mb: 0.25, bgcolor: m.role === 'user' ? 'rgba(24,95,165,0.1)' : 'rgba(59,109,17,0.1)' }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ display: 'block', fontSize: '0.7rem', whiteSpace: 'pre-wrap', color: 'text.primary', ml: 0.5, maxHeight: 120, overflow: 'auto' }}>
                    {m.content.slice(0, 400)}{m.content.length > 400 ? '…' : ''}
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
          {ev.response_content && (
            <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 0.75, mt: 0.5 }}>
              <Chip label="→ response" size="small" sx={{ height: 14, fontSize: '0.58rem', mb: 0.25, bgcolor: 'rgba(59,109,17,0.1)' }} />
              <Typography variant="caption" fontFamily="monospace" sx={{ display: 'block', fontSize: '0.7rem', whiteSpace: 'pre-wrap', color: 'text.primary', ml: 0.5, maxHeight: 150, overflow: 'auto' }}>
                {ev.response_content}
              </Typography>
            </Box>
          )}
          {ev.tool_calls && ev.tool_calls.length > 0 && (
            <CollapsibleBlock icon={<BuildIcon sx={{ fontSize: 13, color: '#854F0B' }} />} title={`Tool calls (${ev.tool_calls.length})`}>
              {ev.tool_calls.map((tc, ti) => (
                <Box key={ti} sx={{ mb: 0.5 }}>
                  <Typography variant="caption" fontFamily="monospace" fontWeight={600}>{tc.name}</Typography>
                  <Typography variant="caption" fontFamily="monospace" sx={{ display: 'block', color: 'text.secondary', fontSize: '0.68rem' }}>
                    {tc.arguments.slice(0, 200)}
                  </Typography>
                </Box>
              ))}
            </CollapsibleBlock>
          )}
        </Box>
      ))}
    </Box>
  )
}

// ── Data View: Trace tab ──────────────────────────────────────────────────────

function TraceTab({ events }: { events: TraceEvent[] }) {
  if (events.length === 0) return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <Typography variant="caption" color="text.secondary">No trace spans found.</Typography>
    </Box>
  )
  const totalMs = events.reduce((s, e) => s + (e.duration_ms ?? 0), 0)
  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%' }}>
      {/* Timeline bar */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>Span timeline (total {totalMs < 1000 ? `${totalMs}ms` : `${(totalMs / 1000).toFixed(1)}s`})</Typography>
        <Box sx={{ height: 8, borderRadius: 1, bgcolor: 'action.hover', position: 'relative', overflow: 'hidden' }}>
          {events.filter(e => e.duration_ms).map((ev, i) => {
            const w = totalMs > 0 ? (ev.duration_ms! / totalMs) * 100 : 0
            const offset = totalMs > 0 ? (events.slice(0, i).reduce((s, e) => s + (e.duration_ms ?? 0), 0) / totalMs) * 100 : 0
            return (
              <Box key={i} sx={{ position: 'absolute', left: `${offset}%`, width: `${w}%`, height: '100%', bgcolor: ev.event_type === 'llm_call' ? '#534AB7' : '#854F0B', opacity: 0.7 }} />
            )
          })}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: '#534AB7' }} /><Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>LLM</Typography></Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: '#854F0B' }} /><Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>Tool</Typography></Box>
        </Box>
      </Box>
      {/* Span list */}
      {events.map((ev, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: ev.event_type === 'llm_call' ? '#534AB7' : '#854F0B', flexShrink: 0 }} />
          <Typography variant="caption" fontFamily="monospace" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.7rem' }}>
            {ev.event_type === 'llm_call' ? (ev.model ?? 'llm') : (ev.tool_name ?? ev.tool_calls?.[0]?.name ?? 'tool')}
          </Typography>
          {ev.input_tokens != null && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem', flexShrink: 0 }}>{ev.input_tokens}↑{ev.output_tokens}↓</Typography>}
          {ev.duration_ms != null && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem', flexShrink: 0 }}>{ev.duration_ms < 1000 ? `${ev.duration_ms}ms` : `${(ev.duration_ms / 1000).toFixed(1)}s`}</Typography>}
        </Box>
      ))}
    </Box>
  )
}

// ── Data View panel ───────────────────────────────────────────────────────────

function DataView({
  runId, agentName, onClose,
}: {
  runId: string | null; agentName: string; onClose: () => void
}) {
  const [tab, setTab] = useState(0)
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!runId || !agentName) return
    setLoading(true)
    builderApi.getRunEvents(agentName, runId)
      .then(d => setEvents(d.events))
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [runId, agentName])

  return (
    <Box sx={{
      width: 360, flexShrink: 0, borderLeft: 1, borderColor: 'divider',
      display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', height: '100%',
    }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption" fontWeight={700} sx={{ flex: 1 }}>Data View</Typography>
        <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize: '0.62rem', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>{runId?.slice(-12)}</Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', minHeight: 36 }}>
        <Tab label="Statistics" sx={{ fontSize: '0.7rem', minHeight: 36, py: 0 }} />
        <Tab label="Messages" sx={{ fontSize: '0.7rem', minHeight: 36, py: 0 }} />
        <Tab label="Trace" sx={{ fontSize: '0.7rem', minHeight: 36, py: 0 }} />
      </Tabs>
      <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        {loading && (
          <Box sx={{ position: 'absolute', top: 8, right: 8 }}>
            <CircularProgress size={12} />
          </Box>
        )}
        {tab === 0 && <StatisticsTab events={events} />}
        {tab === 1 && <MessagesTab events={events} />}
        {tab === 2 && <TraceTab events={events} />}
      </Box>
    </Box>
  )
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({
  msg, colorIdx, emojiIdx, isSelected, onClick,
}: {
  msg: RunMessage; colorIdx: number; emojiIdx: number
  isSelected: boolean; onClick: () => void
}) {
  const [ttsActive, setTtsActive] = useState(false)

  const speakText = useCallback(() => {
    if (!window.speechSynthesis) return
    if (ttsActive) {
      window.speechSynthesis.cancel()
      setTtsActive(false)
      return
    }
    const u = new SpeechSynthesisUtterance(msg.content.replace(/\*\*/g, '').replace(/`/g, ''))
    u.rate = 1.0
    u.onend = () => setTtsActive(false)
    window.speechSynthesis.speak(u)
    setTtsActive(true)
  }, [msg.content, ttsActive])

  if (msg.role === 'user') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5, gap: 1, alignItems: 'flex-end' }}>
        <Box sx={{ maxWidth: '72%' }}>
          {msg.attachmentPreview && <Box component="img" src={msg.attachmentPreview} sx={{ maxHeight: 150, borderRadius: 1, border: 1, borderColor: 'divider', display: 'block', mb: 0.5, ml: 'auto' }} />}
          {msg.attachmentName && !msg.attachmentPreview && (
            <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'flex-end' }}>
              <Chip icon={<AttachFileIcon />} label={msg.attachmentName} size="small" variant="outlined" />
            </Box>
          )}
          <Paper sx={{ bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: '18px 18px 4px 18px' }}>
            <Typography variant="body2">{msg.content}</Typography>
          </Paper>
        </Box>
        <Avatar sx={{ width: 28, height: 28, bgcolor: 'grey.300', flexShrink: 0, fontSize: 14 }}>👤</Avatar>
      </Box>
    )
  }

  return (
    <Box
      sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'flex-start', cursor: 'pointer' }}
      onClick={onClick}
    >
      <AgentAvatar name={msg.agentName ?? 'agent'} colorIdx={colorIdx} emojiIdx={emojiIdx} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Header */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography variant="caption" fontWeight={700}>{msg.agentName ?? 'agent'}</Typography>
          {msg.reasoningMode && (
            <Chip label={msg.reasoningMode} size="small" variant="outlined"
              sx={{ height: 16, fontSize: '0.58rem', color: msg.reasoningMode === 'guided' ? 'primary.main' : 'text.secondary' }} />
          )}
          {msg.svcId && (
            <Chip label={msg.svcId.slice(-10)} size="small"
              sx={{ fontFamily: 'monospace', height: 16, fontSize: '0.58rem', bgcolor: 'rgba(83,74,183,0.08)', color: '#534AB7' }} />
          )}
          {msg.durationMs != null && <Typography variant="caption" color="text.secondary">{msg.durationMs < 1000 ? `${msg.durationMs}ms` : `${(msg.durationMs / 1000).toFixed(1)}s`}</Typography>}
          <Box sx={{ flexGrow: 1 }} />
          <Tooltip title={ttsActive ? 'Stop speaking' : 'Read aloud (browser TTS)'}>
            <IconButton size="small" onClick={(e) => { e.stopPropagation(); speakText() }}
              sx={{ color: ttsActive ? 'primary.main' : 'text.secondary', p: 0.25 }}>
              {ttsActive ? <VolumeOffIcon sx={{ fontSize: 14 }} /> : <VolumeUpIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Bubble */}
        <Paper
          variant="outlined"
          sx={{
            px: 2, py: 1.5,
            borderRadius: '4px 18px 18px 18px',
            bgcolor: isSelected ? 'rgba(83,74,183,0.04)' : (msg.isError ? '#fef2f2' : 'background.paper'),
            borderColor: isSelected ? '#534AB7' : (msg.isError ? 'error.light' : 'divider'),
            transition: 'border-color 0.1s, background-color 0.1s',
          }}
        >
          <Markdown text={msg.content} />
          {msg.raw && (
            <Box sx={{ mt: 0.5, borderTop: 1, borderColor: 'divider', pt: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>
                Click to view full trace in Data View →
              </Typography>
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  )
}

// ── Voice input hook ──────────────────────────────────────────────────────────

function useVoiceInput(onTranscript: (t: string) => void) {
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null)
  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const toggle = () => {
    if (!supported) return
    if (listening) { recRef.current?.stop(); setListening(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition
    if (!SR) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new SR()
    rec.continuous = false; rec.interimResults = false; rec.lang = 'en-US'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => { const t = Array.from(e.results as any[]).map((r: any) => r[0].transcript).join(' '); onTranscript(t) }
    rec.onend = () => setListening(false); rec.onerror = () => setListening(false)
    rec.start(); recRef.current = rec; setListening(true)
  }
  return { listening, toggle, supported }
}

// ── Main Chat ─────────────────────────────────────────────────────────────────

export default function Chat() {
  const [searchParams] = useSearchParams()
  const { data } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const deployed = (data?.agents ?? []).filter(a => a.status === 'deployed')

  const [selectedName, setSelectedName] = useState(searchParams.get('agent') ?? '')
  const selected = deployed.find(a => a.name === selectedName) ?? null

  // Avatar personalisation per agent
  const [avatarSeeds, setAvatarSeeds] = useState<Record<string, [number, number]>>({})
  const getSeeds = (name: string): [number, number] => {
    if (!avatarSeeds[name]) {
      const c = Math.abs(name.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0)) % AVATAR_COLORS.length
      const e = Math.abs(name.split('').reduce((s, ch) => s * 31 + ch.charCodeAt(0), 7)) % AVATAR_EMOJIS.length
      return [c, e]
    }
    return avatarSeeds[name]
  }
  const randomizeAvatar = (name: string) => {
    setAvatarSeeds(prev => ({
      ...prev,
      [name]: [Math.floor(Math.random() * AVATAR_COLORS.length), Math.floor(Math.random() * AVATAR_EMOJIS.length)],
    }))
  }

  useEffect(() => {
    if (!selectedName && deployed.length > 0) setSelectedName(deployed[0].name)
  }, [deployed, selectedName])
  useEffect(() => {
    const p = searchParams.get('agent')
    if (p) setSelectedName(p)
  }, [searchParams])

  const [runs, setRuns] = useState<Run[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [attachPreview, setAttachPreview] = useState<string | null>(null)
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null)
  const [dataViewOpen, setDataViewOpen] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { listening, toggle: voiceToggle, supported: voiceOk } = useVoiceInput(t => setInput(p => p ? p + ' ' + t : t))

  // Close chat resets conversation + data view
  const switchAgent = (name: string) => {
    setSelectedName(name); setRuns([]); setSelectedMsgId(null); setDataViewOpen(false)
  }

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [runs, loading])

  const selectedMsg = runs.flatMap(r => r.messages).find(m => m.id === selectedMsgId) ?? null
  const studioUrl = `${window.location.protocol}//${window.location.hostname}:3000`
  const samplePrompts: string[] = (selected as (AgentRecord & { sample_prompts?: string[] }) | null)?.sample_prompts ?? []
  const [colorIdx, emojiIdx] = selected ? getSeeds(selected.name) : [0, 0]

  const handleSend = async (text: string) => {
    if ((!text.trim() && !attachment) || !selected || loading) return
    const userMsg: RunMessage = {
      id: `u${Date.now()}`, role: 'user',
      content: text.trim() || `[${attachment?.name}]`,
      attachmentName: attachment?.name, attachmentPreview: attachPreview,
    }
    setInput(''); setAttachment(null); setAttachPreview(null); setLoading(true)
    const t0 = Date.now()
    try {
      const { result, run_id } = await builderApi.invokeAgent(selected.name, { text: text.trim(), ...(attachment?.name ? { file_name: attachment.name } : {}) })
      const raw = result as Record<string, unknown>
      const agentMsg: RunMessage = {
        id: `a${Date.now() + 1}`, role: 'agent', content: formatOutput(raw), raw,
        runId: run_id, agentName: selected.name, svcId: selected.service_account_id,
        reasoningMode: (selected as AgentRecord & { reasoning_mode?: string }).reasoning_mode,
        durationMs: Date.now() - t0,
      }
      setRuns(prev => [...prev, { runId: run_id, messages: [userMsg, agentMsg], startedAt: t0 }])
    } catch (e) {
      setRuns(prev => [...prev, { runId: `err${Date.now()}`, startedAt: t0, messages: [userMsg, { id: `a${Date.now()}`, role: 'agent', content: `Error: ${String(e)}`, agentName: selected.name, svcId: selected.service_account_id, isError: true, durationMs: Date.now() - t0 }] }])
    } finally {
      setLoading(false)
    }
  }

  const handleMsgClick = (msg: RunMessage) => {
    if (msg.role !== 'agent' || !msg.runId) return
    setSelectedMsgId(prev => prev === msg.id ? null : msg.id)
    setDataViewOpen(true)
  }

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      {/* Left: agent list */}
      <Box sx={{ width: 220, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <Box sx={{ px: 1.5, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>Deployed Agents</Typography>
        </Box>
        {deployed.length === 0 && <Box sx={{ p: 1.5 }}><Typography variant="caption" color="text.secondary">No agents deployed yet.</Typography></Box>}
        <List dense disablePadding sx={{ px: 1, py: 0.5, overflowY: 'auto', flex: 1 }}>
          {deployed.map(a => {
            const [ci, ei] = getSeeds(a.name)
            const mode = (a as AgentRecord & { reasoning_mode?: string }).reasoning_mode
            return (
              <ListItemButton key={a.name} selected={selectedName === a.name} onClick={() => switchAgent(a.name)}
                sx={{ borderRadius: 1.5, mb: 0.25, gap: 1, '&.Mui-selected': { bgcolor: 'primary.main', color: 'primary.contrastText' } }}>
                <AgentAvatar name={a.name} colorIdx={ci} emojiIdx={ei} size={24} />
                <ListItemText
                  primary={<Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" fontWeight={600} noWrap>{a.name}</Typography>
                    {mode === 'guided' && <Chip label="G" size="small" sx={{ height: 14, fontSize: '0.55rem' }} />}
                  </Box>}
                  secondary={a.service_account_id?.slice(-8)}
                  secondaryTypographyProps={{ fontSize: '0.6rem', fontFamily: 'monospace' }}
                />
              </ListItemButton>
            )
          })}
        </List>
      </Box>

      {/* Center: chat */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Header */}
        {selected && (
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center', gap: 1 }}>
            <AgentAvatar name={selected.name} colorIdx={colorIdx} emojiIdx={emojiIdx} size={30} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={700} noWrap>{selected.name}</Typography>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" noWrap sx={{ fontSize: '0.62rem' }}>{selected.service_account_id}</Typography>
            </Box>
            <Tooltip title="Randomize avatar"><IconButton size="small" onClick={() => randomizeAvatar(selected.name)}><CasinoIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
            <Tooltip title="Open in AgentScope Studio"><IconButton size="small" component="a" href={studioUrl} target="_blank"><OpenInNewIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
          </Box>
        )}

        {/* Messages */}
        <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
          {runs.length === 0 && selected && (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', gap: 2 }}>
              <AgentAvatar name={selected.name} colorIdx={colorIdx} emojiIdx={emojiIdx} size={52} />
              <Box>
                <Typography variant="h6" fontWeight={600}>{selected.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360, mt: 0.5 }}>
                  Send a message or click a sample below. Click any agent response to open the Data View panel with trace details.
                </Typography>
              </Box>
            </Box>
          )}
          {runs.map((run, ri) => (
            <Box key={run.runId}>
              {ri > 0 && <Divider sx={{ my: 1.5 }}><Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.62rem' }}>Run {ri + 1}</Typography></Divider>}
              {run.messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} colorIdx={colorIdx} emojiIdx={emojiIdx}
                  isSelected={selectedMsgId === msg.id}
                  onClick={() => handleMsgClick(msg)} />
              ))}
            </Box>
          ))}
          {loading && (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
              <AgentAvatar name={selectedName} colorIdx={colorIdx} emojiIdx={emojiIdx} size={28} />
              <Paper variant="outlined" sx={{ px: 1.5, py: 0.75, borderRadius: '4px 16px 16px 16px', display: 'flex', gap: 0.5 }}>
                {[0, 120, 240].map(d => <Box key={d} sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: 'text.disabled', animation: 'bounce 1s ease-in-out infinite', animationDelay: `${d}ms`, '@keyframes bounce': { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } } }} />)}
              </Paper>
            </Box>
          )}
          <div ref={bottomRef} />
        </Box>

        {/* Sample prompts */}
        {samplePrompts.length > 0 && (
          <Box sx={{ px: 2, py: 0.75, borderTop: 1, borderColor: 'divider', display: 'flex', gap: 0.75, flexWrap: 'wrap', bgcolor: 'background.paper' }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', flexShrink: 0, fontWeight: 600 }}>Templates:</Typography>
            {samplePrompts.map(p => (
              <Chip key={p} label={p} size="small" variant="outlined" onClick={() => setInput(p)}
                sx={{ cursor: 'pointer', fontSize: '0.7rem', height: 22 }} />
            ))}
          </Box>
        )}

        {/* Attachment preview */}
        {attachment && (
          <Box sx={{ px: 2, pt: 0.75, display: 'flex', alignItems: 'center', gap: 1 }}>
            {attachPreview ? <Box component="img" src={attachPreview} sx={{ height: 64, borderRadius: 1, border: 1, borderColor: 'divider' }} /> : null}
            <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined" onDelete={() => { setAttachment(null); setAttachPreview(null) }} />
          </Box>
        )}

        {/* Input */}
        <Box sx={{ px: 2, py: 1.5, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, px: 1.5, py: 0.75, borderRadius: 3 }}>
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept="image/*,.pdf" onChange={e => { const f = e.target.files?.[0]; if (!f) return; setAttachment(f); setAttachPreview(f.type.startsWith('image/') ? URL.createObjectURL(f) : null); e.target.value = '' }} />
            <Tooltip title="Attach file"><span><IconButton size="small" onClick={() => fileInputRef.current?.click()} disabled={!selected || loading} sx={{ color: 'text.secondary' }}><AttachFileIcon fontSize="small" /></IconButton></span></Tooltip>
            {voiceOk && (
              <Tooltip title={listening ? 'Stop recording' : 'Voice input (browser, no model)'}>
                <IconButton size="small" onClick={voiceToggle} disabled={!selected || loading}
                  sx={{ color: listening ? 'error.main' : 'text.secondary', animation: listening ? 'pulse 1s ease-in-out infinite' : 'none', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.5 } } }}>
                  {listening ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
            <InputBase multiline maxRows={4} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(input) } }}
              placeholder={!selected ? 'Select an agent…' : listening ? '🎤 Listening…' : 'Message… (Enter to send, Shift+Enter for new line)'}
              disabled={!selected || loading} sx={{ flex: 1, fontSize: '0.875rem' }} />
            <IconButton size="small" color="primary" onClick={() => handleSend(input)} disabled={(!input.trim() && !attachment) || !selected || loading}>
              <SendIcon fontSize="small" />
            </IconButton>
          </Paper>
        </Box>
      </Box>

      {/* Right: Data View panel */}
      {dataViewOpen && selectedMsg?.runId && selectedMsg.agentName && (
        <DataView runId={selectedMsg.runId} agentName={selectedMsg.agentName} onClose={() => { setDataViewOpen(false); setSelectedMsgId(null) }} />
      )}
    </Box>
  )
}
