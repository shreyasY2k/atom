/**
 * ATOM Agent Platform — Chat
 *
 * Layout matches AgentScope Studio exactly:
 *
 *  ┌──────────┬───────────┬──────────────────────────────┬──────────────┐
 *  │ Agents   │ Run list  │     Chat area (messages)     │  Data View   │
 *  │ (190px)  │ (240px)   │     + input at bottom        │  (280px)     │
 *  │          │           │     (flex-1)                 │  (on click)  │
 *  └──────────┴───────────┴──────────────────────────────┴──────────────┘
 *
 * Data sources:
 *  - Run list: Studio Socket.io /client (joinProjectRoom) + OTEL traces
 *    filtered by agent_role_name
 *  - Conversation: local state for current session; Studio spans for history
 *  - Trace panel: Studio Socket.io spans + Statistics/Trace tabs
 */
import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  Avatar, Box, Chip, CircularProgress, Collapse,
  FormControl, IconButton, InputLabel, MenuItem,
  Paper, Select, Tab, Tabs, Tooltip, Typography,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CasinoIcon from '@mui/icons-material/Casino'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

// ── Studio proxy ──────────────────────────────────────────────────────────────

const PROXY   = `http://${window.location.hostname}:8080/studio`
const STUDIO  = `http://${window.location.hostname}:3000`

