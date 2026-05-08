import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  Box, Button, Chip, Paper, Skeleton, Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TerminalIcon from '@mui/icons-material/Terminal'
import AddIcon from '@mui/icons-material/Add'
import { workflowApi } from '../../api/workflow'
import type { WorkflowRecord } from '../../types'

const TILE_SX = {
  p: 3,
  borderRadius: 2,
  border: '1.5px solid',
  cursor: 'pointer',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minHeight: 140,
  '&:hover': { boxShadow: 3 },
}

function ModeC() {
  return (
    <Paper
      variant="outlined"
      sx={{
        ...TILE_SX,
        borderColor: 'divider',
        opacity: 0.55,
        cursor: 'not-allowed',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <AutoFixHighIcon sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" fontWeight={600} color="text.secondary">AI COMPOSER</Typography>
        <Chip label="Coming soon" size="small" sx={{ ml: 'auto', fontSize: '0.65rem', height: 18 }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
        Describe a process in plain English — we draft the workflow spec for you to review and edit.
      </Typography>
    </Paper>
  )
}

export default function ComposerLanding() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: workflowApi.listWorkflows,
  })
  const workflows: WorkflowRecord[] = data?.workflows ?? []

  const newBlank = useMutation({
    mutationFn: async () => {
      const name = `workflow-${Date.now()}`
      const stub = [
        'apiVersion: mphasis.platform/v1',
        'kind: WorkflowDeployment',
        'metadata:',
        `  name: ${name}`,
        '  domain: banking',
        '  version: 0.1.0',
        '  description: New workflow',
        '  owner: demo-user',
        'spec:',
        '  input_schema:',
        '    type: object',
        '    required: []',
        '    properties: {}',
        '  nodes: []',
        '  audit:',
        '    log_to: minio://audit-logs/workflow/' + name,
        '    retention_days: 90',
        '  deployment:',
        '    runtime: temporal',
        '    task_queue: default-task-queue',
      ].join('\n')
      await workflowApi.saveWorkflowSpec(name, stub)
      return name
    },
    onSuccess: (name) => navigate(`/workflows/compose/${name}`),
  })

  return (
    <Box sx={{ p: 4, maxWidth: 860, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>Workflow Composer</Typography>
        <Typography variant="body2" color="text.secondary">
          Build auditable workflows by assembling agent, HTTP, decision, and human-task nodes.
        </Typography>
      </Box>

      {/* Mode tiles */}
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Start a workflow
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2, mt: 1, mb: 5 }}>
        <ModeC />

        {/* Mode B: CLI */}
        <Paper
          variant="outlined"
          sx={{ ...TILE_SX, borderColor: 'divider' }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TerminalIcon sx={{ color: 'text.secondary' }} />
            <Typography variant="body2" fontWeight={600}>CLI INIT</Typography>
            <Chip label="Mode B" size="small" variant="outlined" sx={{ ml: 'auto', fontSize: '0.65rem', height: 18 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            Scaffold a spec from the terminal. The CLI creates a stub you edit and open here.
          </Typography>
          <Box
            component="pre"
            sx={{
              mt: 'auto',
              bgcolor: 'action.hover',
              p: 1,
              borderRadius: 1,
              fontSize: '0.68rem',
              fontFamily: 'monospace',
              color: 'text.primary',
              m: 0,
              overflow: 'auto',
            }}
          >
            {'atom workflow init <name>'}
          </Box>
        </Paper>

        {/* Mode A: Empty canvas */}
        <Paper
          variant="outlined"
          onClick={() => newBlank.mutate()}
          sx={{
            ...TILE_SX,
            borderColor: 'primary.main',
            '&:hover': { borderColor: 'primary.dark', boxShadow: 3 },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon sx={{ color: 'primary.main' }} />
            <Typography variant="body2" fontWeight={600} color="primary.main">EMPTY CANVAS</Typography>
            <Chip label="Mode A" size="small" color="primary" sx={{ ml: 'auto', fontSize: '0.65rem', height: 18 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6 }}>
            Start blank. Drag nodes from the palette, draw connections, configure each step in the inspector.
          </Typography>
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            disabled={newBlank.isPending}
            sx={{ mt: 'auto', alignSelf: 'flex-start' }}
            onClick={(e) => { e.stopPropagation(); newBlank.mutate() }}
          >
            New workflow
          </Button>
        </Paper>
      </Box>

      {/* Recent workflows */}
      <Typography variant="caption" color="text.secondary" fontWeight={600} sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Recent workflows
      </Typography>
      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {isLoading && [0, 1].map((i) => (
          <Skeleton key={i} variant="rectangular" height={56} sx={{ borderRadius: 1.5 }} />
        ))}
        {!isLoading && workflows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No registered workflows yet. Start one above.
          </Typography>
        )}
        {workflows.map((wf) => (
          <Paper
            key={wf.name}
            variant="outlined"
            sx={{
              px: 2.5,
              py: 1.5,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 2,
              '&:hover': { bgcolor: 'action.hover', cursor: 'pointer' },
            }}
            onClick={() => navigate(`/workflows/compose/${wf.name}`)}
          >
            <AccountTreeIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} fontFamily="monospace">{wf.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                v{wf.version} · {wf.domain} · registered {new Date(wf.registered_at).toLocaleDateString()}
              </Typography>
            </Box>
            <Chip
              label={wf.status}
              size="small"
              color={wf.status === 'registered' ? 'success' : 'default'}
              variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem' }}
            />
            <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); navigate(`/workflows/compose/${wf.name}`) }}>
              Open
            </Button>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}
