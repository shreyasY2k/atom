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
import { extractErrorMessage } from '../../utils/errors'

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
      out.push(<Box key={i} component="pre" sx={{ bgcolor:'action.hover', p:1, borderRadius:1, my:0.5, overflow:'auto', fontSize:'0.75rem', fontFamily:'monospace', m:0 }}>{code.join('\n')}</Box>)
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
              // Show user-role parts only (skip system prompt in trace preview)
              if ((msg.role as string) === 'system') return null
              const text = ((msg.parts as {content?:string;text?:string;type?:string}[]) || [])
                .filter(p => !p.type || p.type === 'text')
                .map(p => p.content || p.text || '').join('').trim()
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
              // Only show 'text' type parts — exclude reasoning/thinking from response preview
              const text = ((msg.parts as {content?:string;text?:string;type?:string}[]) || [])
                .filter(p => p.type === 'text')
                .map(p => p.content || p.text || '').join('').trim()
              if (!text) return null
              // Strip markdown fences for preview
              const preview = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
              return <Box key={`o${mi}`} sx={{ borderTop:1, borderColor:'divider', pt:0.25 }}>
                <Chip label="→ response" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.25, bgcolor:'rgba(59,109,17,0.1)' }} />
                <Typography variant="caption" fontFamily="monospace" sx={{ display:'block', fontSize:'0.68rem', color:'text.primary', ml:0.5, whiteSpace:'pre-wrap', maxHeight:120, overflow:'hidden' }}>
                  {preview.slice(0,350)}{preview.length>350?'…':''}
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

// ── Collapsible content block (tool call, tool result, system prompt) ─────────

