/**
 * ATOM Agent Platform — Chat
 *
 * Shows EXACTLY what AgentScope Studio shows, by calling Studio APIs
 * proxied through our builder-backend (to avoid CORS).
 *
 * Data sources (all via http://localhost:8080/studio/...):
 *   /studio/trpc/getProjects  → project list (= deployed agents)
 *   /studio/runs?project=...  → run list for an agent (Socket.io /client)
 *   /studio/runs/{id}/spans   → OTEL spans for a run (Socket.io /client)
 *   /studio/trpc/getTraces    → OTEL trace list (as fallback)
 *   /studio/trpc/getTrace     → OTEL trace detail
 *
 * One addition: chat input at bottom calls /agents/{name}/invoke
 * which auto-registers with Studio via agentscope.init() + our proxy.
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
import VolumeOffIcon from '@mui/icons-material/VolumeOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CasinoIcon from '@mui/icons-material/Casino'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

// ── API proxy base ─────────────────────────────────────────────────────────────

const PROXY = `http://${window.location.hostname}:8080/studio`
const STUDIO_DIRECT = `http://${window.location.hostname}:3000`

async function studioGet<T>(path: string): Promise<T> {
  const r = await fetch(`${PROXY}${path}`)
  if (!r.ok) throw new Error(`Studio API ${path} → ${r.status}`)
  const d = await r.json()
  // tRPC envelope
  if (d?.result?.data !== undefined) return d.result.data as T
  return d as T
}

// ── Types matching Studio's data model ────────────────────────────────────────

interface StudioProject {
  project: string  // = service_account_id
  running: number
  pending: number
  finished: number
  total: number
  createdAt: string
}

interface StudioRun {
  id: string
  name: string
  status: string
  timestamp: string
  project: string
}

interface Span {
  spanId: string
  parentSpanId: string
  name: string
  startTimeUnixNano: string
  endTimeUnixNano: string
  attributes: Record<string, unknown>
  resource?: Record<string, unknown>
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

// ── Avatar ─────────────────────────────────────────────────────────────────────

const COLORS = ['#534AB7','#185FA5','#854F0B','#3B6D11','#B54708','#107569','#6941C6','#C11574']
const EMOJIS = ['🤖','🦾','🧠','⚡','🔬','🛡️','💡','🔭']

function AgentAvatar({ name, c, e, size = 30 }: { name: string; c: number; e: number; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: COLORS[c % COLORS.length], flexShrink: 0, fontSize: size * 0.4 }}>
      {EMOJIS[e % EMOJIS.length]}
    </Avatar>
  )
}

// ── Markdown ───────────────────────────────────────────────────────────────────

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
      out.push(<Box key={i} component="pre" sx={{ bgcolor:'grey.100', p:1, borderRadius:1, my:0.5, overflow:'auto', fontSize:'0.75rem', fontFamily:'monospace', m:0 }}>{code.join('\n')}</Box>)
      i++; continue
    }
    if (l.trim() === '') { out.push(<Box key={i} sx={{ height:4 }} />); i++; continue }
    out.push(<Typography key={i} variant="body2" component="div" sx={{ mb:0.2 }}>{inline(l)}</Typography>)
    i++
  }
  return <Box>{out}</Box>
}

// ── Span tree (Studio's Trace tab) ────────────────────────────────────────────

function SpanRow({ span, all, depth = 0 }: { span: Span; all: Span[]; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  const children = all.filter(s => s.parentSpanId === span.spanId)
  const attrs = span.attributes as Record<string, Record<string, unknown>>
  const genAi = attrs?.gen_ai || {}
  const agentName = (genAi?.agent as Record<string,unknown>)?.name as string | undefined
  const modelName = (genAi?.model as Record<string,unknown>)?.name as string | undefined
  const inputMsgs = ((genAi?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const outputMsgs = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
  const usage = (genAi?.usage as Record<string,number>) || {}
  const durationMs = span.endTimeUnixNano && span.startTimeUnixNano
    ? Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / BigInt(1_000_000))
    : null

  const isAgent = span.name.startsWith('invoke_agent')
  const isLLM = span.name.startsWith('chat_completion')
  const isTool = span.name.includes('tool')
  const color = isAgent ? '#534AB7' : isLLM ? '#185FA5' : isTool ? '#854F0B' : '#94a3b8'
  const label = agentName || modelName || span.name.split(' ').slice(-1)[0]

  return (
    <Box sx={{ borderLeft: depth > 0 ? '1px solid' : 'none', borderColor: 'divider', ml: depth > 0 ? 1.5 : 0 }}>
      <Box component="button" onClick={() => setOpen(v => !v)}
        sx={{ display:'flex', alignItems:'center', gap:0.75, width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', px:0.75, py:0.4, borderRadius:1, '&:hover':{ bgcolor:'action.hover' } }}>
        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:color, flexShrink:0 }} />
        <Typography variant="caption" fontFamily="monospace" fontWeight={isAgent ? 700 : 400}
          sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem', color }}>
          {label}
        </Typography>
        {usage.total_tokens != null && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0 }}>{usage.total_tokens}t</Typography>
        )}
        {durationMs != null && (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0, ml:0.5 }}>
            {durationMs < 1000 ? `${durationMs}ms` : `${(durationMs/1000).toFixed(1)}s`}
          </Typography>
        )}
        {(children.length > 0 || inputMsgs.length > 0) && (
          open ? <ExpandLessIcon sx={{ fontSize:12 }} /> : <ExpandMoreIcon sx={{ fontSize:12 }} />
        )}
      </Box>

      <Collapse in={open}>
        {/* Messages in/out for LLM spans */}
        {(inputMsgs.length > 0 || outputMsgs.length > 0) && (
          <Box sx={{ ml:1.5, mr:0.5, mb:0.5 }}>
            {inputMsgs.slice(-3).map((m: unknown, mi) => {
              const msg = m as Record<string,unknown>
              const parts = (msg.parts as {content?: string}[] | undefined) || []
              const text = parts.map(p => p.content || '').join('').trim()
              if (!text || text.length < 2) return null
              return (
                <Box key={mi} sx={{ mb:0.25 }}>
                  <Chip label={String(msg.role || 'user')} size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25 }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.secondary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:80, overflow:'hidden' }}>
                    {text.slice(0, 250)}{text.length > 250 ? '…' : ''}
                  </Typography>
                </Box>
              )
            })}
            {outputMsgs.slice(0,1).map((m: unknown, mi) => {
              const msg = m as Record<string,unknown>
              const parts = (msg.parts as {content?: string}[] | undefined) || []
              const text = parts.map(p => p.content || '').join('').trim()
              if (!text) return null
              return (
                <Box key={`o${mi}`} sx={{ borderTop:1, borderColor:'divider', pt:0.25 }}>
                  <Chip label="→ response" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25, bgcolor:'rgba(59,109,17,0.1)' }} />
                  <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.primary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:120, overflow:'hidden' }}>
                    {text.slice(0, 350)}{text.length > 350 ? '…' : ''}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
        {children.map(child => <SpanRow key={child.spanId} span={child} all={all} depth={depth + 1} />)}
      </Collapse>
    </Box>
  )
}

