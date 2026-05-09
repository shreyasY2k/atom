import 'reactflow/dist/style.css'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import ReactFlow, {
  Node, Edge, Controls, Background, BackgroundVariant,
  useNodesState, useEdgesState, NodeProps, Handle, Position,
  MarkerType, ReactFlowInstance, Connection, addEdge,
} from 'reactflow'
import dagre from 'dagre'
import yaml from 'js-yaml'
import {
  Box, Button, Chip, CircularProgress, Divider, Drawer, FormControl,
  IconButton, InputLabel, Menu, MenuItem, Modal, Paper, Select,
  TextField, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip,
  Typography,
} from '@mui/material'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import CloseIcon from '@mui/icons-material/Close'
import SaveIcon from '@mui/icons-material/Save'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import SettingsEthernetIcon from '@mui/icons-material/SettingsEthernet'
import HistoryToggleOffIcon from '@mui/icons-material/HistoryToggleOff'
import PersonSearchIcon from '@mui/icons-material/PersonSearch'
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import { builderApi } from '../../api/builder'
import { workflowApi } from '../../api/workflow'
import type { NodeState, RunRecord, SSEEvent, WorkflowNode, WorkflowSpec } from '../../types'

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 200
const NODE_H = 72
const APPBAR_H = 64
const TOOLBAR_H = 48
const INSPECTOR_W = 280
const PALETTE_W = 156
const RUN_PANE_H = 280

// Light-theme fills per task spec
const NODE_FILL: Record<string, string> = {
  trigger:    '#F1EFE8',
  agent:      '#EEEDFE',
  http:       '#E6F1FB',
  decision:   '#FAEEDA',
  human_task: '#EAF3DE',
}
const NODE_STROKE: Record<string, string> = {
  trigger:    '#5F5E5A',
  agent:      '#534AB7',
  http:       '#185FA5',
  decision:   '#854F0B',
  human_task: '#3B6D11',
}

const STATE_BORDER: Record<NodeState, string> = {
  running:   '2px solid #534AB7',
  completed: '2px solid #3B6D11',
  paused:    '2px solid #854F0B',
  error:     '2px solid #ef4444',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function applyDagre(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 90 })
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W + 20, height: NODE_H + 20 }))
  edges.forEach((e) => g.setEdge(e.source, e.target))
  dagre.layout(g)
  return nodes.map((n) => {
    const { x, y } = g.node(n.id)
    return { ...n, position: { x: x - (NODE_W + 20) / 2, y: y - (NODE_H + 20) / 2 } }
  })
}