function ContentBlock({ title, subtitle, children, defaultOpen = false, accent = '#534AB7' }: {
  title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean; accent?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Box sx={{ border:'1px solid', borderColor:'divider', borderRadius:1.5, overflow:'hidden', mb:1 }}>
      <Box component="button" onClick={() => setOpen(v => !v)}
        sx={{ display:'flex', alignItems:'center', gap:0.75, width:'100%', textAlign:'left', background:'none', border:'none', cursor:'pointer', px:1.25, py:0.875, bgcolor:'action.hover', '&:hover':{ bgcolor:'action.selected' } }}>
        <Box sx={{ width:3, height:16, borderRadius:1, bgcolor:accent, flexShrink:0 }} />
        <Box sx={{ flex:1, minWidth:0 }}>
          <Typography variant="caption" fontWeight={600} sx={{ display:'block', fontSize:'0.72rem' }}>{title}</Typography>
          {subtitle && <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.65rem' }}>{subtitle}</Typography>}
        </Box>
        {open ? <ExpandLessIcon sx={{ fontSize:14 }} /> : <ExpandMoreIcon sx={{ fontSize:14 }} />}
      </Box>
      <Collapse in={open}>
        <Box sx={{ px:1.25, py:1, borderTop:'1px solid', borderColor:'divider', bgcolor:'background.default' }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  )
}

// ── Full conversation reconstructed from spans ────────────────────────────────

function FullConversation({ spans, agentName, c, e }: { spans: Span[]; agentName: string; c: number; e: number }) {
  if (!spans.length) return <Typography variant="caption" color="text.secondary">No conversation data.</Typography>

  // Sort spans chronologically
  const sorted = [...spans].sort((a, b) => {
    try { return Number(BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano)) } catch { return 0 }
  })

  // Root span has the overall user input and final output
  const root = sorted.find(s => !s.parentSpanId || !spans.find(p => p.spanId === s.parentSpanId))
  const genAiRoot = ((root?.attributes as Record<string,unknown>)?.gen_ai || {}) as Record<string,unknown>
  const rootInput = ((genAiRoot?.input as Record<string,unknown>)?.messages as unknown[]) || []
  const userMsg = rootInput.find((m: unknown) => (m as Record<string,unknown>).role === 'user')
  const userText = ((userMsg as Record<string,unknown>)?.parts as {content?:string}[] | undefined)?.[0]?.content || ''

  // Collect turns: each LLM call and its tool executions
  const chatSpans = sorted.filter(s => s.name.startsWith('chat ') || s.name.startsWith('chat_'))
  const toolSpans = sorted.filter(s => s.name.startsWith('execute_tool'))

  const elements: React.ReactNode[] = []

  // User message
  if (userText) {
    elements.push(
      <Box key="user" sx={{ display:'flex', justifyContent:'flex-end', mb:2, gap:1, alignItems:'flex-end' }}>
        <Paper sx={{ maxWidth:'72%', bgcolor:'primary.main', color:'primary.contrastText', px:2, py:1.25, borderRadius:'18px 18px 4px 18px' }}>
          <Typography variant="body2">{userText.slice(0, 400)}</Typography>
        </Paper>
        <Avatar sx={{ width:28, height:28, bgcolor:'grey.300', flexShrink:0, fontSize:14 }}>👤</Avatar>
      </Box>
    )
  }

  // Agent response container
  elements.push(
    <Box key="agent-turn" sx={{ display:'flex', gap:1.25, mb:2, alignItems:'flex-start' }}>
      <AgentAvatar name={agentName} c={c} e={e} size={28} />
      <Box sx={{ flex:1, minWidth:0 }}>
        <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.75 }}>{agentName}</Typography>

        {/* For each LLM call: show tool calls and results in order */}
        {chatSpans.map((chatSpan, ci) => {
          const genAi = ((chatSpan.attributes as Record<string,Record<string,unknown>>)?.gen_ai || {}) as Record<string,unknown>
          const outputMsgs = ((genAi?.output as Record<string,unknown>)?.messages as unknown[]) || []

          const turnElements: React.ReactNode[] = []

          outputMsgs.forEach((m: unknown, mi) => {
            const msg = m as Record<string,unknown>
            const parts = (msg.parts as Record<string,unknown>[] | undefined) || []

            parts.forEach((part, pi) => {
              const ptype = part.type as string
              const key = `chat-${ci}-msg-${mi}-part-${pi}`
              // Span data uses 'content' for all part types; 'text'/'thinking' are fallbacks
              const partContent = String(part.content ?? part.text ?? part.thinking ?? '')

              // Gemini returns 'reasoning' type; some spans use 'thinking'
              if (ptype === 'reasoning' || ptype === 'thinking') {
                if (!partContent) return
                turnElements.push(
                  <ContentBlock key={key} title="Thinking" accent="#6941C6" defaultOpen={false}>
                    <Typography variant="caption" fontFamily="monospace" sx={{ fontSize:'0.68rem', color:'text.secondary', whiteSpace:'pre-wrap', display:'block' }}>
                      {partContent.slice(0, 600)}
                    </Typography>
                  </ContentBlock>
                )
              } else if (ptype === 'tool_call') {
                const toolName = part.name as string || 'tool'
                const args = part.args as Record<string,unknown> || {}
                const toolResult = toolSpans.find(ts => ts.name.includes(toolName))
                const toolGenAi = ((toolResult?.attributes as Record<string,Record<string,unknown>>)?.gen_ai || {}) as Record<string,unknown>
                const resultMsgs = ((toolGenAi?.output as Record<string,unknown>)?.messages as unknown[]) || []
                const resultText = resultMsgs.flatMap((rm: unknown) =>
                  ((rm as Record<string,unknown>).parts as {content?:string;text?:string;type?:string}[] | undefined || [])
                    .filter(p => p.type === 'text').map(p => p.content || p.text || '')
                ).join('')

                turnElements.push(
                  <ContentBlock key={key} title={`Tool call: ${toolName}`} accent="#854F0B" defaultOpen={false}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.65rem' }}>Arguments</Typography>
                    <Box component="pre" sx={{ fontSize:'0.68rem', fontFamily:'monospace', bgcolor:'action.hover', p:0.75, borderRadius:0.75, mt:0.25, overflow:'auto', maxHeight:80 }}>
                      {JSON.stringify(args, null, 2)}
                    </Box>
                    {resultText && (<>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.65rem', mt:0.75, display:'block' }}>Result</Typography>
                      <Box component="pre" sx={{ fontSize:'0.68rem', fontFamily:'monospace', bgcolor:'action.hover', p:0.75, borderRadius:0.75, mt:0.25, overflow:'auto', maxHeight:100 }}>
                        {resultText.slice(0, 400)}
                      </Box>
                    </>)}
                  </ContentBlock>
                )
              } else if (ptype === 'text') {
                // Only show for the last chat span; use part.content (primary) or part.text
                const isLastChat = ci === chatSpans.length - 1
                if (isLastChat && partContent) {
                  // Strip markdown fences if the response is wrapped in ```json ... ```
                  let display = partContent.trim()
                  const fenceMatch = display.match(/^```(?:json)?\n?([\s\S]*?)```\s*$/)
                  if (fenceMatch) display = fenceMatch[1].trim()

                  // Pretty-print if valid JSON
                  try {
                    display = JSON.stringify(JSON.parse(display), null, 2)
                  } catch { /* leave as-is */ }

                  turnElements.push(
                    <ContentBlock key={key} title={`${agentName} response`} accent="#3B6D11" defaultOpen={true}>
                      <Box component="pre" sx={{ fontSize:'0.75rem', fontFamily:'monospace', whiteSpace:'pre-wrap', overflow:'auto', maxHeight:300, m:0, color:'text.primary' }}>
                        {display}
                      </Box>
                    </ContentBlock>
                  )
                }
              }
            })
          })

          return <Box key={`chat-${ci}`}>{turnElements}</Box>
        })}
      </Box>
    </Box>
  )

  return <Box>{elements}</Box>
}

