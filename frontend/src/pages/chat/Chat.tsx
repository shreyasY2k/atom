/**
 * ATOM Agent Platform — Chat
 *
 * Calls AgentScope Studio tRPC APIs directly at localhost:3000/trpc/
 * to show the same data Studio shows: projects, traces (runs), and span details.
 *
 * Layout matches Studio exactly:
 *   Left   : project/agent list (getProjects)
 *   Center : run/trace list for selected agent (getTraces)
 *            + conversation when run selected (gen_ai spans)
 *   Right  : trace detail panel (getTrace spans)
 *
 * One addition not in Studio: chat input at bottom that calls our
 * builder-backend /invoke endpoint, which then auto-registers with Studio
 * via agentscope.init() + our _register_with_studio() helper.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
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
import SmartToyIcon from '@mui/icons-material/SmartToy'
import PersonIcon from '@mui/icons-material/Person'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CasinoIcon from '@mui/icons-material/Casino'
import SparklesIcon from '@mui/icons-material/AutoAwesome'
import BuildIcon from '@mui/icons-material/Build'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

// ── Studio tRPC API (proxied through builder-backend to avoid CORS) ───────────

const PROXY_BASE = `http://${window.location.hostname}:8080/studio/trpc`
const STUDIO_URL = `http://${window.location.hostname}:3000`

async function studioQuery<T>(procedure: string, input: object): Promise<T> {
  const url = `${PROXY_BASE}/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Studio ${procedure} failed: ${r.status}`)
  const d = await r.json()
  if (d.error) throw new Error(d.error.message)
  return d.result?.data as T
}

interface StudioProject {
  project: string
  running: number
  pending: number
  finished: number
  total: number
  createdAt: string
}

interface StudioTrace {
  traceId: string
  traceName: string
  startTime: string
  endTime: string
  status: number
  spanCount: number
  totalTokens: number
}

interface Span {
  spanId: string
  parentSpanId: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Record<string, unknown>
}

interface TraceDetail {
  traceId: string
  spans: Span[]
}

// ── Avatar ────────────────────────────────────────────────────────────────────

const AVATAR_COLORS = ['#534AB7','#185FA5','#854F0B','#3B6D11','#B54708','#107569','#6941C6','#C11574']
const AVATAR_EMOJIS = ['🤖','🦾','🧠','⚡','🔬','🛡️','💡','🔭']

function AgentAvatar({ name, colorIdx, emojiIdx, size = 30 }: { name: string; colorIdx: number; emojiIdx: number; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: AVATAR_COLORS[colorIdx % AVATAR_COLORS.length], flexShrink: 0, fontSize: size * 0.4 }}>
      {AVATAR_EMOJIS[emojiIdx % AVATAR_EMOJIS.length]}
    </Avatar>
  )
}

// ── Markdown (simple) ─────────────────────────────────────────────────────────

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={j}>{p.slice(2,-2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <Box key={j} component="code" sx={{ fontFamily:'monospace', fontSize:'0.85em', bgcolor:'action.selected', px:0.4, borderRadius:0.5 }}>{p.slice(1,-1)}</Box>
    return <span key={j}>{p}</span>
  })
  while (i < lines.length) {
    const l = lines[i]
    if (l.startsWith('```')) {
      const code: string[] = []; i++
      while (i < lines.length && !lines[i].startsWith('```')) { code.push(lines[i]); i++ }
      out.push(<Box key={i} component="pre" sx={{ bgcolor:'grey.100', p:1.5, borderRadius:1, my:0.5, overflow:'auto', fontSize:'0.78rem', fontFamily:'monospace', m:0 }}>{code.join('\n')}</Box>)
      i++; continue
    }
    if (l.trim() === '') { out.push(<Box key={i} sx={{ height:4 }} />); i++; continue }
    out.push(<Typography key={i} variant="body2" component="div" sx={{ mb:0.2 }}>{inline(l)}</Typography>)
    i++
  }
  return <Box>{out}</Box>
}

// ── Span tree (replaces our custom trace panel) ────────────────────────────────

function SpanRow({ span, allSpans, depth = 0 }: { span: Span; allSpans: Span[]; depth?: number }) {
  const [open, setOpen] = useState(depth === 0)
  const children = allSpans.filter(s => s.parentSpanId === span.spanId)
  const attrs = span.attributes as Record<string, Record<string, unknown>>
  const genAi = attrs?.gen_ai || {}
  const agentName = (genAi?.agent as Record<string, unknown>)?.name as string | undefined
  const model = (genAi?.model as Record<string, unknown>)?.name as string | undefined
  const inputMsg = ((genAi?.input as Record<string, unknown>)?.messages as unknown[])
  const outputMsg = ((genAi?.output as Record<string, unknown>)?.messages as unknown[])
  const durationNs = BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)
  const durationMs = Number(durationNs / BigInt(1_000_000))
  const isLLM = span.name.startsWith('chat_completion') || span.name.includes('llm')
  const isAgent = span.name.startsWith('invoke_agent')
  const isTool = span.name.startsWith('call_tool') || span.name.includes('tool')

  const color = isAgent ? '#534AB7' : isLLM ? '#185FA5' : isTool ? '#854F0B' : '#94a3b8'

  return (
    <Box>
      <Box
        component="button"
        onClick={() => setOpen(v => !v)}
        sx={{
          display:'flex', alignItems:'center', gap:0.75, width:'100%', textAlign:'left',
          background:'none', border:'none', cursor:'pointer', pl: depth * 2 + 0.75, pr:0.75, py:0.5,
          borderRadius:1, '&:hover': { bgcolor:'action.hover' },
        }}
      >
        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:color, flexShrink:0 }} />
        <Typography variant="caption" fontFamily="monospace" fontWeight={isAgent ? 700 : 400} sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem', color }}>
          {agentName || model || span.name.split(' ').slice(-1)[0]}
        </Typography>
        {durationMs > 0 && <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.62rem', flexShrink:0 }}>{durationMs < 1000 ? `${durationMs}ms` : `${(durationMs/1000).toFixed(1)}s`}</Typography>}
        {children.length > 0 && (open ? <ExpandLessIcon sx={{ fontSize:12 }} /> : <ExpandMoreIcon sx={{ fontSize:12 }} />)}
      </Box>

      <Collapse in={open}>
        {/* Show input/output messages for agent spans */}
        {(inputMsg || outputMsg) && (
          <Box sx={{ ml: depth * 2 + 1.5, mr:1, mb:0.5 }}>
            {Array.isArray(inputMsg) && inputMsg.slice(-2).map((m: unknown, mi) => {
              const msg = m as Record<string, unknown>
              const parts = (msg.parts as {content?: string}[] | undefined) || []
              const text = parts.map(p => p.content || '').join('').trim()
              if (!text || text.length < 3) return null
              return (
                <Box key={mi} sx={{ mb:0.25 }}>
                  <Chip label={String(msg.role || 'user')} size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25 }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.secondary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:100, overflow:'hidden' }}>
                    {text.slice(0, 300)}{text.length > 300 ? '…' : ''}
                  </Typography>
                </Box>
              )
            })}
            {Array.isArray(outputMsg) && outputMsg.slice(0,1).map((m: unknown, mi) => {
              const msg = m as Record<string, unknown>
              const parts = (msg.parts as {content?: string}[] | undefined) || []
              const text = parts.map(p => p.content || '').join('').trim()
              if (!text) return null
              return (
                <Box key={`out-${mi}`} sx={{ borderTop:1, borderColor:'divider', pt:0.25, mt:0.25 }}>
                  <Chip label="→ response" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25, bgcolor:'rgba(59,109,17,0.1)' }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.primary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:150, overflow:'hidden' }}>
                    {text.slice(0, 400)}{text.length > 400 ? '…' : ''}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
        {children.map(child => <SpanRow key={child.spanId} span={child} allSpans={allSpans} depth={depth + 1} />)}
      </Collapse>
    </Box>
  )
}

