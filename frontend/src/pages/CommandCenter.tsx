/**
 * Security Command Center — full-stack observability dashboard.
 * Modelled after GCP Cloud Monitoring / Grafana:
 *   • Top KPI strip with 24h stats and trend signals
 *   • Time-series charts: call volume, latency percentiles, guardrail events
 *   • 10-layer security posture grid with live status
 *   • Dense per-agent table with health indicators
 *   • Live event feed
 */

import React, { useEffect, useState, useCallback } from 'react'
import {
  Box, Grid, Typography, Tooltip, IconButton, CircularProgress,
  Alert, Divider, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, ToggleButton, ToggleButtonGroup,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat'
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord'
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined'
import {
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip,
  Legend, ResponsiveContainer,
  Cell,
} from 'recharts'

const BASE = 'http://localhost:8080'
const REFRESH_MS = 30_000
const BLUE = '#1a73e8'
const GREEN = '#34a853'
const RED = '#ea4335'
const YELLOW = '#fbbc04'
const PURPLE = '#9334ea'
const GRAY = '#9aa0a6'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Overview {
  total_calls: number; failed_calls: number; avg_latency_ms: number
  p95_latency_ms: number; total_blocks: number; pii_events: number; active_agents: number
}
interface AgentStat {
  agent_name: string; status: string; call_count: number
  avg_latency_ms: number; p95_latency_ms: number; error_count: number
  guardrail_blocks: number; pii_redactions: number; guardrail_events: number
}
interface SecurityLayer {
  layer_id: string; number: number; name: string; description: string
  where: string; phase: string; fail_mode: string
  status: 'active' | 'idle' | 'disabled'
  total_events: number; blocks: number; redactions: number; last_event: string | null
}
interface GuardrailEvent {
  id: number; layer: string; phase: string; verdict: string
  threat_type: string | null; threat_level: string | null
  pii_types: string | null; created_at: string; agent_name: string | null
}
interface TimeseriesPoint { time: string }
interface CallPoint extends TimeseriesPoint { calls: number; errors: number }
interface LatencyPoint extends TimeseriesPoint { p50: number; p95: number; p99: number }
interface GuardrailPoint extends TimeseriesPoint { blocks: number; redactions: number }
interface LayerDistPoint { layer: string; events: number }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getJSON = (path: string) =>
  fetch(`${BASE}${path}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })

const fmt = (n: number) => n >= 10000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString()
const fmtMs = (ms: number) => !ms ? '—' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`
const ago = (iso: string | null) => {
  if (!iso) return null
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}
const pctChange = (cur: number, prev: number) =>
  prev === 0 ? null : Math.round(((cur - prev) / prev) * 100)

// ─── Design tokens ────────────────────────────────────────────────────────────

const CARD = {
  bgcolor: 'background.paper',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1.5,
  overflow: 'hidden',
}

const CHART_STYLE = { fontFamily: 'Roboto, sans-serif', fontSize: 11 }

// ─── Sub-components ──────────────────────────────────────────────────────────

function KPICard({ label, value, sub, trend, accent, icon }: {
  label: string; value: string | number; sub?: string
  trend?: number | null; accent?: string; icon?: React.ReactNode
}) {
  const TrendIcon = trend == null ? null : trend > 5 ? TrendingUpIcon : trend < -5 ? TrendingDownIcon : TrendingFlatIcon
  const trendColor = trend == null ? GRAY : trend > 0 ? RED : GREEN  // higher blocks = bad; higher calls = neutral

  return (
    <Box sx={{ ...CARD, p: 2, height: '100%' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: 1.2, mb: 1 }}>
          {label}
        </Typography>
        {icon && <Box sx={{ color: accent || 'text.disabled', opacity: 0.6, mt: -0.25 }}>{icon}</Box>}
      </Box>
      <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1, color: accent || 'text.primary', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {(sub || trend != null) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.75 }}>
          {TrendIcon && <TrendIcon sx={{ fontSize: 14, color: trendColor }} />}
          <Typography sx={{ fontSize: '0.72rem', color: trend != null ? trendColor : 'text.secondary' }}>
            {trend != null ? `${trend > 0 ? '+' : ''}${trend}%` : ''}{sub ? (trend != null ? ` · ${sub}` : sub) : ''}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: 'text.primary', letterSpacing: '0.03em' }}>{title}</Typography>
      {sub && <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
    </Box>
  )
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null
  return (
    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1.25, minWidth: 120 }}>
      <Typography sx={{ fontSize: '0.7rem', color: 'text.secondary', mb: 0.5 }}>{label}</Typography>
      {payload.map(p => (
        <Box key={p.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color }} />
          <Typography sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>{p.name}:</Typography>
          <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: 'text.primary' }}>{p.value}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function LayerRow({ layer }: { layer: SecurityLayer }) {
  const isActive = layer.status === 'active'
  const isDisabled = layer.status === 'disabled'

  return (
    <Tooltip title={`${layer.description} — ${layer.where}`} placement="right" arrow>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, py: 0.75, px: 1,
        borderRadius: 1, cursor: 'default',
        '&:hover': { bgcolor: 'action.hover' },
        opacity: isDisabled ? 0.45 : 1,
      }}>
        <FiberManualRecordIcon sx={{
          fontSize: 9, flexShrink: 0,
          color: isActive ? 'success.main' : isDisabled ? 'error.main' : 'text.disabled',
        }} />
        <Box sx={{
          minWidth: 24, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
          bgcolor: isActive ? 'primary.main' : 'action.selected',
          color: isActive ? 'primary.contrastText' : 'text.secondary',
          borderRadius: 0.5, flexShrink: 0,
        }}>
          <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, fontFamily: 'monospace', lineHeight: 1 }}>
            L{layer.number}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: '0.78rem', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {layer.name}
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
          {layer.blocks > 0 && (
            <Box sx={{ bgcolor: 'error.main', color: '#fff', borderRadius: 0.5, px: 0.5, minWidth: 22, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, lineHeight: '16px', fontFamily: 'monospace' }}>
                {layer.blocks}
              </Typography>
            </Box>
          )}
          {layer.redactions > 0 && (
            <Box sx={{ bgcolor: 'warning.main', color: '#fff', borderRadius: 0.5, px: 0.5, minWidth: 22, textAlign: 'center' }}>
              <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, lineHeight: '16px', fontFamily: 'monospace' }}>
                {layer.redactions}
              </Typography>
            </Box>
          )}
          <Box sx={{
            px: 0.6, borderRadius: 0.5,
            bgcolor: layer.fail_mode === 'CLOSED' ? 'error.main' : layer.fail_mode === 'OPEN' ? 'action.selected' : 'transparent',
            color: layer.fail_mode === 'CLOSED' ? '#fff' : 'text.secondary',
          }}>
            <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, lineHeight: '16px', letterSpacing: '0.04em' }}>
              {layer.fail_mode === 'CLOSED' ? 'CLOSED' : layer.fail_mode === 'N/A' ? 'AUDIT' : 'OPEN'}
            </Typography>
          </Box>
        </Box>
      </Box>
    </Tooltip>
  )
}

