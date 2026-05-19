import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box, Chip, IconButton, Paper, Stack, Tooltip, Typography,
  TextField, MenuItem, InputAdornment,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import HistoryIcon from '@mui/icons-material/History'
import SearchIcon from '@mui/icons-material/Search'
import FilterListIcon from '@mui/icons-material/FilterList'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

function StatusBadge({ status }: { status: string }) {
  return (
    <Chip label={status} size="small"
      color={status === 'deployed' ? 'success' : 'default'} variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
  )
}

function DomainBadge({ domain, subdomain }: { domain?: string; subdomain?: string }) {
  if (!domain) return null
  const label = subdomain ? `${domain} / ${subdomain}` : domain
  return (
    <Chip label={label} size="small" variant="outlined" color="primary"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace', opacity: 0.85 }} />
  )
}

export default function AgentList() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: domainsData } = useQuery({
    queryKey: ['domains'],
    queryFn: builderApi.listDomains,
    staleTime: 60_000,
  })
  const domains = domainsData?.domains ?? []

  const { data, isLoading } = useQuery({
    queryKey: ['agents', domainFilter, statusFilter],
    queryFn: () => builderApi.listAgents({
      domain: domainFilter || undefined,
      status: statusFilter || undefined,
    }),
  })
  const del = useMutation({
    mutationFn: builderApi.deleteAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  })

  const allAgents: AgentRecord[] = data?.agents ?? []
  const agents = search
    ? allAgents.filter(a => a.name.includes(search.toLowerCase()) || (a.description || '').toLowerCase().includes(search.toLowerCase()))
    : allAgents

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Agent Registry</Typography>
          <Typography variant="caption" color="text.secondary">{allAgents.length} agents total</Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['agents'] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <TextField
          size="small"
          placeholder="Search agents…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ minWidth: 200 }}
          InputProps={{
            startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
          }}
        />
        <TextField
          select size="small" label="Domain"
          value={domainFilter} onChange={e => setDomainFilter(e.target.value)}
          sx={{ minWidth: 140 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><FilterListIcon sx={{ fontSize: 14 }} /></InputAdornment> }}
        >
          <MenuItem value="">All domains</MenuItem>
          {domains.map(d => <MenuItem key={d.domain} value={d.domain}>{d.domain}</MenuItem>)}
        </TextField>
        <TextField
          select size="small" label="Status"
          value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="">All statuses</MenuItem>
          <MenuItem value="deployed">Deployed</MenuItem>
          <MenuItem value="deploying">Deploying</MenuItem>
          <MenuItem value="undeployed">Undeployed</MenuItem>
        </TextField>
        {(domainFilter || statusFilter || search) && (
          <Chip label="Clear filters" size="small" onDelete={() => { setDomainFilter(''); setStatusFilter(''); setSearch('') }} sx={{ alignSelf: 'center' }} />
        )}
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      {agents.length === 0 && !isLoading && (
        <Typography variant="body2" color="text.secondary">
          {domainFilter || statusFilter || search ? 'No agents match your filters.' : 'No agents registered. Go to Build to deploy one.'}
        </Typography>
      )}

      <Stack spacing={1.25}>
        {agents.map((a) => (
          <Paper key={a.name} elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2, '&:hover': { borderColor: 'primary.main' }, transition: 'border-color 0.15s', cursor: 'pointer' }}
            onClick={() => navigate(`/agents/${a.name}`)}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <SmartToyIcon sx={{ fontSize: 18, color: 'primary.main', mt: 0.25, flexShrink: 0 }} />
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body2" fontWeight={600}>{a.name}</Typography>
                    <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{a.version}</Typography>
                    <StatusBadge status={a.status} />
                    <DomainBadge domain={a.domain} subdomain={a.subdomain} />
                  </Box>
                  {a.description && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {a.description.slice(0, 120)}{a.description.length > 120 ? '…' : ''}
                    </Typography>
                  )}
                  {a.service_account_id && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">NHI:</Typography>
                      <Chip label={a.service_account_id} size="small"
                        sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', height: 18, fontSize: '0.65rem' }} />
                    </Box>
                  )}
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                    owner: {a.owner} · deployed: {a.deployed_at?.slice(0, 16)}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5 }} onClick={e => e.stopPropagation()}>
                <Tooltip title="Deployment history">
                  <IconButton size="small" onClick={() => navigate(`/agents/${a.name}?tab=deployments`)}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' } }}>
                    <HistoryIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Undeploy agent">
                  <IconButton size="small" onClick={() => del.mutate(a.name)}
                    sx={{ color: 'text.secondary', '&:hover': { color: 'error.main' } }}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}
