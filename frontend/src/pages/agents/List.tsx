import React from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box, Chip, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

function StatusBadge({ status }: { status: string }) {
  return (
    <Chip
      label={status}
      size="small"
      color={status === 'deployed' ? 'success' : 'default'}
      variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }}
    />
  )
}

export default function AgentList() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents'], queryFn: builderApi.listAgents })
  const del = useMutation({
    mutationFn: builderApi.deleteAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  const agents: AgentRecord[] = data?.agents ?? []

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>Agent Registry</Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['agents'] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      {agents.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary">No agents registered. Go to Build to deploy one.</Typography>
      )}

      <Stack spacing={1.5}>
        {agents.map((a) => (
          <Paper key={a.name} elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <SmartToyIcon sx={{ fontSize: 18, color: 'primary.main', mt: 0.25 }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={600}>{a.name}</Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{a.version}</Typography>
                    <StatusBadge status={a.status} />
                  </Box>
                  {a.service_account_id && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">NHI:</Typography>
                      <Chip
                        label={a.service_account_id}
                        size="small"
                        sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', height: 18, fontSize: '0.65rem' }}
                      />
                    </Box>
                  )}
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    owner: {a.owner} · deployed: {a.deployed_at?.slice(0, 16)}
                  </Typography>
                </Box>
              </Box>
              <Tooltip title="Undeploy agent">
                <IconButton size="small" onClick={() => del.mutate(a.name)} sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