function EventRow({ ev }: { ev: GuardrailEvent }) {
  const vcfg = {
    deny:   { label: 'BLOCK',  bg: RED },
    redact: { label: 'REDACT', bg: YELLOW },
    allow:  { label: 'ALLOW',  bg: GREEN },
  }[ev.verdict] ?? { label: ev.verdict.toUpperCase(), bg: GRAY }

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 1, px: 1.5 }}>
      <Box sx={{ bgcolor: vcfg.bg, color: '#fff', borderRadius: 0.5, px: 0.75, flexShrink: 0, mt: 0.1 }}>
        <Typography sx={{ fontSize: '0.58rem', fontWeight: 800, lineHeight: '16px', letterSpacing: '0.05em' }}>
          {vcfg.label}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace', color: 'text.primary' }}>
            {ev.layer}
          </Typography>
          {ev.agent_name && (
            <Typography sx={{ fontSize: '0.7rem', color: 'primary.main', fontWeight: 500 }}>
              {ev.agent_name}
            </Typography>
          )}
          {ev.threat_type && (
            <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
              {ev.threat_type.replace('_', ' ')}
            </Typography>
          )}
          {ev.pii_types && (
            <Typography sx={{ fontSize: '0.68rem', color: 'warning.main', fontWeight: 600 }}>
              {ev.pii_types}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.2 }}>
          <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled' }}>
            {ago(ev.created_at)}
          </Typography>
          {ev.threat_level && ev.threat_level !== 'low' && (
            <Box sx={{ bgcolor: ev.threat_level === 'critical' ? RED : YELLOW, color: '#fff', borderRadius: 0.5, px: 0.5 }}>
              <Typography sx={{ fontSize: '0.58rem', fontWeight: 700, lineHeight: '14px', textTransform: 'uppercase' }}>
                {ev.threat_level}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CommandCenter() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [agents, setAgents] = useState<AgentStat[]>([])
  const [layers, setLayers] = useState<SecurityLayer[]>([])
  const [events, setEvents] = useState<GuardrailEvent[]>([])
  const [tsData, setTsData] = useState<{
    calls: CallPoint[]; latency: LatencyPoint[]
    guardrails: GuardrailPoint[]; layer_dist: LayerDistPoint[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState(new Date())
  const [timeRange, setTimeRange] = useState<6 | 12 | 24>(24)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [ov, ag, ly, ev, ts] = await Promise.all([
        getJSON(`/command-center/overview?hours=${timeRange}`),
        getJSON(`/command-center/agents?hours=${timeRange}`),
        getJSON(`/command-center/layers?hours=${timeRange}`),
        getJSON('/command-center/events?limit=40'),
        getJSON(`/command-center/timeseries?hours=${timeRange}`),
      ])
      setOverview(ov); setAgents(ag.agents || [])
      setLayers(ly.layers || []); setEvents(ev.events || [])
      setTsData({ calls: ts.calls || [], latency: ts.latency || [], guardrails: ts.guardrails || [], layer_dist: ts.layer_dist || [] })
      setRefreshed(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally { setLoading(false) }
  }, [timeRange])

  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t) }, [load])

  const errorRate = overview
    ? overview.total_calls > 0 ? ((overview.failed_calls / overview.total_calls) * 100).toFixed(1) : '0.0'
    : '—'

  // Derive top-of-list layer events
  const topLayers = (tsData?.layer_dist || []).slice(0, 5)

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <Box sx={{ px: 3, pt: 2.5, pb: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ShieldOutlinedIcon sx={{ color: BLUE, fontSize: 22 }} />
          <Box>
            <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, lineHeight: 1.2 }}>Security Command Center</Typography>
            <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>
              10-layer guardrail posture · last updated {refreshed.toLocaleTimeString()}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <ToggleButtonGroup
            value={timeRange}
            exclusive
            size="small"
            onChange={(_, v) => v && setTimeRange(v)}
            sx={{ '& .MuiToggleButton-root': { px: 1.5, py: 0.3, fontSize: '0.72rem', fontWeight: 600, textTransform: 'none' } }}
          >
            <ToggleButton value={6}>6h</ToggleButton>
            <ToggleButton value={12}>12h</ToggleButton>
            <ToggleButton value={24}>24h</ToggleButton>
          </ToggleButtonGroup>
          <Tooltip title={loading ? 'Loading…' : 'Refresh now'}>
            <span>
              <IconButton size="small" onClick={load} disabled={loading} sx={{ color: BLUE }}>
                {loading ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ px: 3, pt: 2.5 }}>
        {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

        {/* ── KPI row ─────────────────────────────────────────────── */}
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="LLM Calls"
              value={fmt(overview?.total_calls ?? 0)}
              sub="requests"
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="Error Rate"
              value={`${errorRate}%`}
              sub={`${overview?.failed_calls ?? 0} failed`}
              accent={parseFloat(errorRate as string) > 5 ? RED : undefined}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="Avg Latency"
              value={fmtMs(overview?.avg_latency_ms ?? 0)}
              sub={`p95 ${fmtMs(overview?.p95_latency_ms ?? 0)}`}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="Guardrail Blocks"
              value={fmt(overview?.total_blocks ?? 0)}
              sub="threats stopped"
              accent={overview && overview.total_blocks > 0 ? RED : undefined}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="PII Redactions"
              value={fmt(overview?.pii_events ?? 0)}
              sub="data masked"
              accent={overview && overview.pii_events > 0 ? YELLOW : undefined}
            />
          </Grid>
          <Grid item xs={6} sm={4} md={2}>
            <KPICard
              label="Active Agents"
              value={overview?.active_agents ?? 0}
              sub="deployed"
              accent={GREEN}
            />
          </Grid>
        </Grid>

        {/* ── Row 2: Volume + Latency charts ─────────────────────── */}
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          {/* Request Volume */}
          <Grid item xs={12} md={7}>
            <Box sx={{ ...CARD, p: 2, pb: 1 }}>
              <SectionHeader title="Request Volume" sub="Calls and errors per hour" />
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={tsData?.calls ?? []} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradCalls" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={BLUE} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={BLUE} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradErrors" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={RED} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={RED} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                  <RechartTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Area type="monotone" dataKey="calls" name="Calls" stroke={BLUE} strokeWidth={2} fill="url(#gradCalls)" dot={false} activeDot={{ r: 4 }} />
                  <Area type="monotone" dataKey="errors" name="Errors" stroke={RED} strokeWidth={1.5} fill="url(#gradErrors)" dot={false} activeDot={{ r: 3 }} />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Grid>

          {/* Latency percentiles */}
          <Grid item xs={12} md={5}>
            <Box sx={{ ...CARD, p: 2, pb: 1 }}>
              <SectionHeader title="Latency Percentiles" sub="p50 / p95 / p99 (ms)" />
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={tsData?.latency ?? []} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={40} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}`} />
                  <RechartTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="p50" name="p50" stroke={GREEN} strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                  <Line type="monotone" dataKey="p95" name="p95" stroke={YELLOW} strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                  <Line type="monotone" dataKey="p99" name="p99" stroke={RED} strokeWidth={2} strokeDasharray="4 2" dot={false} activeDot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </Box>
          </Grid>
        </Grid>

        {/* ── Row 3: Guardrail chart + Security layers ─────────────── */}
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          {/* Guardrail events over time */}
          <Grid item xs={12} md={5}>
            <Box sx={{ ...CARD, p: 2, pb: 1 }}>
              <SectionHeader title="Guardrail Events" sub="Blocks and PII redactions per hour" />
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={tsData?.guardrails ?? []} style={CHART_STYLE} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={8}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" vertical={false} />
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                  <RechartTooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                  <Bar dataKey="blocks" name="Blocks" stackId="a" fill={RED} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="redactions" name="Redactions" stackId="a" fill={YELLOW} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Grid>

          {/* Layer distribution */}
          <Grid item xs={12} md={7}>
            <Box sx={{ ...CARD, p: 2, height: '100%' }}>
              <SectionHeader title="10-Layer Security Posture" sub="Active / idle status for each guardrail layer" />
              <Grid container spacing={0}>
                {layers.map(layer => (
                  <Grid item xs={12} sm={6} key={layer.layer_id}>
                    <LayerRow layer={layer} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          </Grid>
        </Grid>

        {/* ── Row 4: Per-agent table + events feed ─────────────────── */}
        <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
          {/* Agent table */}
          <Grid item xs={12} lg={8}>
            <Box sx={{ ...CARD }}>
              <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
                <SectionHeader title="Agent Health" sub={`${agents.length} agents · last ${timeRange}h`} />
              </Box>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& th': { fontSize: '0.68rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em', py: 0.75, borderBottom: '1.5px solid', borderColor: 'divider', bgcolor: 'action.hover' } }}>
                      <TableCell>Agent</TableCell>
                      <TableCell align="center">Health</TableCell>
                      <TableCell align="right">Calls</TableCell>
                      <TableCell align="right">Avg</TableCell>
                      <TableCell align="right">p95</TableCell>
                      <TableCell align="right">Error%</TableCell>
                      <TableCell align="right">Blocks</TableCell>
                      <TableCell align="right">PII</TableCell>
                      <TableCell sx={{ minWidth: 100 }}>Guard Rate</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {agents.length === 0 ? (
                      <TableRow><TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary', fontSize: '0.82rem' }}>No agents deployed</TableCell></TableRow>
                    ) : agents.map(a => {
                      const errPct = a.call_count > 0 ? ((a.error_count / a.call_count) * 100).toFixed(1) : '0.0'
                      const guardPct = a.call_count > 0 ? Math.round((a.guardrail_events / a.call_count) * 100) : 0
                      const isHealthy = a.status === 'deployed' && parseFloat(errPct) < 5
                      return (
                        <TableRow key={a.agent_name} hover sx={{ '&:last-child td': { border: 0 }, '& td': { py: 0.85 } }}>
                          <TableCell>
                            <Typography sx={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'monospace' }}>{a.agent_name}</Typography>
                          </TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.75, py: 0.15, borderRadius: 1, bgcolor: isHealthy ? 'rgba(52,168,83,0.12)' : a.status !== 'deployed' ? 'action.selected' : 'rgba(234,67,53,0.1)' }}>
                              <FiberManualRecordIcon sx={{ fontSize: 7, color: isHealthy ? GREEN : a.status !== 'deployed' ? GRAY : RED }} />
                              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: isHealthy ? GREEN : a.status !== 'deployed' ? GRAY : RED, lineHeight: 1 }}>
                                {isHealthy ? 'OK' : a.status !== 'deployed' ? a.status : 'WARN'}
                              </Typography>
                            </Box>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.82rem', fontWeight: 600 }}>{a.call_count.toLocaleString()}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>{fmtMs(a.avg_latency_ms)}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.8rem', color: a.p95_latency_ms > 5000 ? RED : 'text.secondary' }}>{fmtMs(a.p95_latency_ms)}</Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.8rem', color: parseFloat(errPct) > 5 ? RED : 'text.secondary', fontWeight: parseFloat(errPct) > 0 ? 600 : 400 }}>
                              {errPct}%
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.8rem', color: a.guardrail_blocks > 0 ? RED : 'text.secondary', fontWeight: a.guardrail_blocks > 0 ? 700 : 400 }}>
                              {a.guardrail_blocks > 0 ? a.guardrail_blocks : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell align="right">
                            <Typography sx={{ fontSize: '0.8rem', color: a.pii_redactions > 0 ? YELLOW : 'text.secondary', fontWeight: a.pii_redactions > 0 ? 600 : 400 }}>
                              {a.pii_redactions > 0 ? a.pii_redactions : '—'}
                            </Typography>
                          </TableCell>
                          <TableCell sx={{ minWidth: 100 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                              <Box sx={{ flex: 1, height: 4, bgcolor: 'action.selected', borderRadius: 2, overflow: 'hidden' }}>
                                <Box sx={{ width: `${Math.min(guardPct, 100)}%`, height: '100%', bgcolor: guardPct > 20 ? YELLOW : BLUE, borderRadius: 2, transition: 'width 0.4s ease' }} />
                              </Box>
                              <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary', minWidth: 28, textAlign: 'right' }}>{guardPct}%</Typography>
                            </Box>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </Grid>

          {/* Events feed */}
          <Grid item xs={12} lg={4}>
            <Box sx={{ ...CARD, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: '1px solid', borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <SectionHeader title="Live Events" />
                <Typography sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>last {events.length}</Typography>
              </Box>
              <Box sx={{ flex: 1, overflowY: 'auto', maxHeight: 420 }}>
                {events.length === 0 ? (
                  <Box sx={{ px: 2, py: 4 }}>
                    <Typography sx={{ fontSize: '0.82rem', color: 'text.secondary' }}>No events yet</Typography>
                  </Box>
                ) : events.map((ev, i) => (
                  <Box key={ev.id}>
                    {i > 0 && <Divider />}
                    <EventRow ev={ev} />
                  </Box>
                ))}
              </Box>
            </Box>
          </Grid>
        </Grid>

        {/* ── Row 5: Layer distribution bar (if data exists) ──────── */}
        {topLayers.length > 0 && (
          <Grid container spacing={1.5} sx={{ mb: 2.5 }}>
            <Grid item xs={12}>
              <Box sx={{ ...CARD, p: 2, pb: 1 }}>
                <SectionHeader title="Top Triggered Layers" sub="Guardrail layers with the most events this period" />
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={topLayers} layout="vertical" style={CHART_STYLE} margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barSize={14}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.12)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="layer" tick={{ fontSize: 10, fontFamily: 'monospace' }} width={140} tickLine={false} axisLine={false} />
                    <RechartTooltip content={<CustomTooltip />} />
                    <Bar dataKey="events" name="Events" radius={[0, 3, 3, 0]}>
                      {topLayers.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? RED : i === 1 ? YELLOW : BLUE} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Box>
            </Grid>
          </Grid>
        )}

        <Box sx={{ pb: 3 }} />
      </Box>
    </Box>
  )
}
