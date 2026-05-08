/**
 * Workflow Runs Page
 *
 * Shows all workflow invocations across all registered workflows.
 * For each run: step-by-step execution timeline from MinIO audit events.
 * Actions: re-run from beginning, navigate to paused task, view live SSE.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Divider,
  IconButton, Paper, Skeleton, Stack, Tooltip, Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import ReplayIcon from '@mui/icons-material/Replay'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet'
import PersonSearchIcon from '@mui/icons-material/PersonSearch'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import { workflowApi } from '../../api/workflow'
import type { RunRecord, SSEEvent } from '../../types'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NodeStep {
  node_id: string
  node_type: string
  actor_type: string
  actor_id: string
  started_at: string | null
  completed_at: string | null
  duration_ms: number | null
  result: string
  output_hash: string | null
  status: 'completed' | 'running' | 'paused' | 'error'
}

interface RunDetail {
  run_id: string
  workflow_name: string
  run_started_at: string | null
  steps: NodeStep[]
  raw_event_count: number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const NODE_ICON: Record<string, React.ReactNode> = {
  agent:      <SmartToyIcon sx={{ fontSize: 14 }} />,
  http:       <SettingsEthernetIcon sx={{ fontSize: 14 }} />,
  decision:   <Box component="span" sx={{ fontSize: 12 }}>◆</Box>,
  human_task: <PersonSearchIcon sx={{ fontSize: 14 }} />,
}

const NODE_COLOR: Record<string, string> = {
  agent: '#534AB7', http: '#185FA5', decision: '#854F0B', human_task: '#3B6D11',
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircleIcon sx={{ fontSize: 16, color: '#3B6D11' }} />
    case 'running':   return <CircularProgress size={14} sx={{ color: '#534AB7' }} />
    case 'paused':    return <PauseCircleIcon sx={{ fontSize: 16, color: '#854F0B' }} />
    case 'error':     return <ErrorIcon sx={{ fontSize: 16, color: '#b91c1c' }} />
    default:          return <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
  }
}

function RunStatusChip({ status }: { status: string }) {
  const colorMap: Record<string, 'success' | 'warning' | 'error' | 'primary' | 'default'> = {
    completed: 'success', paused: 'warning', failed: 'error', running: 'primary',
  }
  return (
    <Chip label={status} size="small"
      color={colorMap[status] ?? 'default'} variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
  )
}

function age(ts: string) {
  const ms = Date.now() - new Date(ts).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 60) return `${min}m ago`
  return `${Math.floor(min / 60)}h ${min % 60}m ago`
}

// ── Live SSE overlay for running runs ─────────────────────────────────────────

function LiveEvents({ wfName, runId }: { wfName: string; runId: string }) {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource(workflowApi.eventsUrl(wfName, runId))
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const ev: SSEEvent = JSON.parse(e.data)
        if (ev.event === 'keepalive') return
        setEvents(prev => [...prev.slice(-20), ev])
        if (ev.event === 'workflow_completed' || ev.event === 'workflow_failed') es.close()
      } catch { /* ignore */ }
    }
    es.onerror = () => es.close()
    return () => es.close()
  }, [wfName, runId])

  if (events.length === 0) return null
  return (
    <Box sx={{ mt: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
      <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>Live events</Typography>
      {events.slice(-5).map((ev, i) => (
        <Typography key={i} variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ fontSize: '0.65rem' }}>
          {ev.event} {ev.node_id ? `→ ${ev.node_id}` : ''} {ev.reason ? `(${ev.reason.slice(0, 40)})` : ''}
        </Typography>
      ))}
    </Box>
  )
}

// ── Run detail panel ──────────────────────────────────────────────────────────