function TraceDetailView({ traceId }: { traceId: string }) {
  const [tab, setTab] = useState(0)
  const { data, isLoading } = useQuery({
    queryKey: ['studio-trace', traceId],
    queryFn: () => studioQuery<TraceDetail>('getTrace', { traceId }),
    staleTime: Infinity,
  })

  const spans = data?.spans ?? []
  const roots = spans.filter(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  const totalMs = spans.length ? (() => {
    const t0 = BigInt(spans[0].startTimeUnixNano)
    const t1 = spans.reduce((m, s) => BigInt(s.endTimeUnixNano) > m ? BigInt(s.endTimeUnixNano) : m, t0)
    return Number((t1 - t0) / BigInt(1_000_000))
  })() : 0

  const llmSpans = spans.filter(s => s.name.startsWith('chat_completion'))
  const totalTokens = llmSpans.reduce((s, sp) => {
    const usage = ((sp.attributes as Record<string,Record<string,unknown>>)?.gen_ai?.usage || {}) as Record<string, number>
    return s + (usage.total_tokens || 0)
  }, 0)

  return (
    <Box sx={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom:1, borderColor:'divider', minHeight:36 }}>
        <Tab label="Run" sx={{ fontSize:'0.7rem', minHeight:36, py:0, textTransform:'uppercase' }} />
        <Tab label="Trace" sx={{ fontSize:'0.7rem', minHeight:36, py:0, textTransform:'uppercase' }} />
      </Tabs>
      <Box sx={{ flex:1, overflow:'auto' }}>
        {isLoading && <Box sx={{ p:2 }}><CircularProgress size={18} /></Box>}

        {/* Run tab — statistics */}
        {tab === 0 && !isLoading && (
          <Box sx={{ p:2 }}>
            <Box sx={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:1.5, mb:2 }}>
              {[
                { label:'Spans', value: spans.length },
                { label:'LLM calls', value: llmSpans.length },
                { label:'Total time', value: totalMs < 1000 ? `${totalMs}ms` : `${(totalMs/1000).toFixed(1)}s` },
                { label:'Total tokens', value: totalTokens.toLocaleString() },
              ].map(({ label, value }) => (
                <Paper key={label} variant="outlined" sx={{ p:1.25, borderRadius:1.5 }}>
                  <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
                  <Typography variant="body2" fontWeight={700} fontFamily="monospace">{value}</Typography>
                </Paper>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" fontFamily="monospace" display="block" sx={{ wordBreak:'break-all' }}>
              {traceId}
            </Typography>
          </Box>
        )}

        {/* Trace tab — span tree */}
        {tab === 1 && !isLoading && (
          <Box sx={{ p:1 }}>
            {roots.length === 0 && <Typography variant="caption" color="text.secondary" sx={{ p:1, display:'block' }}>No spans found.</Typography>}
            {roots.map(r => <SpanRow key={r.spanId} span={r} allSpans={spans} depth={0} />)}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Conversation view for a selected trace ────────────────────────────────────

function ConversationView({ traceId, agentName }: { traceId: string; agentName: string }) {
  const { data } = useQuery({
    queryKey: ['studio-trace', traceId],
    queryFn: () => studioQuery<TraceDetail>('getTrace', { traceId }),
    staleTime: Infinity,
  })

  const spans = data?.spans ?? []
  // The root span has the full input/output
  const rootSpan = spans.find(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  if (!rootSpan) return null

  const attrs = rootSpan.attributes as Record<string, Record<string, unknown>>
  const genAi = attrs?.gen_ai || {}
  const inputMsgs = ((genAi?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const outputMsgs = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
  const userInput = inputMsgs.find((m: unknown) => (m as Record<string,unknown>).role === 'user')
  const agentOutput = outputMsgs.find((m: unknown) => (m as Record<string,unknown>).role === 'assistant')
  const userText = ((userInput as Record<string,unknown>)?.parts as {content?:string}[] | undefined)?.[0]?.content || ''
  const agentText = ((agentOutput as Record<string,unknown>)?.parts as {content?:string}[] | undefined)?.[0]?.content || ''

  // Try to parse agent text as JSON for nice display
  let displayText = agentText
  try {
    const parsed = JSON.parse(agentText)
    if (parsed.confidence != null) {
      const c = (Number(parsed.confidence)*100).toFixed(0)
      displayText = `**Confidence:** ${c}%  **Recommendation:** \`${parsed.recommendation}\`\n${parsed.notes_for_reviewer ? `**Notes:** ${parsed.notes_for_reviewer}` : ''}`
    }
  } catch { /* use raw text */ }

  return (
    <Box sx={{ display:'flex', flexDirection:'column', gap:1.5 }}>
      {/* User */}
      {userText && (
        <Box sx={{ display:'flex', justifyContent:'flex-end', gap:1, alignItems:'flex-end' }}>
          <Paper sx={{ maxWidth:'72%', bgcolor:'primary.main', color:'primary.contrastText', px:2, py:1.25, borderRadius:'18px 18px 4px 18px' }}>
            <Typography variant="body2">{userText.slice(0,300)}</Typography>
          </Paper>
          <Avatar sx={{ width:28, height:28, bgcolor:'grey.300', flexShrink:0, fontSize:14 }}>👤</Avatar>
        </Box>
      )}
      {/* Agent */}
      {agentText && (
        <Box sx={{ display:'flex', gap:1, alignItems:'flex-start' }}>
          <Avatar sx={{ width:28, height:28, bgcolor:'#534AB7', flexShrink:0, fontSize:14 }}>🤖</Avatar>
          <Box sx={{ flex:1, minWidth:0 }}>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.5 }}>{agentName}</Typography>
            <Paper variant="outlined" sx={{ px:2, py:1.5, borderRadius:'4px 18px 18px 18px' }}>
              <Markdown text={displayText} />
            </Paper>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── Voice ─────────────────────────────────────────────────────────────────────

function useVoice(onText: (t: string) => void) {
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null)
  const ok = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const toggle = () => {
    if (!ok) return
    if (listening) { ref.current?.stop(); setListening(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition
    if (!SR) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = new SR(); r.continuous=false; r.interimResults=false; r.lang='en-US'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => onText(Array.from(e.results as any[]).map((x:any)=>x[0].transcript).join(' '))
    r.onend = () => setListening(false); r.onerror = () => setListening(false)
    r.start(); ref.current = r; setListening(true)
  }
  return { listening, toggle, ok }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Chat() {
  const [searchParams] = useSearchParams()
  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const deployed = (agentsData?.agents ?? []).filter(a => a.status === 'deployed')

  // Agent selection
  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null)
  useEffect(() => {
    const p = searchParams.get('agent')
    if (p) {
      const found = deployed.find(a => a.name === p)
      if (found) setSelectedAgent(found)
    } else if (!selectedAgent && deployed.length > 0) {
      setSelectedAgent(deployed[0])
    }
  }, [deployed, searchParams, selectedAgent])

  // Avatar seeds
  const [seeds, setSeeds] = useState<Record<string, [number,number]>>({})
  const getSeeds = (name: string): [number,number] => {
    if (seeds[name]) return seeds[name]
    const c = Math.abs(name.split('').reduce((s,ch)=>s+ch.charCodeAt(0),0)) % AVATAR_COLORS.length
    const e = Math.abs(name.split('').reduce((s,ch)=>s*31+ch.charCodeAt(0),7)) % AVATAR_EMOJIS.length
    return [c, e]
  }

  // Studio traces for selected agent
  const saId = selectedAgent?.service_account_id ?? ''
  const { data: tracesData, isLoading: tracesLoading } = useQuery({
    queryKey: ['studio-traces', saId],
    queryFn: () => studioQuery<{ list: StudioTrace[] }>('getTraces', {
      pagination: { page: 1, pageSize: 50 },
      filters: saId ? { project: { value: saId, operator: 'contains' } } : undefined,
    }),
    enabled: !!saId,
    refetchInterval: 10000,
  })
  const traces = tracesData?.list ?? []

  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null)

  // Chat input + invoke
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [newMessages, setNewMessages] = useState<{ user: string; agentName: string; traceId?: string }[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<File | null>(null)
  const { listening, toggle: voiceToggle, ok: voiceOk } = useVoice(t => setInput(p => p ? p+' '+t : t))

  const sendMessage = async (text: string) => {
    if ((!text.trim() && !attachment) || !selectedAgent || loading) return
    setInput(''); setLoading(true)
    try {
      const { run_id } = await builderApi.invokeAgent(selectedAgent.name, { text: text.trim() })
      setNewMessages(prev => [...prev, { user: text.trim(), agentName: selectedAgent.name, traceId: run_id }])
      // Refresh traces to pick up the new run from Studio
      setTimeout(() => setSelectedTraceId(null), 3000)
    } catch (e) {
      setNewMessages(prev => [...prev, { user: text.trim(), agentName: selectedAgent.name }])
    } finally { setLoading(false) }
  }

  const samplePrompts: string[] = (selectedAgent as (AgentRecord & { sample_prompts?: string[] }) | null)?.sample_prompts ?? []
  const studioUrl = `${STUDIO_URL}/projects/${saId}`
  const [ci, ei] = selectedAgent ? getSeeds(selectedAgent.name) : [0, 0]

  // Format nanosecond timestamp
  const fmtTime = (ns: string) => {
    const ms = Number(BigInt(ns) / BigInt(1_000_000))
    const d = new Date(ms)
    return d.toLocaleTimeString()
  }
  const fmtAge = (ns: string) => {
    const ms = Number(BigInt(ns) / BigInt(1_000_000))
    const diff = Math.floor((Date.now() - ms) / 60000)
    return diff < 60 ? `${diff}m ago` : `${Math.floor(diff/60)}h ago`
  }

  return (
    <Box sx={{ display:'flex', height:'100%' }}>
      {/* ── Left: agent selector ──────────────────────────────── */}
      <Box sx={{ width:200, flexShrink:0, borderRight:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
        <Box sx={{ px:1.5, py:1.5, borderBottom:1, borderColor:'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform:'uppercase', letterSpacing:'0.08em' }}>
            Agents
          </Typography>
        </Box>
        <List dense disablePadding sx={{ px:1, py:0.5, overflowY:'auto', flex:1 }}>
          {deployed.map(a => {
            const [c, e] = getSeeds(a.name)
            return (
              <ListItemButton key={a.name} selected={selectedAgent?.name === a.name}
                onClick={() => { setSelectedAgent(a); setSelectedTraceId(null) }}
                sx={{ borderRadius:1.5, mb:0.25, gap:0.75, '&.Mui-selected': { bgcolor:'primary.main', color:'primary.contrastText' } }}>
                <AgentAvatar name={a.name} colorIdx={c} emojiIdx={e} size={22} />
                <ListItemText primary={a.name} secondary={a.service_account_id?.slice(-8)}
                  primaryTypographyProps={{ fontSize:'0.75rem', fontWeight:600, noWrap:true }}
                  secondaryTypographyProps={{ fontSize:'0.6rem', fontFamily:'monospace' }} />
              </ListItemButton>
            )
          })}
        </List>
      </Box>

      {/* ── Center: run list + chat ───────────────────────────── */}
      <Box sx={{ width:320, flexShrink:0, borderRight:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
        {/* Header */}
        {selectedAgent && (
          <Box sx={{ px:1.5, py:1, borderBottom:1, borderColor:'divider', display:'flex', alignItems:'center', gap:1 }}>
            <AgentAvatar name={selectedAgent.name} colorIdx={ci} emojiIdx={ei} size={26} />
            <Box sx={{ flex:1, minWidth:0 }}>
              <Typography variant="caption" fontWeight={700} noWrap>{selectedAgent.name}</Typography>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" noWrap sx={{ display:'block', fontSize:'0.6rem' }}>
                {selectedAgent.service_account_id?.slice(-12)}
              </Typography>
            </Box>
            <Tooltip title="Randomize avatar">
              <IconButton size="small" onClick={() => setSeeds(p => ({ ...p, [selectedAgent.name]: [Math.floor(Math.random()*8), Math.floor(Math.random()*8)] }))}>
                <CasinoIcon sx={{ fontSize:14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open in Studio">
              <IconButton size="small" component="a" href={studioUrl} target="_blank"><OpenInNewIcon sx={{ fontSize:14 }} /></IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Trace list — past runs */}
        <Box sx={{ flex:1, overflowY:'auto' }}>
          {!selectedAgent && (
            <Box sx={{ p:2, textAlign:'center', mt:4 }}>
              <Typography variant="caption" color="text.secondary">Select an agent to see its runs from Studio</Typography>
            </Box>
          )}
          {selectedAgent && tracesLoading && <Box sx={{ p:2 }}><CircularProgress size={16} /></Box>}
          {selectedAgent && !tracesLoading && traces.length === 0 && (
            <Box sx={{ p:2 }}>
              <Typography variant="caption" color="text.secondary">No runs yet. Send a message below to start.</Typography>
            </Box>
          )}
          {traces.map(t => {
            const isSelected = selectedTraceId === t.traceId
            const durationNs = BigInt(t.endTime) - BigInt(t.startTime)
            const durationMs = Number(durationNs / BigInt(1_000_000))
            return (
              <Box key={t.traceId} component="button"
                onClick={() => setSelectedTraceId(isSelected ? null : t.traceId)}
                sx={{
                  display:'flex', flexDirection:'column', width:'100%', textAlign:'left',
                  px:1.5, py:1, background:'none', border:'none', cursor:'pointer',
                  borderBottom:1, borderColor:'divider',
                  bgcolor: isSelected ? 'primary.main' : 'transparent',
                  color: isSelected ? 'primary.contrastText' : 'text.primary',
                  '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
                }}
              >
                <Box sx={{ display:'flex', alignItems:'center', gap:0.75 }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor: t.status === 1 ? '#3B6D11' : '#b91c1c', flexShrink:0 }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem', fontWeight:500 }}>
                    {t.traceName}
                  </Typography>
                </Box>
                <Box sx={{ display:'flex', gap:1, mt:0.25 }}>
                  <Typography variant="caption" color={isSelected ? 'primary.contrastText' : 'text.secondary'} sx={{ fontSize:'0.62rem', opacity:0.8 }}>
                    {fmtAge(t.startTime)}
                  </Typography>
                  <Typography variant="caption" color={isSelected ? 'primary.contrastText' : 'text.secondary'} sx={{ fontSize:'0.62rem', opacity:0.8 }}>
                    {t.spanCount} spans · {t.totalTokens.toLocaleString()} tokens · {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs/1000).toFixed(1)}s`}
                  </Typography>
                </Box>
              </Box>
            )
          })}
        </Box>

        {/* Sample prompts */}
        {samplePrompts.length > 0 && (
          <Box sx={{ px:1.5, py:0.75, borderTop:1, borderColor:'divider', display:'flex', gap:0.5, flexWrap:'wrap' }}>
            {samplePrompts.map(p => (
              <Chip key={p} label={p} size="small" variant="outlined" onClick={() => setInput(p)}
                sx={{ cursor:'pointer', fontSize:'0.68rem', height:20 }} />
            ))}
          </Box>
        )}

        {/* Chat input */}
        {attachment && (
          <Box sx={{ px:1.5, pt:0.5 }}>
            <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined"
              onDelete={() => setAttachment(null)} />
          </Box>
        )}
        <Box sx={{ px:1.5, py:1, borderTop:1, borderColor:'divider' }}>
          <Paper variant="outlined" sx={{ display:'flex', alignItems:'flex-end', gap:0.25, px:1, py:0.5, borderRadius:2.5 }}>
            <input type="file" ref={fileRef} style={{ display:'none' }} accept="image/*,.pdf"
              onChange={e => { const f=e.target.files?.[0]; if(f) setAttachment(f); e.target.value='' }} />
            <Tooltip title="Attach">
              <span><IconButton size="small" onClick={() => fileRef.current?.click()} disabled={!selectedAgent||loading} sx={{ color:'text.secondary' }}><AttachFileIcon sx={{ fontSize:16 }} /></IconButton></span>
            </Tooltip>
            {voiceOk && (
              <Tooltip title={listening ? 'Stop' : 'Voice'}>
                <IconButton size="small" onClick={voiceToggle} disabled={!selectedAgent||loading}
                  sx={{ color: listening ? 'error.main' : 'text.secondary' }}>
                  {listening ? <MicOffIcon sx={{ fontSize:16 }} /> : <MicIcon sx={{ fontSize:16 }} />}
                </IconButton>
              </Tooltip>
            )}
            <InputBase multiline maxRows={3} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
              placeholder={!selectedAgent ? 'Select an agent…' : 'Message…'}
              disabled={!selectedAgent || loading}
              sx={{ flex:1, fontSize:'0.8rem' }} />
            <IconButton size="small" color="primary" onClick={() => sendMessage(input)}
              disabled={(!input.trim() && !attachment) || !selectedAgent || loading}>
              {loading ? <CircularProgress size={14} /> : <SendIcon sx={{ fontSize:16 }} />}
            </IconButton>
          </Paper>
        </Box>
      </Box>

      {/* ── Right: trace detail ───────────────────────────────── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>
        {!selectedTraceId ? (
          <Box sx={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:2 }}>
            {selectedAgent ? (
              <>
                <AgentAvatar name={selectedAgent.name} colorIdx={ci} emojiIdx={ei} size={52} />
                <Typography variant="h6" fontWeight={600}>{selectedAgent.name}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth:360, textAlign:'center' }}>
                  Select a run from the list to see its conversation and trace. Send a message to invoke this agent.
                </Typography>
              </>
            ) : (
              <Typography variant="body2" color="text.secondary">Select an agent</Typography>
            )}
          </Box>
        ) : (
          <Box sx={{ display:'flex', height:'100%', minHeight:0 }}>
            {/* Conversation */}
            <Box sx={{ flex:1, overflow:'auto', p:2 }}>
              {selectedAgent && (
                <ConversationView traceId={selectedTraceId} agentName={selectedAgent.name} />
              )}
            </Box>
            {/* Data View (Statistics + Trace) */}
            <Box sx={{ width:320, flexShrink:0, borderLeft:1, borderColor:'divider' }}>
              <TraceDetailView traceId={selectedTraceId} />
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  )
}
