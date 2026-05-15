/**
 * Workflow Runs Page
 *
 * Netflix-Conductor-style view: DAG with run-state overlay per node.
 * Click any node to inspect its input and output.
 * Toggle to Timeline for the sequential step list.
 */
import 'reactflow/dist/style.css'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  type Node as FlowNode,
  type Edge as FlowEdge,
  Controls, Background, BackgroundVariant,
  type NodeProps, Handle, Position, MarkerType,
} from 'reactflow'
import dagre from 'dagre'
import yaml from 'js-yaml'
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
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import PauseCircleIcon from '@mui/icons-material/PauseCircle'
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import CloseIcon from '@mui/icons-material/Close'
import ViewModuleIcon from '@mui/icons-material/ViewModule'
import ListIcon from '@mui/icons-material/List'
import { workflowApi } from '../../api/workflow'
import type { RunRecord, SSEEvent, WorkflowNode, WorkflowSpec } from '../../types'

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
  node_input?: Record<string, unknown>
  node_output?: Record<string, unknown>
}

interface RunDetail {
  run_id: string
  workflow_name: string
  run_started_at: string | null
  steps: NodeStep[]
  raw_event_count: number
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

const NODE_ICON: Record<string, React.ReactNode> = {
  agent:      <SmartToyIcon sx={{ fontSize: 14 }} />,
  http:       <SettingsEthernetIcon sx={{ fontSize: 14 }} />,
  decision:   <Box component="span" sx={{ fontSize: 12 }}>◆</Box>,
  human_task: <PersonSearchIcon sx={{ fontSize: 14 }} />,
  trigger:    <PlayCircleOutlineIcon sx={{ fontSize: 14 }} />,
}

const NODE_COLOR: Record<string, string> = {
  agent: '#534AB7', http: '#185FA5', decision: '#854F0B', human_task: '#3B6D11', trigger: '#5F5E5A',
}

const STATUS_COLOR: Record<string, string> = {
  running: '#534AB7', completed: '#3B6D11', paused: '#854F0B', error: '#b91c1c',
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

function fmtDuration(ms: number | null) {
  if (ms == null) return null
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// ── Live SSE overlay ──────────────────────────────────────────────────────────

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
    <Box sx={{ p: 1, bgcolor: 'action.hover', borderRadius: 1, mb: 1 }}>
      <Typography variant="caption" fontWeight={600} display="block" sx={{ mb: 0.5 }}>Live events</Typography>
      {events.slice(-5).map((ev, i) => (
        <Typography key={i} variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ fontSize: '0.65rem' }}>
          {ev.event}{ev.node_id ? ` → ${ev.node_id}` : ''}{ev.reason ? ` (${ev.reason.slice(0, 40)})` : ''}
        </Typography>
      ))}
    </Box>
  )
}

// ── Node Inspector (click-to-inspect panel) ───────────────────────────────────