// ── Data View — RUN / TRACE tabs using builder-backend MinIO events ──────────
// Studio Socket.io IDs don't match builder-backend run IDs, so we use
// GET /agents/{name}/runs/{runId}/events instead (reads from MinIO, always correct).

function DataView({ agentName, runId, userText, agentText }: {
  agentName: string; runId: string; userText?: string; agentText?: string
}) {
  const [tab, setTab] = useState(0)
  const { data, isLoading } = useQuery({
    queryKey: ['run-events', agentName, runId],
    queryFn: () => builderApi.getRunEvents(agentName, runId),
    staleTime: 60_000,
  })
  const events = data?.events ?? []

  const llmEvents = events.filter(e => e.event_type === 'llm_call')
  const toolEvents = events.filter(e => e.event_type === 'tool_call')
  const totalIn  = llmEvents.reduce((s, e) => s + (e.input_tokens ?? 0), 0)
  const totalOut = llmEvents.reduce((s, e) => s + (e.output_tokens ?? 0), 0)
  const totalTok = totalIn + totalOut
  const totalMs  = llmEvents.reduce((s, e) => s + (e.duration_ms ?? 0), 0)

  const modelCounts: Record<string,number> = {}
  llmEvents.forEach(e => {
    const m = (e.model ?? 'unknown').replace('gemini-3.1-pro-preview','gemini-3.1-pro').slice(0,22)
    modelCounts[m] = (modelCounts[m] ?? 0) + 1
  })
  const maxModelCount = Math.max(1, ...Object.values(modelCounts))

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Box sx={{ mb:2 }}>
      <Typography variant="caption" fontWeight={700} color="text.secondary"
        sx={{ display:'block', mb:0.75, textTransform:'uppercase', letterSpacing:'0.07em', fontSize:'0.62rem' }}>
        {title}
      </Typography>
      {children}
    </Box>
  )

  const Row = ({ label, value, mono = false }: { label: string; value: string | number; mono?: boolean }) => (
    <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', py:0.5, borderBottom:'1px solid', borderColor:'divider' }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.72rem' }}>{label}</Typography>
      <Typography variant="caption" fontWeight={600} fontFamily={mono ? 'monospace' : 'inherit'} sx={{ fontSize:'0.72rem' }}>{value}</Typography>
    </Box>
  )

  return (
    <Box sx={{ width:300, flexShrink:0, borderLeft:1, borderColor:'divider', display:'flex', flexDirection:'column', bgcolor:'background.paper' }}>
      <Box sx={{ px:1.5, py:1, borderBottom:1, borderColor:'divider' }}>
        <Typography variant="caption" fontWeight={700} sx={{ textTransform:'uppercase', letterSpacing:'0.07em', fontSize:'0.65rem' }}>
          Trace
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display:'block', fontSize:'0.62rem', mt:0.25 }}>
          {agentName} · {runId.slice(-12)}
        </Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom:1, borderColor:'divider', minHeight:36, px:1 }}>
        {['RUN','MESSAGE','LLM CALLS'].map((lbl, idx) => (
          <Tab key={lbl} label={lbl} value={idx}
            sx={{ fontSize:'0.65rem', minHeight:36, py:0, fontWeight:700, minWidth:60, px:1 }} />
        ))}
      </Tabs>

      <Box sx={{ flex:1, overflow:'auto' }}>
        {isLoading && <Box sx={{ p:2 }}><CircularProgress size={16} /></Box>}

        {/* ── RUN tab ── */}
        {tab===0 && !isLoading && (
          <Box sx={{ p:1.5 }}>
            <Box sx={{ display:'flex', alignItems:'center', gap:1.5, mb:2, p:1.25, bgcolor:'action.hover', borderRadius:1.5 }}>
              <Box sx={{ textAlign:'center', flex:1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display:'block', fontSize:'0.6rem', textTransform:'uppercase' }}>STATUS</Typography>
                <Chip label="DONE" size="small" color="success" sx={{ height:20, fontSize:'0.65rem', mt:0.25 }} />
              </Box>
              <Box sx={{ width:'1px', bgcolor:'divider', alignSelf:'stretch' }} />
              <Box sx={{ textAlign:'center', flex:1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display:'block', fontSize:'0.6rem', textTransform:'uppercase' }}>LLM CALLS</Typography>
                <Typography variant="body2" fontWeight={700}>{llmEvents.length}</Typography>
              </Box>
              <Box sx={{ width:'1px', bgcolor:'divider', alignSelf:'stretch' }} />
              <Box sx={{ textAlign:'center', flex:1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display:'block', fontSize:'0.6rem', textTransform:'uppercase' }}>TOKENS</Typography>
                <Typography variant="body2" fontWeight={700}>{totalTok > 1000 ? `${(totalTok/1000).toFixed(1)}K` : totalTok}</Typography>
              </Box>
            </Box>

            {events.length === 0 && (
              <Typography variant="caption" color="text.secondary">
                No LiteLLM events found for this run. Events may not yet be indexed in MinIO.
              </Typography>
            )}

            {events.length > 0 && <>
              <Section title="INVOCATION">
                <Row label="LLM calls" value={llmEvents.length} />
                <Row label="Tool calls" value={toolEvents.length} />
                <Row label="Total time" value={totalMs<1000?`${totalMs}ms`:`${(totalMs/1000).toFixed(1)}s`} />
              </Section>

              {Object.keys(modelCounts).length > 0 && (
                <Section title="MODEL">
                  {Object.entries(modelCounts).map(([model, count]) => (
                    <Box key={model} sx={{ mb:0.75 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.65rem', display:'block', mb:0.25 }}>{model}</Typography>
                      <Box sx={{ display:'flex', alignItems:'center', gap:1 }}>
                        <Box sx={{ flex:1, height:6, bgcolor:'action.hover', borderRadius:0.5, overflow:'hidden' }}>
                          <Box sx={{ width:`${(count/maxModelCount)*100}%`, height:'100%', bgcolor:'primary.main', borderRadius:0.5 }} />
                        </Box>
                        <Typography variant="caption" fontFamily="monospace" sx={{ fontSize:'0.62rem', flexShrink:0 }}>{count}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Section>
              )}

              <Section title="TOKENS">
                <Row label="Total" value={totalTok.toLocaleString()} />
                <Row label="Prompt" value={totalIn.toLocaleString()} />
                <Row label="Completion" value={totalOut.toLocaleString()} />
              </Section>
            </>}
          </Box>
        )}

        {/* ── MESSAGE tab — user prompt + agent response ── */}
        {tab===1 && !isLoading && (
          <Box sx={{ p:1.5 }}>
            {userText && (
              <Box sx={{ mb:1.5 }}>
                <Chip label="user" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.5 }} />
                <Typography variant="caption" display="block" sx={{ whiteSpace:'pre-wrap', color:'text.primary' }}>{userText}</Typography>
              </Box>
            )}
            {agentText && (
              <Box>
                <Chip label="→ response" size="small" sx={{ height:14, fontSize:'0.58rem', mb:0.5, bgcolor:'rgba(59,109,17,0.1)' }} />
                <Box component="pre" sx={{ fontSize:'0.72rem', fontFamily:'monospace', whiteSpace:'pre-wrap', overflow:'auto', maxHeight:400, m:0, color:'text.primary', bgcolor:'action.hover', p:1, borderRadius:1 }}>
                  {agentText}
                </Box>
              </Box>
            )}
            {!userText && !agentText && (
              <Typography variant="caption" color="text.secondary">No message data.</Typography>
            )}
          </Box>
        )}

        {/* ── LLM CALLS tab — MinIO LiteLLM events ── */}
        {tab===2 && !isLoading && (
          <Box sx={{ p:1 }}>
            {events.length === 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ p:1, display:'block' }}>
                No LiteLLM events in MinIO for this run yet.
              </Typography>
            )}
            {events.map((ev, i) => (
              <Box key={i} sx={{ mb:1, border:1, borderColor:'divider', borderRadius:1, overflow:'hidden' }}>
                <Box sx={{ px:1, py:0.5, bgcolor:'action.hover', display:'flex', alignItems:'center', gap:1 }}>
                  <Box sx={{ width:6, height:6, borderRadius:'50%', flexShrink:0,
                    bgcolor: ev.event_type==='tool_call' ? '#854F0B' : '#185FA5' }} />
                  <Typography variant="caption" fontFamily="monospace" fontWeight={600} sx={{ flex:1, fontSize:'0.7rem', color: ev.event_type==='tool_call' ? '#854F0B' : '#185FA5' }}>
                    {ev.event_type==='tool_call' ? `tool: ${ev.tool_name ?? '?'}` : (ev.model ?? 'llm_call').slice(0,20)}
                  </Typography>
                  {ev.duration_ms != null && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0 }}>
                      {ev.duration_ms < 1000 ? `${ev.duration_ms}ms` : `${(ev.duration_ms/1000).toFixed(1)}s`}
                    </Typography>
                  )}
                  {(ev.input_tokens != null || ev.output_tokens != null) && (
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', flexShrink:0 }}>
                      {(ev.input_tokens ?? 0) + (ev.output_tokens ?? 0)}t
                    </Typography>
                  )}
                </Box>
                {ev.response_content && (
                  <Box sx={{ px:1, py:0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize:'0.6rem', display:'block', mb:0.25 }}>→ response</Typography>
                    <Typography variant="caption" fontFamily="monospace" sx={{ fontSize:'0.68rem', whiteSpace:'pre-wrap', color:'text.primary', display:'block', maxHeight:100, overflow:'hidden' }}>
                      {ev.response_content.slice(0,300)}{ev.response_content.length>300?'…':''}
                    </Typography>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  )
}

// ── Format agent response ─────────────────────────────────────────────────────

function formatResponse(raw: Record<string, unknown>): string {
  // Strip internal tracking fields before display
  const { _run_id, ...display } = raw
  raw = display
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
    if (found && found.name !== selectedAgent?.name) setSelectedAgent(found)
    else if (!selectedAgent && deployed.length > 0) setSelectedAgent(deployed[0])
  }, [deployed, searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Avatar seed — deterministic per agent name
  const getSeeds = (name: string): [number,number] => [
    Math.abs(name.split('').reduce((s,c)=>s+c.charCodeAt(0),0)) % COLORS.length,
    Math.abs(name.split('').reduce((s,c)=>s*31+c.charCodeAt(0),7)) % EMOJIS.length,
  ]
  const saId = selectedAgent?.service_account_id ?? ''
  const [ci, ei] = selectedAgent ? getSeeds(selectedAgent.name) : [0,0]

  // Selected run for DataView panel (set when user clicks "View trace")
  const [selectedRunId, setSelectedRunId] = useState<string|null>(null)
  const [traceContext, setTraceContext] = useState<{ userText?: string; agentText?: string }>({})

  // Find user message that precedes an agent message by index
  const getTraceContext = (agentMsgId: string) => {
    const idx = messages.findIndex(m => m.id === agentMsgId)
    const userMsg = idx > 0 ? messages[idx - 1] : null
    const agentMsg = messages[idx]
    return { userText: userMsg?.text, agentText: agentMsg?.text }
  }

  // Conversation messages
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachment, setAttachment] = useState<File|null>(null)
  const { on:voiceOn, toggle:voiceToggle, ok:voiceOk } = useVoice(t => setInput(p => p ? p+' '+t : t))

  const samplePrompts: string[] = (selectedAgent as (AgentRecord & { sample_prompts?: string[] }) | null)?.sample_prompts ?? []

  // Restore conversation when agent changes.
  // Fetch runs directly (not via useQuery) to avoid React Query returning
  // a previous agent's cached data before the new query resolves — which
  // caused all agents to show the same (last-used) conversation.
  // The cancellation flag discards any fetch that resolves after another
  // agent switch has already happened.
  useEffect(() => {
    if (!selectedAgent) { setMessages([]); setSelectedRunId(null); return }
    let cancelled = false
    const agentName = selectedAgent.name
    const key = `atom_chat_v2_${agentName}`

    // Tier 1: localStorage (instant, no network)
    try {
      const stored = localStorage.getItem(key)
      if (stored) {
        const parsed = JSON.parse(stored) as LocalMessage[]
        if (!cancelled) { setMessages(parsed); setSelectedRunId(null) }
        return
      }
    } catch { /* corrupt — fall through */ }

    // Clear immediately while the fetch is in flight
    setMessages([])
    setSelectedRunId(null)

    // Tier 2: backend run history for THIS specific agent
    builderApi.listAgentRuns(agentName)
      .then(data => {
        if (cancelled) return
        const runs = (data.runs ?? []) as Array<{
          run_id: string; user_message?: string; agent_response?: string
        }>
        if (runs.length === 0) return
        const reconstructed: LocalMessage[] = []
        ;[...runs].reverse().forEach((run, i) => {
          if (!run.user_message) return
          reconstructed.push({ id:`hist-u-${i}`, role:'user', text:run.user_message })
          reconstructed.push({ id:`hist-a-${i}`, role:'agent', text:run.agent_response ?? '', runId:run.run_id })
        })
        if (reconstructed.length === 0) return
        setMessages(reconstructed)
        // Seed localStorage so next switch/refresh is instant
        try { localStorage.setItem(key, JSON.stringify(reconstructed)) } catch { /* quota */ }
      })
      .catch(() => { /* no history available — stay empty */ })

    return () => { cancelled = true }
  }, [selectedAgent?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  // Persist to localStorage when messages change from user sends.
  // IMPORTANT: selectedAgent?.name is intentionally NOT in the dep array.
  // Including it causes both this effect and the restore effect to fire on
  // agent switch — both capture stale messages, so this effect writes the
  // old agent's messages under the new agent's key before restore clears them.
  // By depending only on messages, this only fires when messages actually
  // change (new sends), not when the agent name changes.
  useEffect(() => {
    if (!selectedAgent || messages.length === 0) return
    const toStore = messages.filter(m => !m.loading)
    if (toStore.length === 0) return
    try { localStorage.setItem(`atom_chat_v2_${selectedAgent.name}`, JSON.stringify(toStore)) } catch { /* quota */ }
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll on new message
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:'smooth' }) }, [messages, loading])

  const send = async () => {
    const text = input.trim()
    if ((!text && !attachment) || !selectedAgent || loading) return
    const userMsgId = `u${Date.now()}`
    const agentMsgId = `a${Date.now()+1}`

    setMessages(prev => [
      ...prev,
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
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId ? { ...m, text:formatResponse(raw), loading:false, runId:run_id } : m
      ))
    } catch (e) {
      setMessages(prev => prev.map(m =>
        m.id === agentMsgId ? { ...m, text:`Error: ${extractErrorMessage(e)}`, loading:false, error:true } : m
      ))
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  return (
    <Box sx={{ display:'flex', height:'100%', overflow:'hidden' }}>

      {/* ── Main chat area ── */}
      <Box sx={{ flex:1, display:'flex', flexDirection:'column', minWidth:0 }}>

        {/* Agent header bar */}
        <Box sx={{ px:3, py:1, borderBottom:1, borderColor:'divider', bgcolor:'background.paper', display:'flex', alignItems:'center', gap:1.5 }}>
          <FormControl size="small" sx={{ minWidth:200 }}>
            <Select
              value={selectedAgent?.name ?? ''}
              onChange={e => { const a = deployed.find(x => x.name===e.target.value); if (a) setSelectedAgent(a) }}
              displayEmpty
              sx={{ fontSize:'0.8rem' }}
              renderValue={v => {
                if (!v) return <Typography variant="caption" color="text.secondary">Select agent…</Typography>
                const a = deployed.find(x => x.name===v)
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
                    <AgentAvatar name={a.name} c={c} e={e_} size={18} />
                    <Typography variant="body2" fontWeight={600} noWrap>{a.name}</Typography>
                  </MenuItem>
                )
              })}
            </Select>
          </FormControl>
          {saId && (
            <Chip label={saId.slice(-16)} size="small"
              sx={{ fontFamily:'monospace', fontSize:'0.6rem', bgcolor:'rgba(74,20,140,0.08)', color:'#7b1fa2' }} />
          )}
          {saId && (
            <Tooltip title="Open in Studio">
              <IconButton size="small" component="a" href={`${STUDIO}/projects/${saId}`} target="_blank" sx={{ ml:'auto' }}>
                <OpenInNewIcon sx={{ fontSize:14 }} />
              </IconButton>
            </Tooltip>
          )}
          {messages.length > 0 && (
            <Tooltip title="Clear conversation">
              <IconButton size="small" onClick={() => {
                setMessages([])
                setSelectedRunId(null)
                if (selectedAgent) {
                  try { localStorage.removeItem(`atom_chat_v2_${selectedAgent.name}`) } catch { /* ignore */ }
                }
              }} sx={{ color:'text.secondary' }}>
                <CasinoIcon sx={{ fontSize:14 }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>

        {/* Messages scroll area */}
        <Box sx={{ flex:1, overflowY:'auto', px:4, py:3, bgcolor:'background.default' }}>

          {/* Empty state */}
          {messages.length === 0 && selectedAgent && (
            <Box sx={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:2, textAlign:'center' }}>
              <AgentAvatar name={selectedAgent.name} c={ci} e={ei} size={52} />
              <Typography variant="h6" fontWeight={600}>{selectedAgent.name}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth:400 }}>
                Type a message to invoke this agent. Each message is an independent call.
              </Typography>
              {samplePrompts.length > 0 && (
                <Box sx={{ display:'flex', gap:0.75, flexWrap:'wrap', justifyContent:'center', mt:0.5 }}>
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

          {!selectedAgent && (
            <Box sx={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
              <Typography variant="body2" color="text.secondary">Select an agent above to start chatting.</Typography>
            </Box>
          )}

          {/* All messages in one stream */}
          {messages.map(msg => (
            <Box key={msg.id} sx={{ mb: msg.role === 'user' ? 1 : 2 }}>
              {msg.role === 'user' ? (
                <Box sx={{ display:'flex', justifyContent:'flex-end', gap:1, alignItems:'flex-end' }}>
                  <Paper sx={{ maxWidth:'68%', bgcolor:'primary.main', color:'primary.contrastText', px:2, py:1.25, borderRadius:'18px 18px 4px 18px' }}>
                    <Typography variant="body2" sx={{ whiteSpace:'pre-wrap' }}>{msg.text}</Typography>
                  </Paper>
                  <Avatar sx={{ width:28, height:28, bgcolor:'grey.400', flexShrink:0, fontSize:14 }}>👤</Avatar>
                </Box>
              ) : (
                <Box sx={{ display:'flex', gap:1.25, alignItems:'flex-start' }}>
                  <AgentAvatar name={selectedAgent?.name ?? 'agent'} c={ci} e={ei} size={28} />
                  <Box sx={{ flex:1, minWidth:0 }}>
                    <Typography variant="caption" fontWeight={700} display="block" sx={{ mb:0.5 }}>
                      {selectedAgent?.name}
                    </Typography>
                    {msg.loading ? (
                      <Box sx={{ display:'flex', gap:0.5, py:1 }}>
                        {[0,120,240].map(d => (
                          <Box key={d} sx={{ width:6, height:6, borderRadius:'50%', bgcolor:'text.disabled',
                            animation:'bounce 1s ease-in-out infinite', animationDelay:`${d}ms`,
                            '@keyframes bounce':{'0%,100%':{transform:'translateY(0)'},'50%':{transform:'translateY(-4px)'}} }} />
                        ))}
                      </Box>
                    ) : (
                      <Paper variant="outlined" sx={{ px:2, py:1.5, borderRadius:'4px 18px 18px 18px', bgcolor:'background.paper', borderColor:msg.error?'error.light':'divider' }}>
                        <Markdown text={msg.text} />
                      </Paper>
                    )}
                    {msg.runId && !msg.loading && (
                      <Box component="button"
                        onClick={() => {
                          const isOpen = selectedRunId === msg.runId
                          setSelectedRunId(isOpen ? null : (msg.runId ?? null))
                          if (!isOpen) setTraceContext(getTraceContext(msg.id))
                        }}
                        sx={{ mt:0.5, background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:0.5, color:'text.secondary', fontSize:'0.68rem', px:0, '&:hover':{ color:'primary.main' } }}>
                        <ExpandMoreIcon sx={{ fontSize:13 }} />
                        {selectedRunId===msg.runId ? 'Hide trace' : 'View trace'}
                      </Box>
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          ))}
          <div ref={bottomRef} />
        </Box>

        {/* Sample prompts strip */}
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

        {/* Input bar */}
        <Box sx={{ px:3, py:1.5, bgcolor:'background.paper', borderTop:1, borderColor:'divider' }}>
          <Paper variant="outlined" sx={{ display:'flex', flexDirection:'column', borderRadius:2, overflow:'hidden' }}>
            {attachment && (
              <Box sx={{ px:1.5, pt:0.75, display:'flex', alignItems:'center', gap:1 }}>
                <Chip icon={<AttachFileIcon />} label={attachment.name} size="small" variant="outlined" onDelete={() => setAttachment(null)} />
              </Box>
            )}
            <Box component="textarea" ref={textareaRef} value={input}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={!selectedAgent ? 'Select an agent above…' : voiceOn ? '🎤 Listening…' : 'Message… (Enter to send, Shift+Enter for newline)'}
              disabled={!selectedAgent || loading} rows={3}
              sx={{ width:'100%', border:'none', outline:'none', resize:'none', fontFamily:'inherit', fontSize:'0.875rem', px:1.5, pt:1.25, pb:0.5, bgcolor:'transparent', lineHeight:1.6, '::placeholder':{ color:'text.disabled' } }}
            />
            <Box sx={{ display:'flex', alignItems:'center', gap:0.5, px:1, pb:1, pt:0.25 }}>
              <input type="file" ref={fileRef} style={{ display:'none' }} accept="image/*,.pdf"
                onChange={e => { const f=e.target.files?.[0]; if(f) setAttachment(f); e.target.value='' }} />
              <Tooltip title="Attach file"><span>
                <IconButton size="small" onClick={() => fileRef.current?.click()} disabled={!selectedAgent||loading} sx={{ color:'text.secondary' }}>
                  <AttachFileIcon sx={{ fontSize:18 }} />
                </IconButton>
              </span></Tooltip>
              {voiceOk && (
                <Tooltip title={voiceOn ? 'Stop' : 'Voice input'}>
                  <IconButton size="small" onClick={voiceToggle} disabled={!selectedAgent||loading}
                    sx={{ color:voiceOn?'error.main':'text.secondary' }}>
                    {voiceOn ? <MicOffIcon sx={{ fontSize:18 }} /> : <MicIcon sx={{ fontSize:18 }} />}
                  </IconButton>
                </Tooltip>
              )}
              <Box sx={{ flex:1 }} />
              <Typography variant="caption" color="text.disabled" sx={{ fontSize:'0.68rem', mr:0.5 }}>
                {input.length} characters
              </Typography>
              <Tooltip title={loading ? 'Sending…' : 'Send (Enter)'}><span>
                <IconButton onClick={send} disabled={(!input.trim()&&!attachment)||!selectedAgent||loading}
                  sx={{ bgcolor:'primary.main', color:'white', width:32, height:32, borderRadius:'50%', '&:hover':{ bgcolor:'primary.dark' }, '&.Mui-disabled':{ bgcolor:'action.disabledBackground', color:'action.disabled' } }}>
                  {loading ? <CircularProgress size={16} color="inherit" /> : <SendIcon sx={{ fontSize:16 }} />}
                </IconButton>
              </span></Tooltip>
            </Box>
          </Paper>
          <Typography variant="caption" color="text.disabled" sx={{ display:'block', mt:0.5, textAlign:'center', fontSize:'0.65rem' }}>
            ↵ to send · Shift+↵ for new line
          </Typography>
        </Box>
      </Box>

      {/* DataView panel — opens when user clicks "View trace" on a message */}
      {selectedRunId && selectedAgent && (
        <DataView
          agentName={selectedAgent.name}
          runId={selectedRunId}
          userText={traceContext.userText}
          agentText={traceContext.agentText}
        />
      )}
    </Box>
  )
}

// ── Kept for DataView MESSAGE tab (single-run spans only) ─────────────────────

function HistoryConversation({ runId, agentName, c, e }: { runId: string; agentName: string; c: number; e: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['studio-spans', runId],
    queryFn: () => studioGet<{ spans: Span[] }>(`/runs/${runId}/spans`),
    staleTime: 30000,
  })
  if (isLoading) return <Box sx={{ display:'flex', justifyContent:'center', py:3 }}><CircularProgress size={20} /></Box>
  return <FullConversation spans={data?.spans ?? []} agentName={agentName} c={c} e={e} />
}