async function studioGet<T>(path: string): Promise<T> {
  const r = await fetch(`${PROXY}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  const d = await r.json()
  if (d?.result?.data !== undefined) return d.result.data as T
  return d as T
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StudioRun   { id: string; name: string; status: string; timestamp: string }
interface StudioTrace { traceId: string; traceName: string; startTime: string; status: number; totalTokens: number }
interface Span        { spanId: string; parentSpanId: string; name: string; startTimeUnixNano: string; endTimeUnixNano: string; attributes: Record<string, unknown> }

interface LocalMessage { id: string; role: 'user' | 'agent'; text: string; runId?: string; loading?: boolean; error?: boolean }

// ── Colours / avatars ─────────────────────────────────────────────────────────

const COLORS = ['#534AB7','#185FA5','#854F0B','#3B6D11','#B54708','#107569','#6941C6','#C11574']
const EMOJIS = ['🤖','🦾','🧠','⚡','🔬','🛡️','💡','🔭']

function AgentAvatar({ name, c, e, size = 28 }: { name: string; c: number; e: number; size?: number }) {
  return (
    <Avatar sx={{ width: size, height: size, bgcolor: COLORS[c % COLORS.length], flexShrink: 0, fontSize: size * 0.42 }}>
      {EMOJIS[e % EMOJIS.length]}
    </Avatar>
  )
}

// ── Minimal markdown ──────────────────────────────────────────────────────────

function Markdown({ text }: { text: string }) {
  const lines = text.split('\n')
  const out: React.ReactNode[] = []
  let i = 0
  const inl = (s: string) => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, j) => {
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
    out.push(<Typography key={i} variant="body2" component="div" sx={{ mb:0.2 }}>{inl(l)}</Typography>)
    i++
  }
  return <Box>{out}</Box>
}

// ── Span tree (Studio trace view) ─────────────────────────────────────────────

function SpanRow({ span, all, depth = 0 }: { span: Span; all: Span[]; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  const children = all.filter(s => s.parentSpanId === span.spanId)
  const genAi = ((span.attributes as Record<string,Record<string,unknown>>)?.gen_ai || {})
  const agentN = (genAi?.agent as Record<string,unknown>)?.name as string | undefined
  const modelN = (genAi?.model as Record<string,unknown>)?.name as string | undefined
  const inputM = ((genAi?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const outputM = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
  const usage   = (genAi?.usage as Record<string,number>) || {}
  const dur = span.endTimeUnixNano && span.startTimeUnixNano
    ? Number((BigInt(span.endTimeUnixNano) - BigInt(span.startTimeUnixNano)) / BigInt(1_000_000)) : null
  const isAgent = span.name.startsWith('invoke_agent')
  const color = isAgent ? '#534AB7' : span.name.startsWith('chat_') ? '#185FA5' : '#854F0B'

  return (
    <Box sx={{ borderLeft: depth > 0 ? '1px solid' : 'none', borderColor:'divider', ml: depth > 0 ? 1.5 : 0 }}>
      <Box component="button" onClick={() => setOpen(v => !v)}
        sx={{ display:'flex', alignItems:'center', gap:0.75, width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', px:0.75, py:0.4, borderRadius:1, '&:hover':{ bgcolor:'action.hover' } }}>
        <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:color, flexShrink:0 }} />
        <Typography variant="caption" fontFamily="monospace" fontWeight={isAgent ? 700 : 400}
          sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.72rem', color }}>
          {agentN || modelN || span.name.split(' ').slice(-1)[0]}
        </Typography>
        {usage.total_tokens != null && <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0 }}>{usage.total_tokens}t</Typography>}
        {dur != null && <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0, ml:0.5 }}>{dur < 1000 ? `${dur}ms` : `${(dur/1000).toFixed(1)}s`}</Typography>}
        {(children.length > 0 || inputM.length > 0) && (open ? <ExpandLessIcon sx={{ fontSize:12 }} /> : <ExpandMoreIcon sx={{ fontSize:12 }} />)}
      </Box>
      <Collapse in={open}>
        {(inputM.length > 0 || outputM.length > 0) && (
          <Box sx={{ ml:1.5, mr:0.5, mb:0.5 }}>
            {inputM.slice(-2).map((m: unknown, mi) => {
              const msg = m as Record<string,unknown>
              const text = ((msg.parts as {content?:string}[]) || []).map(p => p.content||'').join('').trim()
              if (!text) return null
              return <Box key={mi} sx={{ mb:0.25 }}>
                <Chip label={String(msg.role||'user')} size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25 }} />
                <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.secondary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:80, overflow:'hidden' }}>
                  {text.slice(0,250)}{text.length>250?'…':''}
                </Typography>
              </Box>
            })}
            {outputM.slice(0,1).map((m: unknown, mi) => {
              const msg = m as Record<string,unknown>
              const text = ((msg.parts as {content?:string}[]) || []).map(p => p.content||'').join('').trim()
              if (!text) return null
              return <Box key={`o${mi}`} sx={{ borderTop:1, borderColor:'divider', pt:0.25 }}>
                <Chip label="→ response" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25, bgcolor:'rgba(59,109,17,0.1)' }} />
                <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.primary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:120, overflow:'hidden' }}>
                  {text.slice(0,350)}{text.length>350?'…':''}
                </Typography>
              </Box>
            })}
          </Box>
        )}
        {children.map(child => <SpanRow key={child.spanId} span={child} all={all} depth={depth+1} />)}
      </Collapse>
    </Box>
  )
}

// ── Data View (right panel: Statistics + Trace tabs) ──────────────────────────

function DataView({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [tab, setTab] = useState(0)
  const { data, isLoading } = useQuery({
    queryKey: ['studio-spans', runId],
    queryFn: () => studioGet<{ spans: Span[] }>(`/runs/${runId}/spans`),
    staleTime: 30000,
  })
  const spans = data?.spans ?? []
  const roots = spans.filter(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  const llm = spans.filter(s => s.name.startsWith('chat_'))
  const totalTokens = llm.reduce((s, sp) => {
    const g = ((sp.attributes as Record<string,Record<string,unknown>>)?.gen_ai?.usage as Record<string,number>) || {}
    return s + (g.total_tokens || 0)
  }, 0)
  const totalMs = spans.length > 0 ? (() => {
    try { const t0=BigInt(spans[0].startTimeUnixNano); const t1=spans.reduce((m,s)=>BigInt(s.endTimeUnixNano)>m?BigInt(s.endTimeUnixNano):m,t0); return Number((t1-t0)/BigInt(1_000_000)) } catch { return 0 }
  })() : 0

  return (
    <Box sx={{ width:280, flexShrink:0, borderLeft:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
      <Box sx={{ px:1.5, py:1, borderBottom:1, borderColor:'divider', display:'flex', alignItems:'center', gap:1 }}>
        <Typography variant="caption" fontWeight={700} sx={{ flex:1, textTransform:'uppercase', letterSpacing:'0.07em', fontSize:'0.65rem' }}>Data View</Typography>
        <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize:'0.6rem' }}>{runId.slice(-8)}</Typography>
      </Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom:1, borderColor:'divider', minHeight:32 }}>
        <Tab label="RUN" sx={{ fontSize:'0.65rem', minHeight:32, py:0, fontWeight:700 }} />
        <Tab label="TRACE" sx={{ fontSize:'0.65rem', minHeight:32, py:0, fontWeight:700 }} />
      </Tabs>
      <Box sx={{ flex:1, overflow:'auto', p:1.5 }}>
        {isLoading && <CircularProgress size={16} sx={{ m:1 }} />}
        {tab===0 && !isLoading && (
          <Box>
            {[['Spans',spans.length],['LLM calls',llm.length],['Total tokens',totalTokens.toLocaleString()],['Total time',totalMs<1000?`${totalMs}ms`:`${(totalMs/1000).toFixed(1)}s`]].map(([k,v])=>(
              <Box key={k as string} sx={{ display:'flex', justifyContent:'space-between', py:0.75, borderBottom:1, borderColor:'divider' }}>
                <Typography variant="caption" color="text.secondary">{k}</Typography>
                <Typography variant="caption" fontWeight={700} fontFamily="monospace">{v}</Typography>
              </Box>
            ))}
          </Box>
        )}
        {tab===1 && !isLoading && (
          <Box>
            {roots.length===0 && <Typography variant="caption" color="text.secondary">No trace data yet.</Typography>}
            {roots.map(r => <SpanRow key={r.spanId} span={r} all={spans} depth={0} />)}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Format agent response ─────────────────────────────────────────────────────

function formatResponse(raw: Record<string, unknown>): string {
  if (typeof raw.raw_output === 'string') return raw.raw_output
  if (raw.confidence != null && raw.recommendation) {
    const c = (Number(raw.confidence)*100).toFixed(0)
    const lines = [`**Confidence:** ${c}%  **Recommendation:** \`${raw.recommendation}\``]
    if (raw.customer_id) lines.push(`**Customer:** ${raw.customer_id}`)
    const issues = raw.issues_found as {code:string;severity:string}[]|undefined
    if (Array.isArray(issues) && issues.length) lines.push(`**Issues:** ${issues.map(i=>`${i.code}(${i.severity})`).join(', ')}`)
    if (raw.notes_for_reviewer) lines.push(`**Notes:** ${raw.notes_for_reviewer}`)
    return lines.join('\n')
  }
  if (raw.transfer_id && raw.securities_count != null) {
    const lines = [`**Transfer:** \`${raw.transfer_id}\`  **Confidence:** ${(Number(raw.confidence??0)*100).toFixed(0)}%  **Rec:** \`${raw.recommendation}\``]
    const issues = raw.issues as {code:string;severity:string}[]|undefined
    if (Array.isArray(issues) && issues.length) lines.push(`**Issues:** ${issues.map(i=>`${i.code}(${i.severity})`).join(', ')}`)
    return lines.join('\n')
  }
  return JSON.stringify(raw, null, 2)
}

