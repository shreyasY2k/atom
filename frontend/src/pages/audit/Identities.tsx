import React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Box, Chip, IconButton, Paper, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material'
import BadgeIcon from '@mui/icons-material/Badge'
import RefreshIcon from '@mui/icons-material/Refresh'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

export default function Identities() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['agents'], queryFn: () => builderApi.listAgents() })
  const agents: AgentRecord[] = data?.agents ?? []

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BadgeIcon sx={{ color: 'primary.main' }} />
          <Typography variant="h6" fontWeight={600}>Non-Human Identities</Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['agents'] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3, maxWidth: 560 }}>
        Every deployed agent is issued a LiteLLM virtual key at deploy time.
        The key becomes the agent's service-account identity for all LLM and tool calls.
        Distinct from the human creator (owner). Revoked when the agent is undeployed.
      </Typography>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      {agents.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary">No agents deployed. Deploy one via the Builder.</Typography>
      )}

      <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: 'action.hover' }}>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Agent</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Service Account ID</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Owner</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Deployed</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.name} hover>
                <TableCell>
                  <Typography variant="body2" fontWeight={500}>{a.name}</Typography>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{a.version}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={a.service_account_id || '—'}
                    size="small"
                    sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', fontSize: '0.65rem', height: 20 }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary">{a.owner || '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary">{a.deployed_at?.slice(0, 16) || '—'}</Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    label={a.status}
                    size="small"
                    color={a.status === 'deployed' ? 'success' : 'default'}
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}