function RunDetailPanel({
  wfName, runId, runStatus,
}: {
  wfName: string; runId: string; runStatus: string
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['run-nodes', wfName, runId],
    queryFn: () =>
      fetch(`http://localhost:8081/workflows/${wfName}/runs/${runId}/nodes`)
        .then(r => r.json()) as Promise<RunDetail>,
    refetchInterval: runStatus === 'running' ? 5000 : false,
    staleTime: runStatus === 'running' ? 0 : Infinity,
  })

  const reRun = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      workflowApi.startRun(wfName, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wf-runs'] }),
  })

  // Find original run input for re-run
  const { data: runsData } = useQuery({
    queryKey: ['wf-runs', wfName],
    queryFn: () => workflowApi.listRuns(wfName),
  })
  const runRecord = runsData?.runs.find(r => r.run_id === runId)
  const originalInput = runRecord?.input as Record<string, unknown> | undefined

  return (
    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2" fontFamily="monospace" fontWeight={600}>{runId}</Typography>
        <RunStatusChip status={runStatus} />
        {data?.run_started_at && (
          <Typography variant="caption" color="text.secondary">{age(data.run_started_at)}</Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Re-run with same input">
          <Button size="small" variant="outlined" startIcon={<ReplayIcon />}
            onClick={() => originalInput && reRun.mutate(originalInput)}
            disabled={!originalInput || reRun.isPending}>
            Re-run
          </Button>
        </Tooltip>
        <Tooltip title="View live SSE stream">
          <IconButton size="small" component="a" href={workflowApi.eventsUrl(wfName, runId)} target="_blank">
            <OpenInNewIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {reRun.isSuccess && <Alert severity="success" sx={{ mb: 1 }}>New run started.</Alert>}
      {reRun.isError && <Alert severity="error" sx={{ mb: 1 }}>Re-run failed.</Alert>}

      {/* Live events for running runs */}
      {runStatus === 'running' && <LiveEvents wfName={wfName} runId={runId} />}

      {/* Step timeline */}
      {isLoading && (
        <Stack spacing={1}>
          {[0, 1, 2].map(i => <Skeleton key={i} variant="rectangular" height={64} sx={{ borderRadius: 1.5 }} />)}
        </Stack>
      )}

      {!isLoading && (!data?.steps || data.steps.length === 0) && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {runStatus === 'running'
              ? 'Run in progress — step data loads as nodes complete.'
              : 'No step data found. Run may have used an older workflow-backend version.'}
          </Typography>
        </Box>
      )}

      {data?.steps && data.steps.length > 0 && (
        <Stack spacing={0.5}>
          {data.steps.map((step, idx) => (
            <Box key={step.node_id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
              {/* Connector */}
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5 }}>
                <StatusIcon status={step.status} />
                {idx < data.steps.length - 1 && (
                  <Box sx={{ width: 1, bgcolor: 'divider', flex: 1, minHeight: 16, mt: 0.5 }} />
                )}
              </Box>
              {/* Step card */}
              <Paper variant="outlined" sx={{
                flex: 1, p: 1.5, borderRadius: 1.5, mb: 0.25,
                borderColor: step.status === 'paused' ? '#854F0B' : step.status === 'error' ? '#b91c1c' : 'divider',
                bgcolor: step.status === 'paused' ? 'rgba(133,79,11,0.04)' : 'background.paper',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                  <Box sx={{ color: NODE_COLOR[step.node_type] || '#94a3b8', display: 'flex', alignItems: 'center' }}>
                    {NODE_ICON[step.node_type] ?? <RadioButtonUncheckedIcon sx={{ fontSize: 14 }} />}
                  </Box>
                  <Typography variant="body2" fontFamily="monospace" fontWeight={600}>{step.node_id}</Typography>
                  <Chip label={step.node_type} size="small" variant="outlined"
                    sx={{ height: 16, fontSize: '0.6rem', color: NODE_COLOR[step.node_type], borderColor: NODE_COLOR[step.node_type] }} />
                  {step.duration_ms != null && (
                    <Typography variant="caption" color="text.secondary">
                      {step.duration_ms < 1000 ? `${step.duration_ms}ms` : `${(step.duration_ms / 1000).toFixed(1)}s`}
                    </Typography>
                  )}
                  <Box sx={{ flexGrow: 1 }} />
                  {step.result && step.result !== 'pending' && (
                    <Chip label={step.result} size="small"
                      sx={{ height: 14, fontSize: '0.58rem', bgcolor: step.result === 'ok' ? 'rgba(59,109,17,0.1)' : 'rgba(185,28,28,0.1)', color: step.result === 'ok' ? '#3B6D11' : '#b91c1c' }} />
                  )}
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
                  actor: {step.actor_id || step.actor_type}
                  {step.output_hash ? ` · ${step.output_hash.slice(0, 20)}` : ''}
                </Typography>

                {/* Paused task action */}
                {step.status === 'paused' && (
                  <Box sx={{ mt: 1 }}>
                    <Button size="small" variant="contained" onClick={() => navigate('/tasks')}
                      sx={{ bgcolor: '#854F0B', '&:hover': { bgcolor: '#6b3f09' } }}>
                      Go to Human Tasks →
                    </Button>
                  </Box>
                )}
              </Paper>
            </Box>
          ))}
        </Stack>
      )}

      {data && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1, textAlign: 'right' }}>
          {data.raw_event_count} audit events in MinIO
        </Typography>
      )}
    </Box>
  )
}