// ── Voice ─────────────────────────────────────────────────────────────────────

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
    r.onresult=(e: any)=>cb(Array.from(e.results as any[]).map((x:any)=>x[0].transcript).join(' '))
    r.onend=()=>setOn(false); r.onerror=()=>setOn(false)
    r.start(); ref.current=r; setOn(true)
  }
  return { on, toggle, ok }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Chat() {
  const [searchParams] = useSearchParams()
  const { data: agentsData } = useQuery({ queryKey:['agents'], queryFn:builderApi.listAgents })
  const deployed = (agentsData?.agents ?? []).filter(a => a.status==='deployed')

  const [selectedAgent, setSelectedAgent] = useState<AgentRecord|null>(null)
  useEffect(() => {
    const p = searchParams.get('agent')
    const found = p ? deployed.find(a => a.name===p) : null
    if (found) setSelectedAgent(found)
    else if (!selectedAgent && deployed.length>0) setSelectedAgent(deployed[0])
  }, [deployed, searchParams, selectedAgent])

  // Avatar seeds per agent
  const [seeds, setSeeds] = useState<Record<string,[number,number]>>({})
  const getSeeds = (name: string): [number,number] => seeds[name] ?? [
    Math.abs(name.split('').reduce((s,c)=>s+c.charCodeAt(0),0)) % COLORS.length,
    Math.abs(name.split('').reduce((s,c)=>s*31+c.charCodeAt(0),7)) % EMOJIS.length,
  ]

  const saId = selectedAgent?.service_account_id ?? ''
  const agentRoleName = (selectedAgent as AgentRecord & { agent_role_name?: string } | null)?.agent_role_name ?? ''
  const [ci, ei] = selectedAgent ? getSeeds(selectedAgent.name) : [0,0]

  // Studio runs (Socket.io, filtered by SA ID)
  const { data: runsData, refetch: refetchRuns } = useQuery({
    queryKey: ['studio-runs', saId],
    queryFn: () => studioGet<{ runs: StudioRun[] }>(`/runs?project=${encodeURIComponent(saId)}`),
    enabled: !!saId,
    refetchInterval: 15000,
  })
  const runs = runsData?.runs ?? []

  // OTEL traces (filtered by agent role name)
  const { data: tracesData, refetch: refetchTraces } = useQuery({
    queryKey: ['studio-traces-all', saId],
    queryFn: () => studioGet<{ data: { list: StudioTrace[] } }>(`/trpc/getTraces?input=${encodeURIComponent(JSON.stringify({ pagination:{page:1,pageSize:100} }))}`),
    enabled: !!saId,
    refetchInterval: 15000,
  })
  const filteredTraces = (tracesData?.data?.list ?? []).filter(t =>
    agentRoleName ? t.traceName.toLowerCase().includes(agentRoleName.toLowerCase()) : false
  )

  const runIds = new Set(runs.map(r => r.id))
  const historyItems: { id: string; name: string; status: string; time: string; totalTokens?: number }[] = [
    ...runs.map(r => ({ id:r.id, name:r.name, status:r.status, time:r.timestamp })),
    ...filteredTraces.filter(t => !runIds.has(t.traceId)).map(t => ({
      id:t.traceId, name:t.traceName, status:t.status===1?'finished':'running', time:t.startTime, totalTokens:t.totalTokens
    })),
  ]

  // Selected run (for data view + history conversation)
  const [selectedRunId, setSelectedRunId] = useState<string|null>(null)

  // Local conversation — current session messages (user+agent pairs)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<File|null>(null)
  const { on:voiceOn, toggle:voiceToggle, ok:voiceOk } = useVoice(t => setInput(p => p ? p+' '+t : t))

  const samplePrompts: string[] = (selectedAgent as (AgentRecord & { sample_prompts?: string[] }) | null)?.sample_prompts ?? []

  // Clear conversation when switching agents
  useEffect(() => { setMessages([]); setSelectedRunId(null) }, [selectedAgent?.name])

  // Auto-scroll
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if ((!text && !attachment) || !selectedAgent || loading) return
    const userMsgId = `u${Date.now()}`
    const agentMsgId = `a${Date.now()+1}`

    setMessages(prev => [...prev,
      { id:userMsgId, role:'user', text: text || `[${attachment?.name}]` },
      { id:agentMsgId, role:'agent', text:'', loading:true },
    ])
    setInput('')
    setAttachment(null)
    setLoading(true)

    try {
      const { result, run_id } = await builderApi.invokeAgent(selectedAgent.name, {
        text, ...(attachment?.name ? { file_name:attachment.name } : {})
      })
      const raw = result as Record<string,unknown>
      setMessages(prev => prev.map(m => m.id===agentMsgId
        ? { ...m, text:formatResponse(raw), loading:false, runId:run_id }
        : m
      ))
      // Refresh run lists to pick up the new entry
      setTimeout(() => { refetchRuns(); refetchTraces() }, 3000)
    } catch (e) {
      setMessages(prev => prev.map(m => m.id===agentMsgId
        ? { ...m, text:`Error: ${String(e)}`, loading:false, error:true }
        : m
      ))
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const fmtAge = (ts: string) => {
    try {
      const ms = ts.includes('T')
        ? Date.now()-new Date(ts).getTime()
        : Date.now()-Number(BigInt(ts)/BigInt(1_000_000))
      const m = Math.floor(ms/60000)
      return m<60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`
    } catch { return '' }
  }

  // Whether to show the history view or live session
  const showHistory = selectedRunId !== null && messages.length === 0

  return (
    <Box sx={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Col 1: Run list + agent dropdown (260px) ── */}
      <Box sx={{ width:260, flexShrink:0, borderRight:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
        {/* Agent dropdown */}
        <Box sx={{ px:1.5, pt:1.25, pb:1, borderBottom:1, borderColor:'divider' }}>
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ fontSize:'0.78rem' }}>Agent</InputLabel>
            <Select
              label="Agent"
              value={selectedAgent?.name ?? ''}
              onChange={e => { const a = deployed.find(x => x.name === e.target.value); if (a) setSelectedAgent(a) }}
              sx={{ fontSize:'0.8rem' }}
              renderValue={v => {
                const a = deployed.find(x => x.name === v)
                const [c,e_] = a ? getSeeds(a.name) : [0,0]
                return (
                  <Box sx={{ display:'flex', alignItems:'center', gap:0.75 }}>
                    {a && <AgentAvatar name={a.name} c={c} e={e_} size={18} />}
                    <Typography variant="caption" fontWeight={600} noWrap>{v}</Typography>
                  </Box>
                )
              }}
            >
              {deployed.map(a => {
                const [c,e_] = getSeeds(a.name)
                return (
                  <MenuItem key={a.name} value={a.name} sx={{ gap:1 }}>
                    <AgentAvatar name={a.name} c={c} e={e_} size={20} />
                    <Box sx={{ minWidth:0 }}>
                      <Typography variant="body2" fontWeight={600} noWrap>{a.name}</Typography>
                      <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize:'0.6rem' }}>{a.service_account_id?.slice(-10)}</Typography>
                    </Box>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          {selectedAgent && (
            <Box sx={{ display:'flex', alignItems:'center', gap:0.5, mt:0.75 }}>
              <Tooltip title="Randomize avatar">
                <IconButton size="small" onClick={() => setSeeds(p => ({...p, [selectedAgent.name]:[Math.floor(Math.random()*8),Math.floor(Math.random()*8)]}))}>
                  <CasinoIcon sx={{ fontSize:13 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Open in Studio">
                <IconButton size="small" component="a" href={`${STUDIO}/projects/${saId}`} target="_blank">
                  <OpenInNewIcon sx={{ fontSize:13 }} />
                </IconButton>
              </Tooltip>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ fontSize:'0.6rem', ml:'auto', overflow:'hidden', textOverflow:'ellipsis' }}>
                {saId.slice(-14)}
              </Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ flex:1, overflowY:'auto' }}>
          {!selectedAgent && <Box sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">Select an agent</Typography></Box>}
          {selectedAgent && historyItems.length===0 && (
            <Box sx={{ p:1.5 }}><Typography variant="caption" color="text.secondary">No runs yet. Send a message to start.</Typography></Box>
          )}
          {historyItems.map(item => {
            const sel = selectedRunId===item.id
            return (
              <Box key={item.id} component="button"
                onClick={() => { setSelectedRunId(sel ? null : item.id); if (!sel) setMessages([]) }}
                sx={{ display:'flex', flexDirection:'column', width:'100%', textAlign:'left', px:1.5, py:0.875, background:'none', border:'none', cursor:'pointer', borderBottom:1, borderColor:'divider', bgcolor:sel?'primary.main':'transparent', color:sel?'primary.contrastText':'text.primary', '&:hover':{ bgcolor:sel?'primary.main':'action.hover' } }}>
                <Box sx={{ display:'flex', alignItems:'center', gap:0.75 }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', bgcolor:item.status==='finished'?'#3B6D11':'#534AB7', flexShrink:0 }} />
                  <Typography variant="caption" fontFamily="monospace" fontWeight={500}
                    sx={{ flex:1, minWidth:0, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'0.7rem' }}>
                    {item.name}
                  </Typography>
                </Box>
                <Box sx={{ display:'flex', gap:1, mt:0.2, ml:1.5 }}>
                  <Typography variant="caption" color={sel?'primary.contrastText':'text.secondary'} sx={{ fontSize:'0.62rem', opacity:0.85 }}>{fmtAge(item.time)}</Typography>
                  {item.totalTokens != null && (
                    <Typography variant="caption" color={sel?'primary.contrastText':'text.secondary'} sx={{ fontSize:'0.62rem', opacity:0.85 }}>{item.totalTokens.toLocaleString()} tokens</Typography>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
      </Box>

      {/* ── Col 3: Chat area (flex) — messages + full-width input ── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, bgcolor:'rgb(246,247,248)' }}>

        {/* Messages area */}
        <Box sx={{ flex:1, overflowY:'auto', px:3, py:2 }}>
          {/* Empty state */}
          {messages.length===0 && !selectedRunId && selectedAgent && (
            <Box sx={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:1.5, textAlign:'center' }}>
              <AgentAvatar name={selectedAgent.name} c={ci} e={ei} size={52} />
              <Typography variant="h6" fontWeight={600}>{selectedAgent.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth:380 }}>
                {historyItems.length > 0 ? `${historyItems.length} run${historyItems.length!==1?'s':''} in history. Select one or send a new message.` : 'Type a message below to invoke this agent.'}
              </Typography>
              {samplePrompts.length > 0 && (
                <Box sx={{ display:'flex', gap:0.75, flexWrap:'wrap', justifyContent:'center' }}>
                  {samplePrompts.map(p => (
                    <Box key={p} component="button" onClick={() => setInput(p)}
                      sx={{ px:1.25, py:0.5, border:'1px solid', borderColor:'divider', borderRadius:4, background:'background.paper', cursor:'pointer', fontSize:'0.75rem', '&:hover':{ bgcolor:'action.hover' } }}>
                      {p}
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}

          {/* History view — selected historical run */}
          {showHistory && selectedRunId && (
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb:1.5, textAlign:'center' }}>
                Historical run — click a message to view trace
              </Typography>
              <HistoryConversation runId={selectedRunId} agentName={selectedAgent?.name ?? ''} c={ci} e={ei} />
            </Box>
          )}

          {/* Live session messages */}
          {messages.map((msg, idx) => (
            <Box key={msg.id}>
              {idx > 0 && messages[idx-1].role === msg.role && <Box sx={{ height:4 }} />}
              {msg.role==='user' ? (
                <Box sx={{ display:'flex', justifyContent:'flex-end', mb:1, gap:1, alignItems:'flex-end' }}>
                  <Paper sx={{ maxWidth:'72%', bgcolor:'primary.main', color:'primary.contrastText', px:2, py:1.25, borderRadius:'18px 18px 4px 18px' }}>
                    <Typography variant="body2">{msg.text}</Typography>
                  </Paper>
                  <Avatar sx={{ width:28, height:28, bgcolor:'grey.300', flexShrink:0, fontSize:14 }}>👤</Avatar>
                </Box>
              ) : (
                <Box sx={{ display:'flex', gap:1.25, mb:1.5, alignItems:'flex-start' }}>
                  <AgentAvatar name={selectedAgent?.name ?? 'agent'} c={ci} e={ei} size={28} />
                  <Box sx={{ flex:1, minWidth:0 }}>
                    <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.5 }}>{selectedAgent?.name}</Typography>
                    {msg.loading ? (
                      <Box sx={{ display:'flex', gap:0.5, py:1 }}>
                        {[0,120,240].map(d => <Box key={d} sx={{ width:6, height:6, borderRadius:'50%', bgcolor:'text.disabled', animation:'bounce 1s ease-in-out infinite', animationDelay:`${d}ms`, '@keyframes bounce':{'0%,100%':{transform:'translateY(0)'},'50%':{transform:'translateY(-4px)'}} }} />)}
                      </Box>
                    ) : (
                      <Paper variant="outlined" sx={{ px:2, py:1.5, borderRadius:'4px 18px 18px 18px', bgcolor:'background.paper', borderColor:msg.error?'error.light':'divider' }}>
                        <Markdown text={msg.text} />
                      </Paper>
                    )}
                    {/* Click to open trace */}
                    {msg.runId && !msg.loading && (
                      <Box component="button" onClick={() => setSelectedRunId(prev => prev===msg.runId ? null : (msg.runId ?? null))}
                        sx={{ mt:0.5, background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:0.5, color:'text.secondary', fontSize:'0.68rem', px:0, '&:hover':{ color:'text.primary' } }}>
                        <ExpandMoreIcon sx={{ fontSize:13 }} />
                        View trace
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          ))}
          <div ref={bottomRef} />
        </Box>

        {/* Sample prompts strip (above input when there are messages) */}
        {samplePrompts.length > 0 && messages.length > 0 && (
          <Box sx={{ px:3, py:0.75, display:'flex', gap:0.5, flexWrap:'wrap', bgcolor:'background.paper', borderTop:1, borderColor:'divider' }}>
            {samplePrompts.map(p => (
              <Box key={p} component="button" onClick={() => setInput(p)}
                sx={{ px:1, py:0.35, border:'1px solid', borderColor:'divider', borderRadius:3, background:'none', cursor:'pointer', fontSize:'0.7rem', '&:hover':{ bgcolor:'action.hover' } }}>
                {p}
              </Box>
            ))}
          </Box>
        )}

        {/* ── Full-width input (Studio style) ── */}
        <Box sx={{ px:3, py:1.5, bgcolor:'background.paper', borderTop:1, borderColor:'divider' }}>
          <Paper variant="outlined" sx={{ display:'flex', flexDirection:'column', borderRadius:2, bgcolor:'white', overflow:'hidden' }}>
            {/* Attachment preview */}
            {attachment && (
              <Box sx={{ px:1.5, pt:0.75, display:'flex', alignItems:'center', gap:1 }}>
                <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined" onDelete={() => setAttachment(null)} />
              </Box>
            )}

            {/* Textarea */}
            <Box
              component="textarea"
              ref={textareaRef}
              value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={!selectedAgent ? 'Select an agent to start chatting…' : voiceOn ? '🎤 Listening…' : 'Message… (Enter to send, Shift+Enter for newline)'}
              disabled={!selectedAgent || loading}
              rows={3}
              sx={{
                width:'100%', border:'none', outline:'none', resize:'none', fontFamily:'inherit',
                fontSize:'0.875rem', px:1.5, pt:1.25, pb:0.5, bgcolor:'transparent', lineHeight:1.6,
                '::placeholder':{ color:'text.disabled' },
              }}
            />

            {/* Action bar */}
            <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1, pb:1, pt:0.25 }}>
              <input type="file" ref={fileRef} style={{ display:'none' }} accept="image/*,.pdf"
                onChange={e => { const f=e.target.files?.[0]; if(f) setAttachment(f); e.target.value='' }} />

              <Tooltip title="Attach file">
                <span>
                  <IconButton size="small" onClick={() => fileRef.current?.click()} disabled={!selectedAgent||loading} sx={{ color:'text.secondary' }}>
                    <AttachFileIcon sx={{ fontSize:18 }} />
                  </IconButton>
                </span>
              </Tooltip>

              {voiceOk && (
                <Tooltip title={voiceOn ? 'Stop listening' : 'Voice input'}>
                  <IconButton size="small" onClick={voiceToggle} disabled={!selectedAgent||loading}
                    sx={{ color:voiceOn?'error.main':'text.secondary' }}>
                    {voiceOn ? <MicOffIcon sx={{ fontSize:18 }} /> : <MicIcon sx={{ fontSize:18 }} />}
                  </IconButton>
                </Tooltip>
              )}

              <Box sx={{ flex:1 }} />

              {/* Character count */}
              <Typography variant="caption" color="text.disabled" sx={{ fontSize:'0.68rem', mr:0.5 }}>
                {input.length} {input.length === 1 ? 'character' : 'characters'}
              </Typography>

              {/* Send button */}
              <Tooltip title={loading ? 'Sending…' : 'Send (Enter)'}>
                <span>
                  <IconButton
                    onClick={send}
                    disabled={(!input.trim() && !attachment) || !selectedAgent || loading}
                    sx={{
                      bgcolor:'primary.main', color:'white', width:32, height:32, borderRadius:'50%',
                      '&:hover':{ bgcolor:'primary.dark' },
                      '&.Mui-disabled':{ bgcolor:'action.disabledBackground', color:'action.disabled' },
                    }}
                  >
                    {loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon sx={{ fontSize:16 }} />}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Paper>
          <Typography variant="caption" color="text.disabled" sx={{ display:'block', mt:0.5, textAlign:'center', fontSize:'0.65rem' }}>
            ↵ to send · Shift+↵ for new line
          </Typography>
        </Box>
      </Box>

      {/* ── Col 4: Data View (opens when run selected) ── */}
      {selectedRunId && <DataView runId={selectedRunId} onClose={() => setSelectedRunId(null)} />}
    </Box>
  )
}

// ── Historical conversation from Studio spans ─────────────────────────────────

function HistoryConversation({ runId, agentName, c, e }: { runId: string; agentName: string; c: number; e: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['studio-spans', runId],
    queryFn: () => studioGet<{ spans: Span[] }>(`/runs/${runId}/spans`),
    staleTime: 30000,
  })
  const spans = data?.spans ?? []
  const root = spans.find(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  if (isLoading) return <Box sx={{ display:'flex', justifyContent:'center', py:3 }}><CircularProgress size={20} /></Box>
  if (!root) return <Typography variant="caption" color="text.secondary" display="block" textAlign="center">No conversation data for this run.</Typography>

  const genAi = ((root.attributes as Record<string,unknown>)?.gen_ai || {}) as Record<string,unknown>
  const inputM = ((genAi?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const outputM = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
  const userMsg = inputM.find((m: unknown) => (m as Record<string,unknown>).role === 'user')
  const agentMsg = outputM.find((m: unknown) => (m as Record<string,unknown>).role === 'assistant')
  const userText = ((userMsg as Record<string,unknown>)?.parts as {content?:string}[])?.[0]?.content || ''
  const agentText = ((agentMsg as Record<string,unknown>)?.parts as {content?:string}[])?.[0]?.content || ''

  let display = agentText
  try {
    const p = JSON.parse(agentText)
    if (p.confidence != null && p.recommendation) {
      const c_ = (Number(p.confidence)*100).toFixed(0)
      const lines = [`**Confidence:** ${c_}%  **Recommendation:** \`${p.recommendation}\``]
      if (p.customer_id) lines.push(`**Customer:** ${p.customer_id}`)
      if (p.notes_for_reviewer) lines.push(`**Notes:** ${p.notes_for_reviewer}`)
      display = lines.join('\n')
    }
  } catch { /* use raw */ }

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
        <Box sx={{ display:'flex', gap:1.25, mb:1.5, alignItems:'flex-start' }}>
          <AgentAvatar name={agentName} c={c} e={e} size={28} />
          <Box sx={{ flex:1, minWidth:0 }}>
            <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.5 }}>{agentName}</Typography>
            <Paper variant="outlined" sx={{ px:2, py:1.5, borderRadius:'4px 18px 18px 18px', bgcolor:'background.paper' }}>
              <Markdown text={display} />
            </Paper>
          </Box>
        </Box>
      )}
    </Box>
  )
}
