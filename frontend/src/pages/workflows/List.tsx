import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Box, Button, Chip, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import RefreshIcon from '@mui/icons-material/Refresh'
import { workflowApi } from '../../api/workflow'
import type { WorkflowRecord } from '../../types'

export default function WorkflowList() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({ queryKey: ['workflows'], queryFn: workflowApi.listWorkflows })
  const reg = useMutation({
    mutationFn: (name: string) => workflowApi.registerWorkflow(name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflows'] }),
  })

  const workflows: WorkflowRecord[] = data?.workflows ?? []

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>Workflow Registry</Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['workflows'] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      {workflows.length === 0 && !isLoading && (
        <Box>
          <Typography variant="body2" color="text.secondary" gutterBottom>No workflows registered.</Typography>
          <Button
            size="small"
            variant="text"
            color="primary"
            onClick={() => reg.mutate('ats-asset-transfer')}
          >
            Register ATS Asset Transfer
          </Button>
        </Box>
      )}

      <Stack spacing={1.5}>
        {workflows.map((w) => (
          <Paper key={w.name} elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <AccountTreeIcon sx={{ fontSize: 18, color: '#60a5fa', mt: 0.25 }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={600}>{w.name}</Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{w.version}</Typography>
                    <Chip label={w.status} size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
                  </Box>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    domain: {w.domain} · queue: {w.task_queue} · hash: {w.spec_hash}
                  </Typography>
                </Box>
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PlayArrowIcon sx={{ fontSize: 13 }} />}
                onClick={() => navigate(`/workflows/compose/${w.name}`)}
              >
                Open Composer
              </Button>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