function deriveEdges(wfNodes: WorkflowNode[]): Edge[] {
  const edges: Edge[] = []
  const base = { markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' }, style: { stroke: '#94a3b8' } }
  for (const n of wfNodes) {
    if (n.next) {
      edges.push({ id: `${n.id}→${n.next}`, source: n.id, target: n.next, ...base })
    }
    if (n.branches) {
      for (const [label, target] of Object.entries(n.branches)) {
        if (target) {
          edges.push({
            id: `${n.id}→${target}@${label}`,
            source: n.id,
            sourceHandle: label,
            target,
            label,
            labelStyle: { fontSize: 10, fill: '#854F0B' },
            ...base,
            style: { stroke: '#854F0B' },
            markerEnd: { type: MarkerType.ArrowClosed, color: '#854F0B' },
          })
        }
      }
    }
    if (n.fallback_node) {
      edges.push({
        id: `${n.id}→${n.fallback_node}@fallback`,
        source: n.id,
        target: n.fallback_node,
        label: 'fallback',
        style: { stroke: '#534AB7', strokeDasharray: '4 3' },
        labelStyle: { fontSize: 9, fill: '#534AB7' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#534AB7' },
      })
    }
  }
  return edges
}

function specToFlow(
  spec: WorkflowSpec,
  layout?: Record<string, { x: number; y: number }>,
): { nodes: Node[]; edges: Edge[] } {
  const wfNodes = spec.spec.nodes
  const edges = deriveEdges(wfNodes)
  const savedLayout = layout ?? spec.metadata.layout?.nodes ?? {}

  let nodes: Node[] = wfNodes.map((n) => ({
    id: n.id,
    type: n.type,
    data: { ...n },
    position: savedLayout[n.id] ?? { x: 0, y: 0 },
  }))

  const hasLayout = Object.keys(savedLayout).length > 0
  if (!hasLayout) {
    nodes = applyDagre(nodes, edges)
  }

  return { nodes, edges }
}

function serializeSpec(spec: WorkflowSpec, positions: Record<string, { x: number; y: number }>): string {
  const raw: Record<string, unknown> = {
    apiVersion: spec.apiVersion,
    kind: spec.kind,
    metadata: {
      name: spec.metadata.name,
      domain: spec.metadata.domain,
      version: spec.metadata.version,
      description: spec.metadata.description,
      owner: spec.metadata.owner,
      ...(Object.keys(positions).length ? { layout: { nodes: positions } } : {}),
      ...(spec.metadata.sample_inputs?.length ? { sample_inputs: spec.metadata.sample_inputs } : {}),
    },
    spec: {
      input_schema: spec.spec.input_schema,
      nodes: spec.spec.nodes.map((n) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { _nodeState, _outputSummary, _serviceAccountId, ...clean } = n as any
        void _nodeState; void _outputSummary; void _serviceAccountId
        return Object.fromEntries(Object.entries(clean).filter(([, v]) => v !== null && v !== undefined))
      }),
      audit: spec.spec.audit,
      deployment: spec.spec.deployment,
    },
  }
  return yaml.dump(raw, { lineWidth: 120, indent: 2 })
}

// ── Custom node components ────────────────────────────────────────────────────

function NodeErrorBadge({ msg }: { msg?: string }) {
  if (!msg) return null
  return (
    <Box sx={{
      position: 'absolute', top: -20, left: 0, right: 0,
      bgcolor: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 0.5,
      px: 0.5, py: 0.25, display: 'flex', alignItems: 'center', gap: 0.5,
    }}>
      <Typography sx={{ fontSize: '0.6rem', color: '#b91c1c', lineHeight: 1.3 }}>✗ {msg}</Typography>
    </Box>
  )
}

function BaseNode({
  data, type, icon, children, selected,
}: {
  data: WorkflowNode & { _nodeState?: NodeState; _errorMsg?: string; _outputSummary?: Record<string, unknown> }
  type: string
  icon: React.ReactNode
  children?: React.ReactNode
  selected?: boolean
}) {
  const state = data._nodeState
  const fill = NODE_FILL[type] || '#f8f9fa'
  const stroke = NODE_STROKE[type] || '#94a3b8'
  return (
    <Box sx={{ position: 'relative' }}>
      <NodeErrorBadge msg={data._errorMsg} />
      <Paper
        variant="outlined"
        className={state === 'running' ? 'node-running' : ''}
        sx={{
          width: NODE_W,
          minHeight: NODE_H,
          border: state ? STATE_BORDER[state] : `1.5px solid ${stroke}`,
          bgcolor: fill,
          borderRadius: 2,
          outline: selected ? `2px solid ${stroke}` : 'none',
          outlineOffset: 2,
          transition: 'border-color 0.2s, outline 0.1s',
        }}
      >
        <Handle type="target" position={Position.Top} style={{ background: stroke, border: `2px solid ${stroke}`, width: 8, height: 8 }} />
        <Box sx={{ px: 1.5, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            {icon}
            <Typography variant="caption" sx={{ color: NODE_STROKE[type] || '#333', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.label}
            </Typography>
            {state && (
              <Chip
                label={state}
                size="small"
                color={state === 'completed' ? 'success' : state === 'paused' ? 'warning' : state === 'error' ? 'error' : 'primary'}
                sx={{ height: 16, fontSize: '0.6rem', ml: 'auto', flexShrink: 0 }}
              />
            )}
          </Box>
          {children}
          {state === 'completed' && data._outputSummary && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontSize: '0.6rem', color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {Object.entries(data._outputSummary).map(([k, v]) => `${k}:${v}`).join(' · ')}
            </Typography>
          )}
        </Box>
        {type !== 'decision'
          ? <Handle type="source" position={Position.Bottom} style={{ background: stroke, border: `2px solid ${stroke}`, width: 8, height: 8 }} />
          : null}
      </Paper>
    </Box>
  )
}

function TriggerNode({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <BaseNode data={data} type="trigger" icon={<PlayCircleOutlineIcon sx={{ fontSize: 14, color: NODE_STROKE.trigger }} />} selected={selected}>
      <Typography variant="caption" sx={{ fontSize: '0.65rem', color: NODE_STROKE.trigger }}>entry point</Typography>
    </BaseNode>
  )
}

function AgentNode({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <BaseNode data={data} type="agent" icon={<AutoFixHighIcon sx={{ fontSize: 14, color: NODE_STROKE.agent }} />} selected={selected}>
      {data.agent_ref && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip label={data.agent_ref.name} size="small" sx={{ height: 16, fontSize: '0.65rem', bgcolor: 'rgba(83,74,183,0.1)', color: NODE_STROKE.agent, fontFamily: 'monospace' }} />
          {data.confidence_threshold != null && (
            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#64748b' }}>≥{data.confidence_threshold}</Typography>
          )}
        </Box>
      )}
    </BaseNode>
  )
}

function HttpNode({ data, selected }: NodeProps<WorkflowNode>) {
  const host = data.url_template?.replace(/^https?:\/\//, '').split('/')[0] ?? ''
  return (
    <BaseNode data={data} type="http" icon={<SettingsEthernetIcon sx={{ fontSize: 14, color: NODE_STROKE.http }} />} selected={selected}>
      {data.method && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Chip label={data.method} size="small" sx={{ height: 14, fontSize: '0.6rem', bgcolor: 'rgba(24,95,165,0.1)', color: NODE_STROKE.http }} />
          <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis' }}>{host}</Typography>
        </Box>
      )}
    </BaseNode>
  )
}

function DecisionNode({ data, selected }: NodeProps<WorkflowNode>) {
  const fill = NODE_FILL.decision
  const stroke = NODE_STROKE.decision
  const state = (data as WorkflowNode & { _nodeState?: NodeState })._nodeState
  const errMsg = (data as WorkflowNode & { _errorMsg?: string })._errorMsg
  return (
    <Box sx={{ position: 'relative' }}>
      <NodeErrorBadge msg={errMsg} />
      <Paper
        variant="outlined"
        className={state === 'running' ? 'node-running' : ''}
        sx={{
          width: NODE_W,
          minHeight: NODE_H,
          border: state ? STATE_BORDER[state] : `1.5px solid ${stroke}`,
          bgcolor: fill,
          borderRadius: 2,
          outline: selected ? `2px solid ${stroke}` : 'none',
          outlineOffset: 2,
        }}
      >
        <Handle type="target" position={Position.Top} style={{ background: stroke, border: `2px solid ${stroke}`, width: 8, height: 8 }} />
        <Box sx={{ px: 1.5, py: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box component="span" sx={{ fontSize: 13, color: stroke }}>◆</Box>
            <Typography variant="caption" sx={{ color: stroke, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.label}
            </Typography>
          </Box>
          {data.expression && (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, fontSize: '0.65rem', color: stroke, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {data.expression}
            </Typography>
          )}
        </Box>
        {/* Two labeled output handles */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="true"
          style={{ left: '30%', background: '#3B6D11', border: '2px solid #3B6D11', width: 8, height: 8 }}
        />
        <Box sx={{ position: 'absolute', bottom: -18, left: '22%', fontSize: '0.6rem', color: '#3B6D11', fontWeight: 600, pointerEvents: 'none' }}>T</Box>
        <Handle
          type="source"
          position={Position.Bottom}
          id="false"
          style={{ left: '70%', background: '#b91c1c', border: '2px solid #b91c1c', width: 8, height: 8 }}
        />
        <Box sx={{ position: 'absolute', bottom: -18, left: '65%', fontSize: '0.6rem', color: '#b91c1c', fontWeight: 600, pointerEvents: 'none' }}>F</Box>
      </Paper>
    </Box>
  )
}

function HumanTaskNode({ data, selected }: NodeProps<WorkflowNode>) {
  return (
    <BaseNode data={data} type="human_task" icon={<PersonSearchIcon sx={{ fontSize: 14, color: NODE_STROKE.human_task }} />} selected={selected}>
      {data.assignee_group && (
        <Box sx={{ mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'center' }}>
          <Chip label={data.assignee_group} size="small" sx={{ height: 14, fontSize: '0.6rem', bgcolor: 'rgba(59,109,17,0.1)', color: NODE_STROKE.human_task }} />
          {data.sla_seconds != null && (
            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#64748b' }}>SLA {data.sla_seconds / 3600}h</Typography>
          )}
        </Box>
      )}
    </BaseNode>
  )
}

const NODE_TYPES = {
  trigger: TriggerNode,
  agent: AgentNode,
  http: HttpNode,
  decision: DecisionNode,
  human_task: HumanTaskNode,
}

// ── Palette ───────────────────────────────────────────────────────────────────

const PALETTE_ITEMS = [
  { type: 'trigger', label: 'Trigger', icon: <PlayCircleOutlineIcon sx={{ fontSize: 16 }} />, color: NODE_STROKE.trigger },
  { type: 'agent', label: 'Agent', icon: <AutoFixHighIcon sx={{ fontSize: 16 }} />, color: NODE_STROKE.agent },
  { type: 'http', label: 'HTTP', icon: <SettingsEthernetIcon sx={{ fontSize: 16 }} />, color: NODE_STROKE.http },
  { type: 'decision', label: 'Decision', icon: <Box component="span" sx={{ fontSize: 14 }}>◆</Box>, color: NODE_STROKE.decision },
  { type: 'human_task', label: 'Human task', icon: <PersonSearchIcon sx={{ fontSize: 16 }} />, color: NODE_STROKE.human_task },
] as const

function Palette() {
  const onDragStart = (e: React.DragEvent, type: string) => {
    e.dataTransfer.setData('application/mphasis-nodetype', type)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <Box sx={{
      width: PALETTE_W,
      flexShrink: 0,
      borderRight: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
    }}>
      <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Palette
        </Typography>
      </Box>
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {PALETTE_ITEMS.map((item) => (
          <Paper
            key={item.type}
            variant="outlined"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            sx={{
              px: 1.25,
              py: 0.875,
              cursor: 'grab',
              border: `1.5px solid`,
              borderColor: item.color,
              bgcolor: NODE_FILL[item.type],
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              userSelect: 'none',
              '&:active': { cursor: 'grabbing' },
              '&:hover': { opacity: 0.85 },
            }}
          >
            <Box sx={{ color: item.color, display: 'flex', alignItems: 'center' }}>{item.icon}</Box>
            <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500, color: item.color }}>
              {item.label}
            </Typography>
          </Paper>
        ))}
      </Box>
      <Box sx={{ px: 1.5, py: 1, mt: 'auto', borderTop: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1.4 }}>
          Drag a node type onto the canvas to add it.
        </Typography>
      </Box>
    </Box>
  )
}

// ── Key-Value editor ──────────────────────────────────────────────────────────

function KVEditor({
  label, value, onChange,
}: {
  label: string
  value: Record<string, string>
  onChange: (v: Record<string, string>) => void
}) {
  const entries = Object.entries(value)
  const setEntry = (i: number, k: string, v: string) => {
    const next = [...entries]
    next[i] = [k, v]
    onChange(Object.fromEntries(next))
  }
  const remove = (i: number) => {
    const next = entries.filter((_, j) => j !== i)
    onChange(Object.fromEntries(next))
  }
  const add = () => onChange({ ...value, '': '' })

  return (
    <Box>
      <Typography variant="caption" color="text.secondary" display="block" gutterBottom>{label}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {entries.map(([k, v], i) => (
          <Box key={i} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder="key"
              value={k}
              onChange={(e) => setEntry(i, e.target.value, v)}
              sx={{ flex: 1 }}
              inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace', padding: '4px 8px' } }}
            />
            <TextField
              size="small"
              placeholder="value"
              value={v}
              onChange={(e) => setEntry(i, k, e.target.value)}
              sx={{ flex: 1.5 }}
              inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace', padding: '4px 8px' } }}
            />
            <IconButton size="small" onClick={() => remove(i)} sx={{ flexShrink: 0 }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Box>
        ))}
        <Button size="small" variant="text" onClick={add} sx={{ alignSelf: 'flex-start', fontSize: '0.7rem', px: 0.5 }}>
          + Add
        </Button>
      </Box>
    </Box>
  )
}

// ── Inspector ─────────────────────────────────────────────────────────────────

const ASSIGNEE_GROUPS = ['ops', 'compliance', 'risk-management', 'audit', 'risk', 'legal']
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
const AUTH_TYPES = ['bearer', 'basic', 'api_key'] as const
const PRIORITY_LEVELS = ['low', 'medium', 'high', 'critical'] as const
const ESCALATION_ACTIONS = ['auto_approve', 'auto_reject', 'escalate'] as const
const BACKOFF_TYPES = ['exponential', 'linear', 'constant'] as const

function Inspector({
  node,
  agents,
  nodeIds,
  onUpdate,
  onReplaceWithAgent,
}: {
  node: WorkflowNode | null
  agents: { name: string; service_account_id: string; status: string; tools?: string[]; reasoning_mode?: string }[]
  nodeIds: string[]
  onUpdate: (nodeId: string, changes: Partial<WorkflowNode>) => void
  onReplaceWithAgent: (nodeId: string, agentName: string, svcId: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  useEffect(() => { setShowPicker(false) }, [node?.id])

  if (!node) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Typography variant="caption" color="text.secondary" textAlign="center">
          Click a node to inspect and configure it.
        </Typography>
      </Box>
    )
  }

  const up = (changes: Partial<WorkflowNode>) => onUpdate(node.id, changes)
  const selectedAgent = agents.find((a) => a.name === node.agent_ref?.name)
  const tools = selectedAgent?.tools ?? []
  const canReplace = node.type === 'human_task' || node.type === 'http'

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <Typography variant="caption" color="text.secondary" fontWeight={700}
      sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', mt: 0.5 }}>
      {children}
    </Typography>
  )

  return (
    <Box sx={{ p: 1.5, overflowY: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 1.25 }}>

      {/* ── Identity ── */}
      <Box>
        <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Label</Typography>
        <TextField size="small" fullWidth value={node.label}
          onChange={(e) => up({ label: e.target.value })}
          inputProps={{ style: { fontSize: '0.8rem', fontWeight: 600 } }} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">Type:</Typography>
        <Chip label={node.type} size="small" sx={{ fontFamily: 'monospace',
          color: NODE_STROKE[node.type] || '#94a3b8', bgcolor: NODE_FILL[node.type] || '#f8f9fa',
          border: `1px solid ${NODE_STROKE[node.type] || '#94a3b8'}` }} />
      </Box>
      <TextField size="small" label="Description" fullWidth multiline maxRows={2}
        value={node.description ?? ''}
        onChange={(e) => up({ description: e.target.value })}
        inputProps={{ style: { fontSize: '0.78rem' } }} />

      <Divider />

      {/* ── Common: routing & execution ── */}
      <SectionLabel>Routing &amp; Error handling</SectionLabel>
      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: '0.8rem' }}>On error → node</InputLabel>
        <Select label="On error → node" value={node.on_error ?? ''}
          onChange={(e) => up({ on_error: e.target.value || undefined })} sx={{ fontSize: '0.8rem' }}>
          <MenuItem value="" sx={{ fontSize: '0.8rem' }}><em>None (fail workflow)</em></MenuItem>
          {nodeIds.filter((id) => id !== node.id).map((id) => (
            <MenuItem key={id} value={id} sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{id}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField size="small" label="Timeout (seconds)" type="number" fullWidth
        value={node.timeout_seconds ?? 300}
        onChange={(e) => up({ timeout_seconds: parseInt(e.target.value, 10) })}
        inputProps={{ min: 1, style: { fontSize: '0.8rem' } }} />

      {/* Retry — shown for agent + http */}
      {(node.type === 'agent' || node.type === 'http') && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField size="small" label="Retry attempts" type="number"
            value={node.retry?.max_attempts ?? ''}
            onChange={(e) => up({ retry: { ...node.retry, max_attempts: parseInt(e.target.value, 10) || 1, backoff: node.retry?.backoff ?? 'exponential' } })}
            inputProps={{ min: 1, max: 10, style: { fontSize: '0.8rem' } }} sx={{ flex: 1 }} />
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Backoff</InputLabel>
            <Select label="Backoff" value={node.retry?.backoff ?? 'exponential'}
              onChange={(e) => up({ retry: { ...node.retry, max_attempts: node.retry?.max_attempts ?? 1, backoff: e.target.value as 'exponential' | 'linear' | 'constant' } })}
              sx={{ fontSize: '0.8rem' }}>
              {BACKOFF_TYPES.map((b) => <MenuItem key={b} value={b} sx={{ fontSize: '0.8rem' }}>{b}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      )}

      <Divider />

      {/* ── Agent fields ── */}
      {node.type === 'agent' && (<>
        <SectionLabel>Agent</SectionLabel>
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ fontSize: '0.8rem' }}>Agent</InputLabel>
          <Select label="Agent" value={node.agent_ref?.name ?? ''}
            onChange={(e) => up({ agent_ref: { name: e.target.value, version: node.agent_ref?.version ?? 'latest' } })}
            sx={{ fontSize: '0.8rem' }}>
            {agents.map((a) => (
              <MenuItem key={a.name} value={a.name} sx={{ fontSize: '0.8rem' }}>
                <Box>
                  <Typography variant="body2" fontFamily="monospace">{a.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{a.status}</Typography>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField size="small" label="Version" fullWidth value={node.agent_ref?.version ?? 'latest'}
          onChange={(e) => up({ agent_ref: { name: node.agent_ref?.name ?? '', version: e.target.value } })}
          inputProps={{ style: { fontSize: '0.8rem' } }} />

        <SectionLabel>Confidence routing</SectionLabel>
        <TextField size="small" label="Confidence threshold (0–1)" type="number" fullWidth
          value={node.confidence_threshold ?? ''}
          onChange={(e) => up({ confidence_threshold: e.target.value === '' ? undefined : parseFloat(e.target.value) })}
          inputProps={{ min: 0, max: 1, step: 0.05, style: { fontSize: '0.8rem' } }} />
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ fontSize: '0.8rem' }}>Fallback node (low confidence)</InputLabel>
          <Select label="Fallback node (low confidence)" value={node.fallback_node ?? ''}
            onChange={(e) => up({ fallback_node: e.target.value || undefined })} sx={{ fontSize: '0.8rem' }}>
            <MenuItem value="" sx={{ fontSize: '0.8rem' }}><em>None</em></MenuItem>
            {nodeIds.filter((id) => id !== node.id).map((id) => (
              <MenuItem key={id} value={id} sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{id}</MenuItem>
            ))}
          </Select>
        </FormControl>

        <SectionLabel>Data mapping</SectionLabel>
        <KVEditor label="Input mapping" value={node.input_mapping ?? {}}
          onChange={(v) => up({ input_mapping: v })} />
        <TextField size="small" label="Output capture (ctx key)" fullWidth value={node.output_capture ?? ''}
          onChange={(e) => up({ output_capture: e.target.value })}
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }} />

        {tools.length > 0 && (
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Capabilities</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {tools.map((t) => <Chip key={t} label={`tool: ${t}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />)}
            </Box>
          </Box>
        )}
        {selectedAgent && (
          <>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Reasoning mode</Typography>
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                <Chip label={selectedAgent.reasoning_mode ?? 'prescribed'} size="small" variant="outlined"
                  sx={{ height: 18, fontSize: '0.65rem', color: selectedAgent.reasoning_mode === 'guided' ? '#185FA5' : '#5F5E5A' }} />
                {selectedAgent.reasoning_mode === 'guided' && (
                  <Chip label="variable reasoning" size="small"
                    sx={{ height: 16, fontSize: '0.58rem', bgcolor: '#FFF3E0', color: '#E65100' }} />
                )}
              </Box>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Service account</Typography>
              <Chip label={selectedAgent.service_account_id} size="small"
                sx={{ fontFamily: 'monospace', fontSize: '0.65rem', height: 20, bgcolor: NODE_FILL.agent,
                  color: NODE_STROKE.agent, border: `1px solid ${NODE_STROKE.agent}`, maxWidth: '100%' }} />
            </Box>
          </>
        )}
      </>)}

      {/* ── HTTP fields ── */}
      {node.type === 'http' && (<>
        <SectionLabel>Request</SectionLabel>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl size="small" sx={{ width: 100, flexShrink: 0 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Method</InputLabel>
            <Select label="Method" value={node.method ?? 'GET'}
              onChange={(e) => up({ method: e.target.value as WorkflowNode['method'] })} sx={{ fontSize: '0.8rem' }}>
              {HTTP_METHODS.map((m) => <MenuItem key={m} value={m} sx={{ fontSize: '0.8rem' }}>{m}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="URL template" fullWidth value={node.url_template ?? ''}
            onChange={(e) => up({ url_template: e.target.value })}
            inputProps={{ style: { fontSize: '0.78rem', fontFamily: 'monospace' } }} />
        </Box>

        <SectionLabel>Authentication</SectionLabel>
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ fontSize: '0.8rem' }}>Auth type</InputLabel>
          <Select label="Auth type" value={node.auth?.type ?? ''}
            onChange={(e) => up({ auth: e.target.value ? { ...node.auth, type: e.target.value as 'bearer' | 'basic' | 'api_key' } : undefined })}
            sx={{ fontSize: '0.8rem' }}>
            <MenuItem value="" sx={{ fontSize: '0.8rem' }}><em>None</em></MenuItem>
            {AUTH_TYPES.map((t) => <MenuItem key={t} value={t} sx={{ fontSize: '0.8rem' }}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        {node.auth?.type === 'bearer' && (
          <TextField size="small" label="Bearer token" fullWidth value={node.auth.token ?? ''}
            onChange={(e) => up({ auth: { ...node.auth!, token: e.target.value } })}
            inputProps={{ style: { fontSize: '0.78rem', fontFamily: 'monospace' } }} />
        )}
        {node.auth?.type === 'basic' && (<>
          <TextField size="small" label="Username" fullWidth value={node.auth.username ?? ''}
            onChange={(e) => up({ auth: { ...node.auth!, username: e.target.value } })}
            inputProps={{ style: { fontSize: '0.78rem' } }} />
          <TextField size="small" label="Password" type="password" fullWidth value={node.auth.password ?? ''}
            onChange={(e) => up({ auth: { ...node.auth!, password: e.target.value } })}
            inputProps={{ style: { fontSize: '0.78rem' } }} />
        </>)}
        {node.auth?.type === 'api_key' && (<>
          <TextField size="small" label="Header name" fullWidth value={node.auth.header ?? 'X-API-Key'}
            onChange={(e) => up({ auth: { ...node.auth!, header: e.target.value } })}
            inputProps={{ style: { fontSize: '0.78rem' } }} />
          <TextField size="small" label="Key value" fullWidth value={node.auth.key ?? ''}
            onChange={(e) => up({ auth: { ...node.auth!, key: e.target.value } })}
            inputProps={{ style: { fontSize: '0.78rem', fontFamily: 'monospace' } }} />
        </>)}

        <SectionLabel>Response</SectionLabel>
        <KVEditor label="Extract fields (output key → dot.path)" value={node.extract ?? {}}
          onChange={(v) => up({ extract: v })} />
        <TextField size="small" label="Expect status codes (comma-separated)" fullWidth
          value={(node.expect_status ?? []).join(', ')}
          onChange={(e) => {
            const codes = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
            up({ expect_status: codes.length ? codes : undefined })
          }}
          helperText="e.g. 200, 201, 202 — leave blank for any 2xx"
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }} />
        <TextField size="small" label="Output capture (ctx key)" fullWidth value={node.output_capture ?? ''}
          onChange={(e) => up({ output_capture: e.target.value })}
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }} />
      </>)}

      {/* ── Decision fields ── */}
      {node.type === 'decision' && (<>
        {/* Binary mode */}
        {!node.cases?.length && (<>
          <SectionLabel>Binary decision</SectionLabel>
          <TextField size="small" label="Expression" fullWidth multiline maxRows={3}
            value={node.expression ?? ''}
            onChange={(e) => up({ expression: e.target.value })}
            inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }}
            helperText="e.g. ctx.input.amount_usd > 250000" />
          <Box>
            <Typography variant="caption" color="text.secondary" display="block" gutterBottom>
              Branch targets — draw arrows from canvas handles
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="T" size="small" sx={{ bgcolor: 'rgba(59,109,17,0.1)', color: '#3B6D11', fontSize: '0.65rem', height: 18, minWidth: 24 }} />
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">{node.branches?.true ?? '(none)'}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Chip label="F" size="small" sx={{ bgcolor: 'rgba(185,28,28,0.1)', color: '#b91c1c', fontSize: '0.65rem', height: 18, minWidth: 24 }} />
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">{node.branches?.false ?? '(none)'}</Typography>
              </Box>
            </Box>
          </Box>
        </>)}

        {/* Multi-way mode */}
        {!!node.cases?.length && (<>
          <SectionLabel>Multi-way decision (cases)</SectionLabel>
          {node.cases.map((c, i) => (
            <Box key={i} sx={{ p: 1, border: 1, borderColor: NODE_STROKE.decision, borderRadius: 1, bgcolor: NODE_FILL.decision, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Chip label={`Case ${i + 1}`} size="small" sx={{ fontSize: '0.6rem', height: 16, bgcolor: NODE_STROKE.decision, color: '#fff' }} />
                {c.label && <Typography variant="caption" color="text.secondary">{c.label}</Typography>}
              </Box>
              <TextField size="small" label="Condition" fullWidth value={c.condition}
                onChange={(e) => { const next = [...node.cases!]; next[i] = { ...c, condition: e.target.value }; up({ cases: next }) }}
                inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace' } }} />
              <TextField size="small" label="Label" fullWidth value={c.label ?? ''}
                onChange={(e) => { const next = [...node.cases!]; next[i] = { ...c, label: e.target.value }; up({ cases: next }) }}
                inputProps={{ style: { fontSize: '0.75rem' } }} />
              <FormControl size="small" fullWidth>
                <InputLabel sx={{ fontSize: '0.75rem' }}>Target node</InputLabel>
                <Select label="Target node" value={c.target}
                  onChange={(e) => { const next = [...node.cases!]; next[i] = { ...c, target: e.target.value }; up({ cases: next }) }}
                  sx={{ fontSize: '0.75rem' }}>
                  {nodeIds.filter((id) => id !== node.id).map((id) => (
                    <MenuItem key={id} value={id} sx={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{id}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          ))}
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Default (no case matched)</InputLabel>
            <Select label="Default (no case matched)" value={node.default ?? ''}
              onChange={(e) => up({ default: e.target.value || undefined })} sx={{ fontSize: '0.8rem' }}>
              <MenuItem value="" sx={{ fontSize: '0.8rem' }}><em>None (required)</em></MenuItem>
              {nodeIds.filter((id) => id !== node.id).map((id) => (
                <MenuItem key={id} value={id} sx={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{id}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </>)}
      </>)}

      {/* ── Human task fields ── */}
      {node.type === 'human_task' && (<>
        <SectionLabel>Assignment</SectionLabel>
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ fontSize: '0.8rem' }}>Assignee group</InputLabel>
          <Select label="Assignee group" value={node.assignee_group ?? ''}
            onChange={(e) => up({ assignee_group: e.target.value })} sx={{ fontSize: '0.8rem' }}>
            {ASSIGNEE_GROUPS.map((g) => <MenuItem key={g} value={g} sx={{ fontSize: '0.8rem' }}>{g}</MenuItem>)}
          </Select>
        </FormControl>
        <TextField size="small" label="Assignee individual (email, optional)" fullWidth value={node.assignee_individual ?? ''}
          onChange={(e) => up({ assignee_individual: e.target.value || undefined })}
          inputProps={{ style: { fontSize: '0.8rem' } }} />
        <Box sx={{ display: 'flex', gap: 1 }}>
          <FormControl size="small" sx={{ flex: 1 }}>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Priority</InputLabel>
            <Select label="Priority" value={node.priority ?? 'medium'}
              onChange={(e) => up({ priority: e.target.value as WorkflowNode['priority'] })} sx={{ fontSize: '0.8rem' }}>
              {PRIORITY_LEVELS.map((p) => <MenuItem key={p} value={p} sx={{ fontSize: '0.8rem' }}>{p}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField size="small" label="SLA (seconds)" type="number" sx={{ flex: 1 }}
            value={node.sla_seconds ?? 3600}
            onChange={(e) => up({ sla_seconds: parseInt(e.target.value, 10) })}
            inputProps={{ min: 60, style: { fontSize: '0.8rem' } }} />
        </Box>

        <SectionLabel>Task content</SectionLabel>
        <TextField size="small" label="Task title" fullWidth value={node.task_template?.title ?? ''}
          onChange={(e) => up({ task_template: { title: e.target.value, description: node.task_template?.description ?? '', actions: node.task_template?.actions ?? ['accept', 'reject'] } })}
          inputProps={{ style: { fontSize: '0.8rem' } }} />
        <TextField size="small" label="Task description" fullWidth multiline rows={2}
          value={node.task_template?.description ?? ''}
          onChange={(e) => up({ task_template: { title: node.task_template?.title ?? '', description: e.target.value, actions: node.task_template?.actions ?? ['accept', 'reject'] } })}
          inputProps={{ style: { fontSize: '0.8rem' } }} />
        <TextField size="small" label="Evidence (ctx keys, comma-separated)" fullWidth
          value={(node.evidence ?? []).join(', ')}
          onChange={(e) => {
            const keys = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
            up({ evidence: keys.length ? keys : undefined })
          }}
          helperText="e.g. kyc_result, ofac_result — shown to the reviewer"
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }} />

        <SectionLabel>Auto-skip</SectionLabel>
        <TextField size="small" label="Skip if condition" fullWidth value={node.skip_if?.condition ?? ''}
          onChange={(e) => up({ skip_if: e.target.value ? { condition: e.target.value, auto_resolution: node.skip_if?.auto_resolution ?? 'accept' } : undefined })}
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }}
          helperText="Python expression — if true, task is never created" />
        {node.skip_if && (
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Auto-resolution</InputLabel>
            <Select label="Auto-resolution" value={node.skip_if.auto_resolution ?? 'accept'}
              onChange={(e) => up({ skip_if: { ...node.skip_if!, auto_resolution: e.target.value as 'accept' | 'reject' } })}
              sx={{ fontSize: '0.8rem' }}>
              <MenuItem value="accept" sx={{ fontSize: '0.8rem' }}>accept</MenuItem>
              <MenuItem value="reject" sx={{ fontSize: '0.8rem' }}>reject</MenuItem>
            </Select>
          </FormControl>
        )}

        <SectionLabel>SLA escalation policy</SectionLabel>
        <FormControl size="small" fullWidth>
          <InputLabel sx={{ fontSize: '0.8rem' }}>On SLA expiry</InputLabel>
          <Select label="On SLA expiry" value={node.escalation_policy?.action ?? ''}
            onChange={(e) => up({ escalation_policy: e.target.value ? { action: e.target.value as 'auto_approve' | 'auto_reject' | 'escalate', escalate_to_group: node.escalation_policy?.escalate_to_group } : undefined })}
            sx={{ fontSize: '0.8rem' }}>
            <MenuItem value="" sx={{ fontSize: '0.8rem' }}><em>None (timeout)</em></MenuItem>
            {ESCALATION_ACTIONS.map((a) => <MenuItem key={a} value={a} sx={{ fontSize: '0.8rem' }}>{a}</MenuItem>)}
          </Select>
        </FormControl>
        {node.escalation_policy?.action === 'escalate' && (
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ fontSize: '0.8rem' }}>Escalate to group</InputLabel>
            <Select label="Escalate to group" value={node.escalation_policy.escalate_to_group ?? ''}
              onChange={(e) => up({ escalation_policy: { ...node.escalation_policy!, escalate_to_group: e.target.value } })}
              sx={{ fontSize: '0.8rem' }}>
              {ASSIGNEE_GROUPS.map((g) => <MenuItem key={g} value={g} sx={{ fontSize: '0.8rem' }}>{g}</MenuItem>)}
            </Select>
          </FormControl>
        )}

        <SectionLabel>Output</SectionLabel>
        <TextField size="small" label="Output capture (ctx key)" fullWidth value={node.output_capture ?? ''}
          onChange={(e) => up({ output_capture: e.target.value })}
          inputProps={{ style: { fontSize: '0.8rem', fontFamily: 'monospace' } }} />
      </>)}

      {/* ── Replace with agent ── */}
      {canReplace && (
        <Box sx={{ pt: 1, mt: 'auto', borderTop: 1, borderColor: 'divider' }}>
          <Button variant="contained" size="small" fullWidth startIcon={<AutoFixHighIcon />}
            onClick={() => setShowPicker(!showPicker)}
            sx={{ bgcolor: NODE_STROKE.agent, '&:hover': { bgcolor: '#3d3596' } }}>
            Replace with agent
          </Button>
          {showPicker && (
            <Paper variant="outlined" sx={{ mt: 1, overflow: 'hidden' }}>
              {agents.filter((a) => a.status === 'deployed').map((a) => (
                <Box key={a.name} component="button"
                  onClick={() => { onReplaceWithAgent(node.id, a.name, a.service_account_id); setShowPicker(false) }}
                  sx={{ display: 'block', width: '100%', textAlign: 'left', px: 1.5, py: 1,
                    bgcolor: 'transparent', border: 'none', borderBottom: '1px solid', borderColor: 'divider',
                    cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' }, '&:last-child': { borderBottom: 'none' } }}>
                  <Typography variant="caption" display="block" fontFamily="monospace">{a.name}</Typography>
                  <Typography variant="caption" display="block" fontFamily="monospace"
                    sx={{ color: NODE_STROKE.agent, fontSize: '0.6rem' }}>{a.service_account_id}</Typography>
                </Box>
              ))}
              {agents.filter((a) => a.status === 'deployed').length === 0 && (
                <Box sx={{ px: 1.5, py: 1 }}>
                  <Typography variant="caption" color="text.secondary">No deployed agents.</Typography>
                </Box>
              )}
            </Paper>
          )}
        </Box>
      )}
    </Box>
  )
}

// ── Input form (from JSON Schema) ─────────────────────────────────────────────

type FieldSchema = { type: string; enum?: string[]; items?: unknown }

function InputField({
  name, schema, value, onChange, required,
}: {
  name: string
  schema: FieldSchema
  value: unknown
  onChange: (v: unknown) => void
  required?: boolean
}) {
  const label = `${name}${required ? ' *' : ''}`
  if (schema.enum) {
    return (
      <FormControl size="small" fullWidth>
        <InputLabel sx={{ fontSize: '0.8rem' }}>{label}</InputLabel>
        <Select label={label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} sx={{ fontSize: '0.8rem' }}>
          {schema.enum.map((v) => <MenuItem key={v} value={v} sx={{ fontSize: '0.8rem' }}>{v}</MenuItem>)}
        </Select>
      </FormControl>
    )
  }
  if (schema.type === 'boolean') {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="caption">{label}</Typography>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={value ? 'true' : 'false'}
          onChange={(_, v) => onChange(v === 'true')}
        >
          <ToggleButton value="true" sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}>Yes</ToggleButton>
          <ToggleButton value="false" sx={{ fontSize: '0.7rem', py: 0.25, px: 1 }}>No</ToggleButton>
        </ToggleButtonGroup>
      </Box>
    )
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <TextField
        size="small"
        fullWidth
        label={label}
        type="number"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        inputProps={{ style: { fontSize: '0.8rem' } }}
      />
    )
  }
  if (schema.type === 'array' || schema.type === 'object') {
    return (
      <TextField
        size="small"
        fullWidth
        label={`${label} (JSON)`}
        multiline
        rows={3}
        value={typeof value === 'string' ? value : JSON.stringify(value ?? (schema.type === 'array' ? [] : {}), null, 2)}
        onChange={(e) => {
          try { onChange(JSON.parse(e.target.value)) } catch { onChange(e.target.value) }
        }}
        inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace' } }}
      />
    )
  }
  return (
    <TextField
      size="small"
      fullWidth
      label={label}
      value={String(value ?? '')}
      onChange={(e) => onChange(e.target.value)}
      inputProps={{ style: { fontSize: '0.8rem' } }}
    />
  )
}

function InputForm({
  spec, value, onChange,
}: {
  spec: WorkflowSpec
  value: Record<string, unknown>
  onChange: (v: Record<string, unknown>) => void
}) {
  const schema = spec.spec.input_schema
  if (!schema?.properties) {
    return (
      <TextField
        size="small"
        fullWidth
        multiline
        rows={4}
        label="Input JSON"
        value={JSON.stringify(value, null, 2)}
        onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { /* ignore */ } }}
        inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace' } }}
      />
    )
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {Object.entries(schema.properties).map(([name, fieldSchema]) => (
        <InputField
          key={name}
          name={name}
          schema={fieldSchema}
          value={value[name]}
          onChange={(v) => onChange({ ...value, [name]: v })}
          required={schema.required?.includes(name)}
        />
      ))}
    </Box>
  )
}

// ── Run History ───────────────────────────────────────────────────────────────

function RunHistory({ wfName }: { wfName: string }) {
  const { data } = useQuery({
    queryKey: ['runs', wfName],
    queryFn: () => workflowApi.listRuns(wfName),
    refetchInterval: 10000,
  })
  const runs: RunRecord[] = data?.runs ?? []
  if (runs.length === 0) return null
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Recent runs
      </Typography>
      <Box sx={{ mt: 0.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {runs.slice(0, 5).map((r) => {
          const age = Math.floor((Date.now() - new Date(r.started_at).getTime()) / 60000)
          const color = r.status === 'completed' ? '#3B6D11' : r.status === 'running' ? '#534AB7' : r.status === 'failed' ? '#b91c1c' : '#854F0B'
          return (
            <Box key={r.run_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.run_id}
              </Typography>
              <Typography variant="caption" color="text.secondary">{age}m ago</Typography>
              <Chip label={r.status} size="small" sx={{ height: 16, fontSize: '0.6rem', color, bgcolor: `${color}22`, flexShrink: 0 }} />
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ── Main Composer ─────────────────────────────────────────────────────────────

let _nodeCounter = 0
function newNodeId(type: string) {
  return `${type}-${++_nodeCounter}`
}

export default function Composer({ workflowName: propName }: { workflowName?: string }) {
  const { name: paramName } = useParams()
  const navigate = useNavigate()
  const wfName = paramName || propName || 'ats-asset-transfer'
  const qc = useQueryClient()

  const [parsedSpec, setParsedSpec] = useState<WorkflowSpec | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<{ node_id?: string; reason: string }[]>([])
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({})
  const [nodeSummaries, setNodeSummaries] = useState<Record<string, Record<string, unknown>>>({})
  const [showRunPane, setShowRunPane] = useState(false)
  const [rawJsonMode, setRawJsonMode] = useState(false)
  const [runInput, setRunInput] = useState<Record<string, unknown>>({})
  const [runId, setRunId] = useState<string | null>(null)
  const [runEvents, setRunEvents] = useState<SSEEvent[]>([])
  const [runError, setRunError] = useState('')
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const rfInstance = useRef<ReactFlowInstance | null>(null)
  const rfWrapperRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // ── Load spec ──────────────────────────────────────────────────────────────

  const { data: specData, isLoading: specLoading } = useQuery({
    queryKey: ['wf-spec', wfName],
    queryFn: () => workflowApi.getWorkflowSpec(wfName),
    retry: false,
  })

  useEffect(() => {
    if (!specData?.yaml) return
    try {
      const raw = yaml.load(specData.yaml) as WorkflowSpec
      setParsedSpec(raw)
      const { nodes: n, edges: e } = specToFlow(raw)
      setNodes(n)
      setEdges(e)
    } catch (err) {
      console.error('spec parse error', err)
    }
  }, [specData])

  // Apply nodeStates / summaries to RF nodes
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          _nodeState: nodeStates[n.id],
          _outputSummary: nodeSummaries[n.id],
        },
      }))
    )
  }, [nodeStates, nodeSummaries])

  // ── Agents ─────────────────────────────────────────────────────────────────

  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const agents = (agentsData?.agents ?? []).map((a) => ({
    name: a.name,
    service_account_id: a.service_account_id,
    status: a.status,
    tools: (a as typeof a & { tools?: string[] }).tools,
  }))
  const nodeIds = parsedSpec?.spec.nodes.map((n) => n.id) ?? []

  // ── Spec mutation helpers ──────────────────────────────────────────────────

  const updateNode = useCallback((nodeId: string, changes: Partial<WorkflowNode>) => {
    setParsedSpec((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        spec: {
          ...prev.spec,
          nodes: prev.spec.nodes.map((n) => n.id === nodeId ? { ...n, ...changes } : n),
        },
      }
    })
    setNodes((prev) =>
      prev.map((n) => n.id !== nodeId ? n : { ...n, data: { ...n.data, ...changes } })
    )
  }, [])

  const replaceWithAgent = useCallback((nodeId: string, agentName: string, svcId: string) => {
    const changes: Partial<WorkflowNode> = {
      type: 'agent',
      label: agentName,
      agent_ref: { name: agentName, version: 'latest' },
      _serviceAccountId: svcId,
    }
    setParsedSpec((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        spec: { ...prev.spec, nodes: prev.spec.nodes.map((n) => n.id !== nodeId ? n : { ...n, ...changes }) },
      }
    })
    setNodes((prev) =>
      prev.map((n) => n.id !== nodeId ? n : { ...n, type: 'agent', data: { ...n.data, ...changes } })
    )
  }, [])

  // ── Edge callbacks ─────────────────────────────────────────────────────────

  const onConnect = useCallback((params: Connection) => {
    setEdges((prev) => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      style: { stroke: '#94a3b8' },
    }, prev))
    if (!params.source || !params.target) return
    setParsedSpec((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        spec: {
          ...prev.spec,
          nodes: prev.spec.nodes.map((n) => {
            if (n.id !== params.source) return n
            if (n.type === 'decision') {
              const handle = params.sourceHandle ?? 'true'
              return { ...n, branches: { ...(n.branches ?? {}), [handle]: params.target } }
            }
            return { ...n, next: params.target }
          }),
        },
      }
    })
  }, [])

  // ── Position persistence ───────────────────────────────────────────────────

  const onNodeDragStop = useCallback((_: React.MouseEvent, node: Node) => {
    setParsedSpec((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        metadata: {
          ...prev.metadata,
          layout: {
            nodes: {
              ...(prev.metadata.layout?.nodes ?? {}),
              [node.id]: node.position,
            },
          },
        },
      }
    })
  }, [])

  // ── Palette drop ───────────────────────────────────────────────────────────

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/mphasis-nodetype') as WorkflowNode['type'] | 'trigger'
    if (!type || !rfInstance.current || !rfWrapperRef.current) return

    const bounds = rfWrapperRef.current.getBoundingClientRect()
    const position = rfInstance.current.project({
      x: e.clientX - bounds.left,
      y: e.clientY - bounds.top,
    })

    const id = newNodeId(type)
    const newNodeData: WorkflowNode = {
      id,
      label: id,
      type: type === 'trigger' ? 'http' : type,  // trigger maps to first real type
    }

    setNodes((prev) => [...prev, {
      id,
      type: type === 'trigger' ? 'http' : type,
      position,
      data: newNodeData,
    }])

    if (type !== 'trigger') {
      setParsedSpec((prev) => {
        if (!prev) return prev
        return { ...prev, spec: { ...prev.spec, nodes: [...prev.spec.nodes, newNodeData] } }
      })
    }
  }, [])

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  // ── Context menu ───────────────────────────────────────────────────────────

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
  }, [])

  const deleteNode = useCallback((nodeId: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== nodeId))
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId))
    setParsedSpec((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        spec: {
          ...prev.spec,
          nodes: prev.spec.nodes
            .filter((n) => n.id !== nodeId)
            .map((n) => ({
              ...n,
              next: n.next === nodeId ? null : n.next,
              fallback_node: n.fallback_node === nodeId ? undefined : n.fallback_node,
              branches: n.branches
                ? Object.fromEntries(Object.entries(n.branches).map(([k, v]) => [k, v === nodeId ? null : v]))
                : undefined,
            })),
        },
      }
    })
    setCtxMenu(null)
  }, [])

  // ── Validate ───────────────────────────────────────────────────────────────

  const validateMut = useMutation({
    mutationFn: async () => {
      if (!parsedSpec) throw new Error('No spec loaded')
      const positions = Object.fromEntries(
        (rfInstance.current?.getNodes() ?? nodes).map((n) => [n.id, n.position])
      )
      const yamlText = serializeSpec(parsedSpec, positions)
      const result = await workflowApi.validateWorkflow(yamlText) as { valid: boolean; errors?: { node_id?: string; reason: string }[] }
      return result
    },
    onSuccess: (result) => {
      if (result?.errors?.length) {
        setValidationErrors(result.errors)
        setNodes((prev) =>
          prev.map((n) => {
            const err = result.errors!.find((e) => e.node_id === n.id)
            return { ...n, data: { ...n.data, _errorMsg: err?.reason } }
          })
        )
      } else {
        setValidationErrors([])
        setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, _errorMsg: undefined } })))
      }
    },
    onError: (err: unknown) => {
      const body = (err as { errors?: { node_id?: string; reason: string }[] })?.errors
      if (body?.length) {
        setValidationErrors(body)
        setNodes((prev) =>
          prev.map((n) => {
            const e = body.find((b) => b.node_id === n.id)
            return { ...n, data: { ...n.data, _errorMsg: e?.reason } }
          })
        )
      }
    },
  })

  // ── Save ───────────────────────────────────────────────────────────────────

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!parsedSpec) throw new Error('No spec')
      const positions = Object.fromEntries(
        (rfInstance.current?.getNodes() ?? nodes).map((n) => [n.id, n.position])
      )
      const yamlText = serializeSpec(parsedSpec, positions)
      await workflowApi.saveWorkflowSpec(wfName, yamlText)
      await workflowApi.registerWorkflow(wfName, yamlText)
      return yamlText
    },
    onMutate: () => setSaveStatus('saving'),
    onSuccess: () => {
      setSaveStatus('saved')
      qc.invalidateQueries({ queryKey: ['workflows'] })
      setTimeout(() => setSaveStatus('idle'), 2000)
    },
    onError: () => setSaveStatus('error'),
  })

  // ── Run ────────────────────────────────────────────────────────────────────

  const startRun = useMutation({
    mutationFn: () => workflowApi.startRun(wfName, runInput),
    onSuccess: (d) => {
      setRunId(d.run_id)
      setRunEvents([])
      setNodeStates({})
      setNodeSummaries({})
      setRunError('')
      subscribeSSE(d.run_id)
      qc.invalidateQueries({ queryKey: ['runs', wfName] })
    },
    onError: (e: unknown) => setRunError(String(e)),
  })

  const subscribeSSE = useCallback((id: string) => {
    if (esRef.current) esRef.current.close()
    const es = new EventSource(workflowApi.eventsUrl(wfName, id))
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data)
        if (event.event === 'keepalive') return
        setRunEvents((prev) => [...prev, event])
        if (event.event === 'node_started' && event.node_id)
          setNodeStates((prev) => ({ ...prev, [event.node_id!]: 'running' }))
        if (event.event === 'node_completed' && event.node_id) {
          setNodeStates((prev) => ({ ...prev, [event.node_id!]: 'completed' }))
          if (event.output_summary)
            setNodeSummaries((prev) => ({ ...prev, [event.node_id!]: event.output_summary! }))
        }
        if (event.event === 'node_paused' && event.node_id)
          setNodeStates((prev) => ({ ...prev, [event.node_id!]: 'paused' }))
        if (event.event === 'workflow_completed' || event.event === 'workflow_failed')
          es.close()
      } catch { /* ignore */ }
    }
    es.onerror = () => {
      // Only close on terminal workflow events — let EventSource reconnect on transient errors
    }
  }, [wfName])

  useEffect(() => () => { esRef.current?.close() }, [])

  // ── Selected node ──────────────────────────────────────────────────────────

  const selectedNode = nodes.find((n) => n.id === selectedNodeId)?.data ?? null

  // ── Canvas height ──────────────────────────────────────────────────────────

  const canvasH = showRunPane
    ? `calc(100vh - ${APPBAR_H}px - ${TOOLBAR_H}px - ${RUN_PANE_H}px)`
    : `calc(100vh - ${APPBAR_H}px - ${TOOLBAR_H}px)`

  const sampleInputs = parsedSpec?.metadata?.sample_inputs ?? []

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${APPBAR_H}px)` }}>
      {/* Toolbar */}
      <Toolbar
        variant="dense"
        sx={{ minHeight: `${TOOLBAR_H}px !important`, height: TOOLBAR_H, px: 2, gap: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper', flexShrink: 0 }}
      >
        <Tooltip title="Back to workflows">
          <IconButton size="small" onClick={() => navigate('/workflows/compose')}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography variant="body2" fontWeight={600} sx={{ mr: 1 }} fontFamily="monospace">{wfName}</Typography>
        {specLoading && <CircularProgress size={12} sx={{ mr: 1 }} />}

        <Button
          size="small"
          variant="outlined"
          onClick={() => validateMut.mutate()}
          disabled={validateMut.isPending || !parsedSpec}
          startIcon={validateMut.isPending ? <CircularProgress size={11} /> : <CheckCircleIcon sx={{ fontSize: 14 }} />}
        >
          Validate
        </Button>

        <Button
          size="small"
          variant="contained"
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending || !parsedSpec || validationErrors.length > 0}
          startIcon={saveStatus === 'saving' ? <CircularProgress size={11} color="inherit" /> : <SaveIcon sx={{ fontSize: 14 }} />}
          sx={{ bgcolor: '#1a73e8', '&:hover': { bgcolor: '#1557b0' } }}
        >
          {saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save'}
        </Button>

        <Button
          size="small"
          variant="outlined"
          startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
          onClick={() => setShowRunPane(true)}
        >
          Test run
        </Button>

        {/* Validation error banner */}
        {validationErrors.length > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
            <Typography variant="caption" sx={{ color: 'error.main' }}>
              {validationErrors.length} validation error{validationErrors.length !== 1 ? 's' : ''} — fix before saving
            </Typography>
          </Box>
        )}
      </Toolbar>

      {/* Three-pane body */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Palette */}
        <Palette />

        {/* Canvas */}
        <Box
          ref={rfWrapperRef}
          sx={{ flex: 1, height: canvasH, position: 'relative' }}
          onDrop={onDrop}
          onDragOver={onDragOver}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDragStop={onNodeDragStop}
            nodeTypes={NODE_TYPES}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => { setSelectedNodeId(null); setCtxMenu(null) }}
            onNodeContextMenu={onNodeContextMenu}
            onInit={(inst) => { rfInstance.current = inst }}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            deleteKeyCode="Delete"
            proOptions={{ hideAttribution: true }}
          >
            <Controls showInteractive={false} />
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#d0d4db" />
          </ReactFlow>

          {/* Context menu */}
          {ctxMenu && (
            <Menu
              open
              anchorReference="anchorPosition"
              anchorPosition={{ top: ctxMenu.y, left: ctxMenu.x }}
              onClose={() => setCtxMenu(null)}
            >
              <MenuItem
                onClick={() => deleteNode(ctxMenu.nodeId)}
                dense
                sx={{ fontSize: '0.8rem', color: 'error.main' }}
              >
                Delete node
              </MenuItem>
            </Menu>
          )}
        </Box>

        {/* Inspector */}
        <Drawer
          anchor="right"
          variant="permanent"
          sx={{
            width: INSPECTOR_W,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: INSPECTOR_W,
              position: 'relative',
              height: '100%',
              border: 'none',
              borderLeft: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper',
              overflow: 'hidden',
            },
          }}
        >
          <Box sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Inspector
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflow: 'auto' }}>
            <Inspector
              node={selectedNode}
              agents={agents}
              nodeIds={nodeIds}
              onUpdate={updateNode}
              onReplaceWithAgent={replaceWithAgent}
            />
          </Box>
        </Drawer>
      </Box>

      {/* Run pane */}
      {showRunPane && (
        <Paper square sx={{ height: RUN_PANE_H, flexShrink: 0, borderTop: 1, borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Typography variant="body2" fontWeight={600}>Test run: {wfName}</Typography>

            {/* Sample input buttons */}
            {sampleInputs.map((si) => (
              <Chip
                key={si.label}
                label={si.label}
                size="small"
                onClick={() => setRunInput(si.input)}
                variant="outlined"
                sx={{ cursor: 'pointer', fontSize: '0.7rem' }}
              />
            ))}

            <Box sx={{ flex: 1 }} />

            {/* Raw JSON toggle */}
            <Tooltip title="Toggle raw JSON / form">
              <IconButton size="small" onClick={() => setRawJsonMode((v) => !v)} sx={{ opacity: rawJsonMode ? 1 : 0.5 }}>
                <HistoryToggleOffIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Button
              size="small"
              variant="contained"
              startIcon={startRun.isPending ? <CircularProgress size={11} color="inherit" /> : <PlayArrowIcon sx={{ fontSize: 13 }} />}
              onClick={() => startRun.mutate()}
              disabled={startRun.isPending}
              sx={{ bgcolor: '#1a73e8', '&:hover': { bgcolor: '#1557b0' } }}
            >
              Run
            </Button>

            {runId && (
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {runId}
              </Typography>
            )}

            <IconButton size="small" onClick={() => setShowRunPane(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {runError && (
            <Typography variant="caption" sx={{ px: 2, py: 0.5, color: 'error.main' }}>{runError}</Typography>
          )}

          <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 1.5 }}>
            {rawJsonMode ? (
              <TextField
                size="small"
                fullWidth
                multiline
                rows={5}
                label="Input JSON"
                value={JSON.stringify(runInput, null, 2)}
                onChange={(e) => { try { setRunInput(JSON.parse(e.target.value)) } catch { /* ignore */ } }}
                inputProps={{ style: { fontSize: '0.75rem', fontFamily: 'monospace' } }}
              />
            ) : parsedSpec ? (
              <Box sx={{ display: 'flex', gap: 3 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <InputForm spec={parsedSpec} value={runInput} onChange={setRunInput} />
                </Box>
                {runEvents.length > 0 && (
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={600} display="block" gutterBottom>Events</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 180, overflow: 'auto' }}>
                      {runEvents.filter((ev) => ev.node_id).map((ev, i) => (
                        <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ minWidth: 14 }}>
                            {ev.event === 'node_completed' ? '✓' : ev.event === 'node_paused' ? '⏸' : ev.event === 'node_started' ? '▶' : '·'}
                          </Typography>
                          <Typography variant="caption" fontFamily="monospace" sx={{ flex: 1 }}>{ev.node_id}</Typography>
                          {ev.duration_ms && <Typography variant="caption" color="text.secondary">{ev.duration_ms}ms</Typography>}
                        </Box>
                      ))}
                    </Box>
                    <RunHistory wfName={wfName} />
                  </Box>
                )}
              </Box>
            ) : null}
          </Box>
        </Paper>
      )}
    </Box>
  )
}