// ── Run detail (Statistics + Trace tabs) ──────────────────────────────────────

function RunDetail({ runId, agentName }: { runId: string; agentName: string }) {
  const [tab, setTab] = useState(0)

  // Try Socket.io spans first, fall back to tRPC getTrace
  const { data: spansData, isLoading: spansLoading } = useQuery({
    queryKey: ['studio-spans', runId],
    queryFn: () => studioGet<{ spans: Span[]; source: string }>(`/runs/${runId}/spans`),
    staleTime: 30000,
  })

  const { data: traceData, isLoading: traceLoading } = useQuery({
    queryKey: ['studio-trace-detail', runId],
    queryFn: () => studioGet<{ traceId: string; spans: Span[] } | null>(`/trpc/getTrace?input=${encodeURIComponent(JSON.stringify({ traceId: runId }))}`).catch(() => null),
    staleTime: 30000,
    enabled: !spansData?.spans?.length,
  })

  const spans: Span[] = spansData?.spans?.length
    ? spansData.spans
    : (traceData as { traceId: string; spans: Span[] } | null)?.spans ?? []

  const isLoading = spansLoading || traceLoading
  const roots = spans.filter(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))

  const llmSpans = spans.filter(s => s.name.startsWith('chat_completion'))
  const totalTokens = llmSpans.reduce((sum, s) => {
    const g = (s.attributes as Record<string,Record<string,unknown>>)?.gen_ai
    return sum + (((g?.usage as Record<string,number>)?.total_tokens) || 0)
  }, 0)
  const totalMs = spans.length > 0 ? (() => {
    try {
      const t0 = BigInt(spans[0].startTimeUnixNano)
      const t1 = spans.reduce((m, s) => BigInt(s.endTimeUnixNano) > m ? BigInt(s.endTimeUnixNano) : m, t0)
      return Number((t1 - t0) / BigInt(1_000_000))
    } catch { return 0 }
  })() : 0

  return (
    <Box sx={{ height:'100%', display:'flex', flexDirection:'column' }}>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom:1, borderColor:'divider', minHeight:36 }}>
        <Tab label="RUN" sx={{ fontSize:'0.68rem', minHeight:36, py:0, fontWeight:600 }} />
        <Tab label="TRACE" sx={{ fontSize:'0.68rem', minHeight:36, py:0, fontWeight:600 }} />
      </Tabs>
      <Box sx={{ flex:1, overflow:'auto', p:1.5 }}>
        {isLoading && <CircularProgress size={16} sx={{ m:1 }} />}

        {/* Run stats tab */}
        {tab === 0 && !isLoading && (
          <Box>
            {[
              ['Span count', spans.length],
              ['LLM calls', llmSpans.length],
              ['Total tokens', totalTokens.toLocaleString()],
              ['Total time', totalMs < 1000 ? `${totalMs}ms` : `${(totalMs/1000).toFixed(1)}s`],
            ].map(([k, v]) => (
              <Box key={k as string} sx={{ display:'flex', justifyContent:'space-between', py:0.75, borderBottom:1, borderColor:'divider' }}>
                <Typography variant="caption" color="text.secondary">{k}</Typography>
                <Typography variant="caption" fontWeight={700} fontFamily="monospace">{v}</Typography>
              </Box>
            ))}
            {spansData?.source && (
              <Typography variant="caption" color="text.disabled" display="block" sx={{ mt:1 }}>
                source: {spansData.source}
              </Typography>
            )}
          </Box>
        )}

        {/* Trace tab — span tree */}
        {tab === 1 && !isLoading && (
          <Box>
            {roots.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No trace data. The agent must call agentscope.init() to emit OTEL traces to Studio.
              </Typography>
            )}
            {roots.map(r => <SpanRow key={r.spanId} span={r} all={spans} depth={0} />)}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Conversation for a run (from root span gen_ai input/output) ────────────────

function RunConversation({ runId, agentName, colorIdx, emojiIdx }: {
  runId: string; agentName: string; colorIdx: number; emojiIdx: number
}) {
  const { data } = useQuery({
    queryKey: ['studio-spans', runId],
    queryFn: () => studioGet<{ spans: Span[] }>(`/runs/${runId}/spans`),
    staleTime: 30000,
  })
  const spans = data?.spans ?? []
  const root = spans.find(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  if (!root) return null

  const genAi = ((root.attributes as Record<string,unknown>)?.gen_ai || {}) as Record<string, unknown>
  const inputMsgs = ((genAi?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const outputMsgs = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
  const userMsg = inputMsgs.find((m: unknown) => (m as Record<string,unknown>).role === 'user')
  const agentMsg = outputMsgs.find((m: unknown) => (m as Record<string,unknown>).role === 'assistant')
  const userText = ((userMsg as Record<string,unknown>)?.parts as {content?:string}[])?.[0]?.content || ''
  const agentText = ((agentMsg as Record<string,unknown>)?.parts as {content?:string}[])?.[0]?.content || ''

  let display = agentText
  try {
    const parsed = JSON.parse(agentText)
    if (parsed.confidence != null && parsed.recommendation) {
      const c = (Number(parsed.confidence)*100).toFixed(0)
      const lines = [`**Confidence:** ${c}%  **Recommendation:** \`${parsed.recommendation}\``]
      if (parsed.customer_id) lines.push(`**Customer:** ${parsed.customer_id}`)
      if (parsed.notes_for_reviewer) lines.push(`**Notes:** ${parsed.notes_for_reviewer}`)
      display = lines.join('\n')
    }
  } catch { /* use raw text */ }

  return (
    <Box>
      {userText && (
        <Box sx={{ display:'flex', justifyContent:'flex-end', mb:1.5, gap:1, alignItems:'flex-end' }}>
          <Paper sx={{ maxWidth:'72%', bgcolor:'primary.main', color:'primary.contrastText', px:2, py:1.25, borderRadius:'18px 18px 4px 18px' }}>
            <Typography variant="body2">{userText.slice(0,300)}</Typography>
          </Paper>
          <Avatar sx={{ width:28, height:28, bgcolor:'grey.300', flexShrink:0, fontSize:14 }}>👤</Avatar>
        </Box>
      )}
      {display && (
        <Box sx={{ display:'flex', gap:1, mb:1.5, alignItems:'flex-start' }}>
          <AgentAvatar name={agentName} c={colorIdx} e={emojiIdx} size={28} />
          <Box sx={{ flex:1, minWidth:0 }}>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.5 }}>{agentName}</Typography>
            <Paper variant="outlined" sx={{ px:2, py:1.5, borderRadius:'4px 18px 18px 18px' }}>
              <Markdown text={display} />
            </Paper>
          </Box>
        </Box>
      )}
    </Box>
  )
}

// ── Voice input ───────────────────────────────────────────────────────────────

function useVoice(cb: (t: string) => void) {
  const [on, setOn] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = useRef<any>(null)
  const ok = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  const toggle = () => {
    if (!ok) return
    if (on) { ref.current?.stop(); setOn(false); return }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).webkitSpeechRecognition ?? (window as any).SpeechRecognition
    if (!SR) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = new SR(); r.continuous=false; r.lang='en-US'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    r.onresult = (e: any) => cb(Array.from(e.results as any[]).map((x:any)=>x[0].transcript).join(' '))
    r.onend=()=>setOn(false); r.onerror=()=>setOn(false)
    r.start(); ref.current=r; setOn(true)
  }
  return { on, toggle, ok }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Chat() {
  const [searchParams] = useSearchParams()
  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const deployed = (agentsData?.agents ?? []).filter(a => a.status === 'deployed')

  const [selectedAgent, setSelectedAgent] = useState<AgentRecord | null>(null)
  useEffect(() => {
    const p = searchParams.get('agent')
    const found = p ? deployed.find(a => a.name === p) : null
    if (found) setSelectedAgent(found)
    else if (!selectedAgent && deployed.length > 0) setSelectedAgent(deployed[0])
  }, [deployed, searchParams, selectedAgent])

  const [seeds, setSeeds] = useState<Record<string, [number,number]>>({})
  const getSeeds = (name: string): [number,number] => {
    if (seeds[name]) return seeds[name]
    return [
      Math.abs(name.split('').reduce((s,ch)=>s+ch.charCodeAt(0),0)) % COLORS.length,
      Math.abs(name.split('').reduce((s,ch)=>s*31+ch.charCodeAt(0),7)) % EMOJIS.length,
    ]
  }

  const saId = selectedAgent?.service_account_id ?? ''

  // Runs via Socket.io proxy
  const { data: runsData, isLoading: runsLoading, refetch: refetchRuns } = useQuery({
    queryKey: ['studio-runs', saId],
    queryFn: () => studioGet<{ runs: StudioRun[] }>(`/runs?project=${encodeURIComponent(saId)}`),
    enabled: !!saId,
    refetchInterval: 15000,
  })
  const runs = runsData?.runs ?? []

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<File | null>(null)
  const { on: voiceOn, toggle: voiceToggle, ok: voiceOk } = useVoice(t => setInput(p => p ? p+' '+t : t))

  const sendMessage = async (text: string) => {
    if ((!text.trim() && !attachment) || !selectedAgent || loading) return
    setInput(''); setLoading(true)
    try {
      await builderApi.invokeAgent(selectedAgent.name, { text: text.trim(), ...(attachment?.name ? { file_name: attachment.name } : {}) })
      setAttachment(null)
      setTimeout(() => refetchRuns(), 3000)
    } catch (e) { /* ignore */ }
    finally { setLoading(false) }
  }

  const samplePrompts: string[] = (selectedAgent as (AgentRecord & { sample_prompts?: string[] }) | null)?.sample_prompts ?? []
  const studioProjectUrl = `${STUDIO_DIRECT}/projects/${saId}`
  const [ci, ei] = selectedAgent ? getSeeds(selectedAgent.name) : [0, 0]

  const fmtAge = (ts: string) => {
    try {
      const ms = ts.includes('T')
        ? Date.now() - new Date(ts).getTime()
        : Date.now() - Number(BigInt(ts) / BigInt(1_000_000))
      const min = Math.floor(ms / 60000)
      return min < 60 ? `${min}m ago` : `${Math.floor(min/60)}h ago`
    } catch { return '' }
  }

  // Only show runs from Socket.io — already filtered by service_account_id (project).
  // Do NOT add unfiltered tRPC traces; they contain all agents.
  const combinedItems: { id: string; name: string; status: string; time: string; totalTokens?: number }[] =
    runs.map(r => ({ id: r.id, name: r.name, status: r.status, time: r.timestamp }))

  return (
    <Box sx={{ display:'flex', height:'100%' }}>
      {/* ── Col 1: Agents ──────────────────────── */}
      <Box sx={{ width:200, flexShrink:0, borderRight:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
        <Box sx={{ px:1.5, py:1.25, borderBottom:1, borderColor:'divider' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform:'uppercase', letterSpacing:'0.08em' }}>Agents</Typography>
        </Box>
        <List dense disablePadding sx={{ px:1, py:0.5, overflowY:'auto', flex:1 }}>
          {deployed.map(a => {
            const [c, e] = getSeeds(a.name)
            return (
              <ListItemButton key={a.name} selected={selectedAgent?.name === a.name}
                onClick={() => { setSelectedAgent(a); setSelectedRunId(null) }}
                sx={{ borderRadius:1.5, mb:0.25, gap:0.75, '&.Mui-selected':{ bgcolor:'primary.main', color:'primary.contrastText' } }}>
                <AgentAvatar name={a.name} c={c} e={e} size={22} />
                <ListItemText primary={a.name} secondary={a.service_account_id?.slice(-8)}
                  primaryTypographyProps={{ fontSize:'0.75rem', fontWeight:600, noWrap:true }}
                  secondaryTypographyProps={{ fontSize:'0.6rem', fontFamily:'monospace' }} />
              </ListItemButton>
            )
          })}
        </List>
      </Box>

      {/* ── Col 2: Run list + input ─────────────── */}
      <Box sx={{ width:300, flexShrink:0, borderRight:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
        {/* Agent header */}
        {selectedAgent && (
          <Box sx={{ px:1.5, py:1, borderBottom:1, borderColor:'divider', display:'flex', alignItems:'center', gap:1 }}>
            <AgentAvatar name={selectedAgent.name} c={ci} e={ei} size={26} />
            <Box sx={{ flex:1, minWidth:0 }}>
              <Typography variant="caption" fontWeight={700} noWrap>{selectedAgent.name}</Typography>
              <Typography variant="caption" color="text.secondary" noWrap sx={{ display:'block', fontSize:'0.6rem', fontFamily:'monospace' }}>
                {selectedAgent.service_account_id?.slice(-14)}
              </Typography>
            </Box>
            <Tooltip title="Randomize avatar">
              <IconButton size="small" onClick={() => setSeeds(p => ({...p, [selectedAgent.name]:[Math.floor(Math.random()*8),Math.floor(Math.random()*8)]}))}>
                <CasinoIcon sx={{ fontSize:14 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Open in Studio">
              <IconButton size="small" component="a" href={studioProjectUrl} target="_blank">
                <OpenInNewIcon sx={{ fontSize:14 }} />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        {/* Run list */}
        <Box sx={{ flex:1, overflowY:'auto' }}>
          {runsLoading && <Box sx={{ p:2 }}><CircularProgress size={14} /></Box>}
          {selectedAgent && !runsLoading && combinedItems.length === 0 && (
            <Box sx={{ p:2 }}>
              <Typography variant="caption" color="text.secondary">No runs yet. Send a message to invoke this agent.</Typography>
            </Box>
          )}
          {combinedItems.map(item => {
            const sel = selectedRunId === item.id
            const dotColor = item.status === 'finished' ? '#3B6D11' : item.status === 'running' ? '#534AB7' : '#b91c1c'
            return (
              <Box key={item.id} component="button" onClick={() => setSelectedRunId(sel ? null : item.id)}
                sx={{
                  display:'flex', flexDirection:'column', width:'100%', textAlign:'left',
                  px:1.5, py:1, background:'none', border:'none', cursor:'pointer',
                  borderBottom:1, borderColor:'divider',
                  bgcolor: sel ? 'primary.main' : 'transparent',
                  color: sel ? 'primary.contrastText' : 'text.primary',
                  '&:hover': { bgcolor: sel ? 'primary.main' : 'action.hover' },
                }}
              >
                <Box sx={{ display:'flex', alignItems:'center', gap:0.75 }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:dotColor, flexShrink:0 }} />
                  <Typography variant="caption" fontFamily="monospace" fontWeight={500}
                    sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem' }}>
                    {item.name}
                  </Typography>
                  <Chip label={item.status} size="small" variant="outlined"
                    sx={{ height:14, fontSize:'0.55rem', flexShrink:0,
                      color: item.status === 'finished' ? '#3B6D11' : '#534AB7',
                      borderColor: item.status === 'finished' ? '#3B6D11' : '#534AB7',
                    }} />
                </Box>
                <Typography variant="caption" color={sel ? 'primary.contrastText' : 'text.secondary'} sx={{ fontSize:'0.62rem', opacity:0.85, mt:0.25 }}>
                  {fmtAge(item.time)}
                </Typography>
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

        {/* Attachment */}
        {attachment && (
          <Box sx={{ px:1.5, pt:0.5 }}>
            <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined" onDelete={() => setAttachment(null)} />
          </Box>
        )}

        {/* Chat input */}
        <Box sx={{ px:1.5, py:1, borderTop:1, borderColor:'divider' }}>
          <Paper variant="outlined" sx={{ display:'flex', alignItems:'flex-end', gap:0.25, px:1, py:0.5, borderRadius:2.5 }}>
            <input type="file" ref={fileRef} style={{ display:'none' }} accept="image/*,.pdf"
              onChange={e => { const f=e.target.files?.[0]; if(f) setAttachment(f); e.target.value='' }} />
            <Tooltip title="Attach"><span>
              <IconButton size="small" onClick={() => fileRef.current?.click()} disabled={!selectedAgent||loading} sx={{ color:'text.secondary' }}>
                <AttachFileIcon sx={{ fontSize:16 }} />
              </IconButton>
            </span></Tooltip>
            {voiceOk && (
              <Tooltip title={voiceOn ? 'Stop' : 'Voice input'}>
                <IconButton size="small" onClick={voiceToggle} disabled={!selectedAgent||loading}
                  sx={{ color: voiceOn ? 'error.main' : 'text.secondary' }}>
                  {voiceOn ? <MicOffIcon sx={{ fontSize:16 }} /> : <MicIcon sx={{ fontSize:16 }} />}
                </IconButton>
              </Tooltip>
            )}
            <InputBase multiline maxRows={3} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage(input)} }}
              placeholder={!selectedAgent ? 'Select an agent…' : voiceOn ? '🎤 Listening…' : 'Message… (Enter to send)'}
              disabled={!selectedAgent||loading} sx={{ flex:1, fontSize:'0.8rem' }} />
            <IconButton size="small" color="primary" onClick={() => sendMessage(input)}
              disabled={(!input.trim()&&!attachment)||!selectedAgent||loading}>
              {loading ? <CircularProgress size={14} /> : <SendIcon sx={{ fontSize:16 }} />}
            </IconButton>
          </Paper>
        </Box>
      </Box>

      {/* ── Col 3: Conversation + Data View ──────── */}
      {selectedRunId && selectedAgent ? (
        <Box sx={{ flex:1, display:'flex', minWidth:0, minHeight:0 }}>
          {/* Conversation */}
          <Box sx={{ flex:1, overflow:'auto', p:2 }}>
            <Typography variant="caption" color="text.secondary" fontFamily="monospace" display="block" sx={{ mb:1.5, fontSize:'0.65rem' }}>
              Run: {selectedRunId}
            </Typography>
            <RunConversation runId={selectedRunId} agentName={selectedAgent.name} colorIdx={ci} emojiIdx={ei} />
          </Box>
          {/* Data View: Statistics + Trace */}
          <Box sx={{ width:320, flexShrink:0, borderLeft:1, borderColor:'divider' }}>
            <RunDetail runId={selectedRunId} agentName={selectedAgent.name} />
          </Box>
        </Box>
      ) : (
        <Box sx={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:2 }}>
          {selectedAgent ? (
            <>
              <AgentAvatar name={selectedAgent.name} c={ci} e={ei} size={52} />
              <Typography variant="h6" fontWeight={600}>{selectedAgent.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth:320, textAlign:'center' }}>
                {runs.length > 0
                  ? `${runs.length} run${runs.length !== 1 ? 's' : ''} found. Click one to see the conversation and trace.`
                  : 'Send a message below to invoke this agent. The run will appear in the list.'}
              </Typography>
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">Select an agent from the left</Typography>
          )}
        </Box>
      )}
    </Box>
  )
}