function NodeInspector({ step, onClose }: { step: NodeStep; onClose: () => void }) {
  const color = NODE_COLOR[step.node_type] || '#94a3b8'
  const hasInput = step.node_input && Object.keys(step.node_input).length > 0
  const hasOutput = step.node_output && Object.keys(step.node_output).length > 0

  return (
    <Box sx={{
      width: 320, flexShrink: 0, borderLeft: 1, borderColor: 'divider',
      display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ color, display: 'flex', alignItems: 'center' }}>{NODE_ICON[step.node_type]}</Box>
        <Typography variant="caption" fontFamily="monospace" fontWeight={700} sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {step.node_id}
        </Typography>
        <IconButton size="small" onClick={onClose}><CloseIcon sx={{ fontSize: 14 }} /></IconButton>
      </Box>

      {/* Meta chips */}
      <Box sx={{ px: 1.5, py: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', borderBottom: 1, borderColor: 'divider' }}>
        <Chip label={step.node_type} size="small" variant="outlined"
          sx={{ height: 18, fontSize: '0.6rem', color, borderColor: color }} />
        <RunStatusChip status={step.status} />
        {step.duration_ms != null && (
          <Chip label={fmtDuration(step.duration_ms)} size="small"
            sx={{ height: 18, fontSize: '0.6rem', bgcolor: 'action.hover' }} />
        )}
      </Box>

      {/* Actor */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ fontSize: '0.62rem' }}>
          actor: {step.actor_id || step.actor_type}
        </Typography>
        {step.output_hash && (
          <Typography variant="caption" color="text.secondary" fontFamily="monospace" display="block" sx={{ fontSize: '0.62rem' }}>
            hash: {step.output_hash.slice(0, 24)}
          </Typography>
        )}
      </Box>

      {/* Input / Output */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
        <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.6rem' }}>
          Input
        </Typography>
        <Box component="pre" sx={{
          m: 0, mb: 1.5, p: 1, bgcolor: 'rgba(0,0,0,0.03)', borderRadius: 1,
          fontSize: '0.62rem', fontFamily: 'monospace', overflow: 'auto',
          maxHeight: 180, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          border: '1px solid', borderColor: 'divider', color: 'text.primary',
        }}>
          {hasInput ? JSON.stringify(step.node_input, null, 2) : '{}'}
        </Box>

        <Typography variant="caption" fontWeight={700} sx={{ textTransform: 'uppercase', letterSpacing: '0.06em', color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.6rem' }}>
          Output
        </Typography>
        <Box component="pre" sx={{
          m: 0, p: 1, bgcolor: 'rgba(0,0,0,0.03)', borderRadius: 1,
          fontSize: '0.62rem', fontFamily: 'monospace', overflow: 'auto',
          maxHeight: 200, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          border: '1px solid', borderColor: step.status === 'error' ? '#fca5a5' : 'divider',
          color: step.status === 'error' ? '#b91c1c' : 'text.primary',
        }}>
          {step.status === 'running' || step.status === 'paused'
            ? 'pending…'
            : hasOutput
              ? JSON.stringify(step.node_output, null, 2)
              : '{}'}
        </Box>

        {step.status === 'paused' && (
          <Alert severity="warning" sx={{ mt: 1.5, fontSize: '0.7rem', py: 0.5 }}>
            Waiting for human decision
          </Alert>
        )}
      </Box>
    </Box>
  )
}

// ── DAG view — React Flow node components (read-only) ─────────────────────────

const DAG_W = 180
const DAG_H = 60

const DAG_FILL: Record<string, string> = {
  agent: '#EEEDFE', http: '#E6F1FB', decision: '#FAEEDA', human_task: '#EAF3DE', trigger: '#F1EFE8',
}
const DAG_STROKE: Record<string, string> = {
  agent: '#534AB7', http: '#185FA5', decision: '#854F0B', human_task: '#3B6D11', trigger: '#5F5E5A',
}

type DagData = WorkflowNode & { _runStatus?: string; _duration_ms?: number | null }

function DagBaseNode({ data, type, icon }: NodeProps<DagData> & { icon: React.ReactNode }) {
  const status = data._runStatus
  const baseStroke = DAG_STROKE[type] || '#94a3b8'
  const fill = DAG_FILL[type] || '#f8f9fa'
  const borderColor = status ? STATUS_COLOR[status] : baseStroke
  const borderWidth = status ? '2px' : '1.5px'
  const dur = data._duration_ms != null ? fmtDuration(data._duration_ms) : null

  return (
    <Paper variant="outlined" sx={{
      width: DAG_W, minHeight: DAG_H,
      border: `${borderWidth} solid ${borderColor}`,
      bgcolor: fill, borderRadius: 2, cursor: 'pointer',
      boxShadow: status === 'running' ? `0 0 0 3px ${borderColor}30` : 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s',
    }}>
      <Handle type="target" position={Position.Top}
        style={{ background: baseStroke, border: `2px solid ${baseStroke}`, width: 8, height: 8 }} />
      <Box sx={{ px: 1.5, py: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ color: baseStroke, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{icon}</Box>
          <Typography variant="caption" sx={{
            fontWeight: 600, color: baseStroke, flex: 1,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.7rem',
          }}>
            {data.label}
          </Typography>
          {status && (
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              bgcolor: STATUS_COLOR[status],
              ...(status === 'running' ? { animation: 'pulse 1.2s ease-in-out infinite' } : {}),
            }} />
          )}
        </Box>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: status ? STATUS_COLOR[status] : '#94a3b8', fontFamily: 'monospace' }}>
          {status ? (dur ? `${status} · ${dur}` : status) : 'pending'}
        </Typography>
      </Box>
      {type !== 'decision' && (
        <Handle type="source" position={Position.Bottom}
          style={{ background: baseStroke, border: `2px solid ${baseStroke}`, width: 8, height: 8 }} />
      )}
    </Paper>
  )
}

function DagAgentNode(props: NodeProps<DagData>) {
  return <DagBaseNode {...props} type="agent" icon={<AutoFixHighIcon sx={{ fontSize: 13 }} />} />
}
function DagHttpNode(props: NodeProps<DagData>) {
  return <DagBaseNode {...props} type="http" icon={<SettingsEthernetIcon sx={{ fontSize: 13 }} />} />
}
function DagHumanNode(props: NodeProps<DagData>) {
  return <DagBaseNode {...props} type="human_task" icon={<PersonSearchIcon sx={{ fontSize: 13 }} />} />
}
function DagTriggerNode(props: NodeProps<DagData>) {
  return <DagBaseNode {...props} type="trigger" icon={<PlayCircleOutlineIcon sx={{ fontSize: 13 }} />} />
}
function DagDecisionNode({ data }: NodeProps<DagData>) {
  const status = data._runStatus
  const baseStroke = DAG_STROKE.decision
  const borderColor = status ? STATUS_COLOR[status] : baseStroke
  const dur = data._duration_ms != null ? fmtDuration(data._duration_ms) : null

  return (
    <Paper variant="outlined" sx={{
      width: DAG_W, minHeight: DAG_H,
      border: `${status ? '2px' : '1.5px'} solid ${borderColor}`,
      bgcolor: DAG_FILL.decision, borderRadius: 2, cursor: 'pointer',
      transition: 'border-color 0.2s',
    }}>
      <Handle type="target" position={Position.Top}
        style={{ background: baseStroke, border: `2px solid ${baseStroke}`, width: 8, height: 8 }} />
      <Box sx={{ px: 1.5, py: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ color: baseStroke, fontSize: 12, flexShrink: 0 }}>◆</Box>
          <Typography variant="caption" sx={{ fontWeight: 600, color: baseStroke, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.7rem' }}>
            {data.label}
          </Typography>
          {status && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: STATUS_COLOR[status], flexShrink: 0 }} />}
        </Box>
        <Typography variant="caption" sx={{ fontSize: '0.6rem', color: status ? STATUS_COLOR[status] : '#94a3b8', fontFamily: 'monospace' }}>
          {status ? (dur ? `${status} · ${dur}` : status) : 'pending'}
        </Typography>
      </Box>
      <Handle id="true" type="source" position={Position.Bottom}
        style={{ left: '30%', background: '#3B6D11', border: '2px solid #3B6D11', width: 7, height: 7 }} />
      <Handle id="false" type="source" position={Position.Bottom}
        style={{ left: '70%', background: '#b91c1c', border: '2px solid #b91c1c', width: 7, height: 7 }} />
    </Paper>
  )
}

const DAG_NODE_TYPES = {
  agent: DagAgentNode,
  http: DagHttpNode,
  decision: DagDecisionNode,
  human_task: DagHumanNode,
  trigger: DagTriggerNode,
}

// ── DAG layout helpers ────────────────────────────────────────────────────────

function dagLayout(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 50, ranksep: 80 })
  nodes.forEach(n => g.setNode(n.id, { width: DAG_W + 20, height: DAG_H + 24 }))
  edges.forEach(e => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map(n => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - (DAG_W + 20) / 2, y: y - (DAG_H + 24) / 2 } }
  })
}