// ── Main Runs page ────────────────────────────────────────────────────────────

export default function WorkflowRuns() {
  const qc = useQueryClient()
  const [selectedRun, setSelectedRun] = useState<{ wfName: string; runId: string; status: string } | null>(null)

  // Fetch all workflows then all runs for each
  const { data: wfData } = useQuery({ queryKey: ['workflows'], queryFn: workflowApi.listWorkflows })
  const workflows = wfData?.workflows ?? []

  // Build a flat list of all runs with re-fetch
  const [allRuns, setAllRuns] = useState<{ wfName: string; run: RunRecord }[]>([])
  const [runsLoading, setRunsLoading] = useState(false)

  const fetchAllRuns = useCallback(async () => {
    if (workflows.length === 0) return
    setRunsLoading(true)
    try {
      const results = await Promise.all(
        workflows.map(async (wf) => {
          try {
            const d = await workflowApi.listRuns(wf.name)
            return (d.runs ?? []).map(r => ({ wfName: wf.name, run: r }))
          } catch { return [] }
        })
      )
      setAllRuns(results.flat().sort((a, b) =>
        new Date(b.run.started_at).getTime() - new Date(a.run.started_at).getTime()
      ))
    } finally {
      setRunsLoading(false)
    }
  }, [workflows])

  useEffect(() => { fetchAllRuns() }, [fetchAllRuns])

  return (
    <Box sx={{ display: 'flex', height: '100%' }}>
      {/* Left: run list */}
      <Box sx={{ width: 300, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" fontWeight={700} sx={{ flex: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Workflow Runs
          </Typography>
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => { fetchAllRuns(); qc.invalidateQueries({ queryKey: ['wf-runs'] }) }}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {runsLoading && <Box sx={{ p: 2 }}><CircularProgress size={18} /></Box>}

        {!runsLoading && allRuns.length === 0 && (
          <Box sx={{ p: 2 }}>
            <Typography variant="caption" color="text.secondary">No workflow runs yet. Start a run from the Composer.</Typography>
          </Box>
        )}

        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          {allRuns.map(({ wfName, run }) => {
            const isSelected = selectedRun?.runId === run.run_id
            return (
              <Box
                key={run.run_id}
                component="button"
                onClick={() => setSelectedRun({ wfName, runId: run.run_id, status: run.status })}
                sx={{
                  display: 'flex', flexDirection: 'column', width: '100%', textAlign: 'left',
                  px: 2, py: 1.25, background: 'none', border: 'none', cursor: 'pointer',
                  borderBottom: 1, borderColor: 'divider',
                  bgcolor: isSelected ? 'primary.main' : 'transparent',
                  color: isSelected ? 'primary.contrastText' : 'text.primary',
                  '&:hover': { bgcolor: isSelected ? 'primary.main' : 'action.hover' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
                  <AccountTreeIcon sx={{ fontSize: 13, flexShrink: 0, opacity: 0.7 }} />
                  <Typography variant="caption" fontFamily="monospace" fontWeight={600} noWrap sx={{ flex: 1 }}>
                    {wfName}
                  </Typography>
                  <RunStatusChip status={run.status} />
                </Box>
                <Typography variant="caption" fontFamily="monospace" color={isSelected ? 'primary.contrastText' : 'text.secondary'} sx={{ fontSize: '0.62rem', opacity: 0.8 }}>
                  {run.run_id.slice(-12)} · {age(run.started_at)}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Box>

      {/* Right: run detail */}
      {selectedRun ? (
        <RunDetailPanel wfName={selectedRun.wfName} runId={selectedRun.runId} runStatus={selectedRun.status} />
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Box sx={{ textAlign: 'center', maxWidth: 320 }}>
            <AccountTreeIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>Workflow Runs</Typography>
            <Typography variant="body2" color="text.secondary">
              Select a run from the left to see its step-by-step execution timeline, actor identities, durations, and re-run actions.
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}
