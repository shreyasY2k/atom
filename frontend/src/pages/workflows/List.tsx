import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, CircularProgress, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { workflowApi } from '../../api/workflow'
import type { WorkflowRecord } from '../../types'

export default function WorkflowList() {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: workflowApi.listWorkflows })
  const { data: specsData } = useQuery({ queryKey: ['workflow-specs'], queryFn: workflowApi.listWorkflowSpecs })

  const reg = useMutation({
    mutationFn: (name: string) => workflowApi.registerWorkflow(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow-specs'] })
    },
  })

  const workflows: WorkflowRecord[] = data?.workflows ?? []
  const unregistered = (specsData?.specs ?? []).filter(s => !s.registered)

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>Workflow Registry</Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => {
            qc.invalidateQueries({ queryKey: ['workflows'] })
            qc.invalidateQueries({ queryKey: ['workflow-specs'] })
          }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}

      {/* Unregistered specs available on disk */}
      {unregistered.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="caption" color="text.secondary" fontWeight={600}
            sx={{ textTransform: 'uppercase', letterSpacing: '0.07em', display: 'block', mb: 1 }}>
            Available to register
          </Typography>
          <Stack spacing={1}>
            {unregistered.map((s) => (
              <Paper key={s.name} variant="outlined"
                sx={{ px: 2, py: 1.25, borderRadius: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <AccountTreeIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} fontFamily="monospace">{s.name}</Typography>
                  <Typography variant="caption" color="text.secondary">v{s.version} · {s.domain}</Typography>
                </Box>
                <Button size="small" variant="outlined"
                  disabled={reg.isPending}
                  startIcon={reg.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlineIcon />}
                  onClick={() => reg.mutate(s.name)}>
                  Register
                </Button>
              </Paper>
            ))}
          </Stack>
        </Box>
      )}

      {/* Registered workflows */}
      {workflows.length === 0 && !isLoading && unregistered.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          No workflows found. Go to the Workflow Composer to create or import one.
        </Typography>
      )}

      <Stack spacing={1.5}>
        {workflows.map((w) => (
          <Paper key={w.name} elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <AccountTreeIcon sx={{ fontSize: 18, color: '#60a5fa', mt: 0.25 }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={600}
                      sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main', textDecoration: 'underline' } }}
                      onClick={() => navigate(`/workflows/${w.name}`)}>
                      {w.name}
                    </Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{w.version}</Typography>
                    <Chip label={w.status} size="small" color="success" variant="outlined"
                      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
                  </Box>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary"
                    display="block" sx={{ mt: 0.5 }}>
                    domain: {w.domain} · queue: {w.task_queue} · hash: {w.spec_hash}
                  </Typography>
                </Box>
              </Box>
              <Button size="small" variant="outlined"
                startIcon={<PlayArrowIcon sx={{ fontSize: 13 }} />}
                onClick={() => navigate(`/workflows/compose/${w.name}`)}>
                Open Composer
              </Button>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