function buildRunEdges(wfNodes: WorkflowNode[]): FlowEdge[] {
  const edges: FlowEdge[] = []
  const base = { markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8' } }
  for (const n of wfNodes) {
    if (n.next) {
      edges.push({ id: `${n.id}→${n.next}`, source: n.id, target: n.next, ...base })
    }
    if (n.branches) {
      const [trueTarget, falseTarget] = [n.branches['true'], n.branches['false']]
      if (trueTarget) edges.push({
        id: `${n.id}→${trueTarget}@true`, source: n.id, sourceHandle: 'true', target: trueTarget,
        label: 'true', labelStyle: { fontSize: 10, fill: '#3B6D11' },
        style: { stroke: '#3B6D11' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#3B6D11' },
      })
      if (falseTarget) edges.push({
        id: `${n.id}→${falseTarget}@false`, source: n.id, sourceHandle: 'false', target: falseTarget,
        label: 'false', labelStyle: { fontSize: 10, fill: '#b91c1c' },
        style: { stroke: '#b91c1c' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#b91c1c' },
      })
      for (const [label, target] of Object.entries(n.branches)) {
        if (label === 'true' || label === 'false' || !target) continue
        edges.push({
          id: `${n.id}→${target}@${label}`, source: n.id, target,
          label, labelStyle: { fontSize: 10, fill: '#854F0B' },
          style: { stroke: '#854F0B' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#854F0B' },
        })
      }
    }
    if (n.fallback_node) {
      edges.push({
        id: `${n.id}→${n.fallback_node}@fb`, source: n.id, target: n.fallback_node,
        label: 'fallback', labelStyle: { fontSize: 9, fill: '#534AB7' },
        style: { stroke: '#534AB7', strokeDasharray: '4 3' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#534AB7' },
      })
    }
  }
  return edges
}

// ── DAG view component ────────────────────────────────────────────────────────

function RunDagView({ spec, steps, selectedNodeId, onNodeClick }: {
  spec: WorkflowSpec
  steps: NodeStep[]
  selectedNodeId: string | null
  onNodeClick: (nodeId: string) => void
}) {
  const stepMap = useMemo(() =>
    Object.fromEntries(steps.map(s => [s.node_id, s])), [steps])

  const { nodes, edges } = useMemo(() => {
    const wfNodes = spec.spec.nodes
    const edges = buildRunEdges(wfNodes)
    const savedLayout = spec.metadata.layout?.nodes ?? {}

    let rfNodes: FlowNode<DagData>[] = wfNodes.map(n => ({
      id: n.id,
      type: n.type,
      data: {
        ...n,
        _runStatus: stepMap[n.id]?.status,
        _duration_ms: stepMap[n.id]?.duration_ms ?? null,
      } as DagData,
      position: savedLayout[n.id] ?? { x: 0, y: 0 },
      selected: n.id === selectedNodeId,
    }))

    if (!Object.keys(savedLayout).length) {
      rfNodes = dagLayout(rfNodes, edges)
    }

    return { nodes: rfNodes, edges }
  }, [spec, steps, stepMap, selectedNodeId])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: FlowNode) => {
    onNodeClick(node.id)
  }, [onNodeClick])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={DAG_NODE_TYPES}
      onNodeClick={handleNodeClick}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesDraggable={false}
      nodesConnectable={false}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
    >
      <Controls showInteractive={false} />
      <Background variant={BackgroundVariant.Dots} gap={16} size={0.5} color="#cbd5e1" />
    </ReactFlow>
  )
}

// ── Run detail panel ──────────────────────────────────────────────────────────

type ViewMode = 'dag' | 'timeline'

function RunDetailPanel({
  wfName, runId, runStatus,
}: {
  wfName: string; runId: string; runStatus: string
}) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState<ViewMode>('dag')
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['run-nodes', wfName, runId],
    queryFn: () =>
      fetch(`http://localhost:8082/workflows/${wfName}/runs/${runId}/nodes`)
        .then(r => r.json()) as Promise<RunDetail>,
    refetchInterval: runStatus === 'running' ? 5000 : false,
    staleTime: runStatus === 'running' ? 0 : Infinity,
  })

  const { data: specData } = useQuery({
    queryKey: ['wf-spec', wfName],
    queryFn: () => workflowApi.getWorkflowSpec(wfName),
  })

  const spec = useMemo<WorkflowSpec | null>(() => {
    if (!specData?.yaml) return null
    try { return yaml.load(specData.yaml) as WorkflowSpec }
    catch { return null }
  }, [specData])

  const reRun = useMutation({
    mutationFn: (input: Record<string, unknown>) => workflowApi.startRun(wfName, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['wf-runs'] }),
  })

  const { data: runsData } = useQuery({
    queryKey: ['wf-runs', wfName],
    queryFn: () => workflowApi.listRuns(wfName),
  })
  const originalInput = runsData?.runs.find(r => r.run_id === runId)?.input as Record<string, unknown> | undefined

  const selectedStep = data?.steps.find(s => s.node_id === selectedNodeId) ?? null
  const wfNode = spec?.spec.nodes.find(n => n.id === selectedNodeId)

  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(prev => prev === nodeId ? null : nodeId)
  }, [])

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', flexShrink: 0 }}>
        <Typography variant="body2" fontFamily="monospace" fontWeight={600}>{runId.slice(-16)}</Typography>
        <RunStatusChip status={runStatus} />
        {data?.run_started_at && (
          <Typography variant="caption" color="text.secondary">{age(data.run_started_at)}</Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />

        {/* DAG / Timeline toggle */}
        <Box sx={{ display: 'flex', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          <Tooltip title="DAG view">
            <IconButton size="small"
              onClick={() => setViewMode('dag')}
              sx={{ borderRadius: 0, bgcolor: viewMode === 'dag' ? 'action.selected' : 'transparent', px: 1 }}>
              <ViewModuleIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Timeline view">
            <IconButton size="small"
              onClick={() => setViewMode('timeline')}
              sx={{ borderRadius: 0, bgcolor: viewMode === 'timeline' ? 'action.selected' : 'transparent', px: 1 }}>
              <ListIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>

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

      {reRun.isSuccess && <Alert severity="success" sx={{ mx: 2, mt: 1, flexShrink: 0 }}>New run started.</Alert>}
      {reRun.isError && <Alert severity="error" sx={{ mx: 2, mt: 1, flexShrink: 0 }}>Re-run failed.</Alert>}

      {/* Live events bar (running only) */}
      {runStatus === 'running' && (
        <Box sx={{ px: 2, pt: 1, flexShrink: 0 }}>
          <LiveEvents wfName={wfName} runId={runId} />
        </Box>
      )}

      {/* Main content area */}
      {isLoading ? (
        <Box sx={{ p: 2, flex: 1 }}>
          <Stack spacing={1}>
            {[0, 1, 2].map(i => <Skeleton key={i} variant="rectangular" height={64} sx={{ borderRadius: 1.5 }} />)}
          </Stack>
        </Box>
      ) : viewMode === 'dag' ? (
        /* ── DAG view ── */
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
          {spec ? (
            <>
              <Box sx={{ flex: 1, minWidth: 0, position: 'relative' }}>
                <RunDagView
                  spec={spec}
                  steps={data?.steps ?? []}
                  selectedNodeId={selectedNodeId}
                  onNodeClick={handleNodeClick}
                />
                {/* Legend */}
                <Box sx={{
                  position: 'absolute', bottom: 8, left: 8,
                  display: 'flex', gap: 1, flexWrap: 'wrap',
                  bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                  borderRadius: 1, px: 1, py: 0.5,
                }}>
                  {Object.entries(STATUS_COLOR).map(([s, c]) => (
                    <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: c }} />
                      <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>{s}</Typography>
                    </Box>
                  ))}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#94a3b8' }} />
                    <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.secondary' }}>pending</Typography>
                  </Box>
                </Box>
                {selectedNodeId && (
                  <Typography variant="caption" sx={{
                    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                    bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                    borderRadius: 1, px: 1, py: 0.25, color: 'text.secondary', fontSize: '0.62rem',
                  }}>
                    Click node again to deselect
                  </Typography>
                )}
              </Box>

              {/* Inspector panel */}
              {selectedStep && (
                <NodeInspector
                  step={selectedStep}
                  onClose={() => setSelectedNodeId(null)}
                />
              )}
            </>
          ) : (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 1 }}>
              <Typography variant="body2" color="text.secondary">Workflow spec not available</Typography>
              <Button size="small" onClick={() => setViewMode('timeline')}>Switch to Timeline</Button>
            </Box>
          )}
        </Box>
      ) : (
        /* ── Timeline view ── */
        <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
          {(!data?.steps || data.steps.length === 0) ? (
            <Box sx={{ py: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                {runStatus === 'running'
                  ? 'Run in progress — step data loads as nodes complete.'
                  : 'No step data found.'}
              </Typography>
            </Box>
          ) : (
            <Stack spacing={0.5}>
              {data.steps.map((step, idx) => (
                <Box key={step.node_id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 1.5 }}>
                    <StatusIcon status={step.status} />
                    {idx < data.steps.length - 1 && (
                      <Box sx={{ width: 1, bgcolor: 'divider', flex: 1, minHeight: 16, mt: 0.5 }} />
                    )}
                  </Box>
                  <Paper variant="outlined" onClick={() => { setSelectedNodeId(step.node_id); setViewMode('dag') }}
                    sx={{
                      flex: 1, p: 1.5, borderRadius: 1.5, mb: 0.25, cursor: 'pointer',
                      borderColor: step.status === 'paused' ? '#854F0B' : step.status === 'error' ? '#b91c1c' : 'divider',
                      bgcolor: step.status === 'paused' ? 'rgba(133,79,11,0.04)' : 'background.paper',
                      '&:hover': { bgcolor: 'action.hover' },
                    }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
                      <Box sx={{ color: NODE_COLOR[step.node_type] || '#94a3b8', display: 'flex', alignItems: 'center' }}>
                        {NODE_ICON[step.node_type] ?? <RadioButtonUncheckedIcon sx={{ fontSize: 14 }} />}
                      </Box>
                      <Typography variant="body2" fontFamily="monospace" fontWeight={600}>{step.node_id}</Typography>
                      <Chip label={step.node_type} size="small" variant="outlined"
                        sx={{ height: 16, fontSize: '0.6rem', color: NODE_COLOR[step.node_type], borderColor: NODE_COLOR[step.node_type] }} />
                      {step.duration_ms != null && (
                        <Typography variant="caption" color="text.secondary">{fmtDuration(step.duration_ms)}</Typography>
                      )}
                      <Box sx={{ flexGrow: 1 }} />
                      {step.result && step.result !== 'pending' && (
                        <Chip label={step.result} size="small"
                          sx={{ height: 14, fontSize: '0.58rem', bgcolor: step.result === 'ok' ? 'rgba(59,109,17,0.1)' : 'rgba(185,28,28,0.1)', color: step.result === 'ok' ? '#3B6D11' : '#b91c1c' }} />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>
                      actor: {step.actor_id || step.actor_type}
                    </Typography>
                    {step.status === 'paused' && (
                      <Box sx={{ mt: 1 }}>
                        <Button size="small" variant="contained" onClick={e => { e.stopPropagation(); navigate('/tasks') }}
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
      )}
    </Box>
  )
}

// ── Main Runs page ────────────────────────────────────────────────────────────

export default function WorkflowRuns() {
  const qc = useQueryClient()
  const [selectedRun, setSelectedRun] = useState<{ wfName: string; runId: string; status: string } | null>(null)

  const { data: wfData } = useQuery({ queryKey: ['workflows'], queryFn: workflowApi.listWorkflows })
  const workflows = wfData?.workflows ?? []

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
      <Box sx={{ width: 280, flexShrink: 0, borderRight: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
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
              <Box key={run.run_id} component="button"
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
          <Box sx={{ textAlign: 'center', maxWidth: 340 }}>
            <ViewModuleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" fontWeight={600} gutterBottom>Workflow Runs</Typography>
            <Typography variant="body2" color="text.secondary">
              Select a run to see a live DAG with step status, durations, and per-node input/output.
              Click any node to inspect its data.
            </Typography>
          </Box>
        </Box>
      )}
    </Box>
  )
}
