import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box, Chip, IconButton, Paper, Stack, Tooltip, Typography,
  TextField, InputAdornment,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import RefreshIcon from '@mui/icons-material/Refresh'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import HistoryIcon from '@mui/icons-material/History'
import SearchIcon from '@mui/icons-material/Search'
import { builderApi } from '../../api/builder'
import type { AgentRecord } from '../../types'

function StatusBadge({ status }: { status: string }) {
  const color = status === 'deployed' ? 'success' : status === 'deploying' ? 'warning' : 'default'
  return (
    <Chip label={status} size="small" color={color} variant="outlined"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
  )
}

function DomainBadge({ domain, subdomain }: { domain?: string; subdomain?: string }) {
  if (!domain) return null
  const label = subdomain ? `${domain} / ${subdomain}` : domain
  return (
    <Chip label={label} size="small" variant="outlined" color="primary"
      sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
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
    queryFn: () => builderApi.listDomains(),
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
    ? allAgents.filter(a =>
        a.name.includes(search.toLowerCase()) ||
        (a.description || '').toLowerCase().includes(search.toLowerCase()))
    : allAgents

  const statusOptions = [
    { value: '', label: 'All' },
    { value: 'deployed', label: 'Deployed' },
    { value: 'deploying', label: 'Deploying' },
    { value: 'undeployed', label: 'Undeployed' },
  ]

  const activeFilters = [domainFilter, statusFilter].filter(Boolean).length

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Agent Registry</Typography>
          <Typography variant="caption" color="text.secondary">
            {allAgents.length} agent{allAgents.length !== 1 ? 's' : ''}
            {activeFilters > 0 && ` · ${activeFilters} filter${activeFilters > 1 ? 's' : ''} active`}
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['agents'] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Search */}
      <TextField
        size="small"
        placeholder="Search agents by name or description…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        fullWidth
        sx={{ mb: 2 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
        }}
      />

      {/* Domain filter chips */}
      {domains.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ mr: 1, fontWeight: 600 }}>DOMAIN</Typography>
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, flexWrap: 'wrap' }}>
            <Chip
              label="All"
              size="small"
              onClick={() => setDomainFilter('')}
              variant={domainFilter === '' ? 'filled' : 'outlined'}
              color={domainFilter === '' ? 'primary' : 'default'}
              sx={{ cursor: 'pointer' }}
            />
            {domains.map(d => (
              <Chip
                key={d.domain}
                label={d.domain}
                size="small"
                onClick={() => setDomainFilter(domainFilter === d.domain ? '' : d.domain)}
                variant={domainFilter === d.domain ? 'filled' : 'outlined'}
                color={domainFilter === d.domain ? 'primary' : 'default'}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Status filter chips */}
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ mr: 1, fontWeight: 600 }}>STATUS</Typography>
        <Box component="span" sx={{ display: 'inline-flex', gap: 0.75 }}>
          {statusOptions.map(s => (
            <Chip
              key={s.value}
              label={s.label}
              size="small"
              onClick={() => setStatusFilter(statusFilter === s.value ? '' : s.value)}
              variant={statusFilter === s.value ? 'filled' : 'outlined'}
              color={statusFilter === s.value && s.value ? 'success' : 'default'}
              sx={{ cursor: 'pointer' }}
            />
          ))}
        </Box>
        {(domainFilter || statusFilter || search) && (
          <Chip
            label="Clear all"
            size="small"
            variant="outlined"
            onDelete={() => { setDomainFilter(''); setStatusFilter(''); setSearch('') }}
            sx={{ ml: 1, fontSize: '0.65rem' }}
          />
        )}
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
      {!isLoading && agents.length === 0 && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {domainFilter || statusFilter || search
              ? `No agents match the current filters${domainFilter ? ` (domain: ${domainFilter})` : ''}${statusFilter ? ` (status: ${statusFilter})` : ''}.`
              : 'No agents registered. Go to Build to deploy one.'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.25}>
        {agents.map((a) => (
          <Paper
            key={a.name}
            elevation={0}
            variant="outlined"
            sx={{ p: 2, borderRadius: 2, cursor: 'pointer', transition: 'border-color 0.15s', '&:hover': { borderColor: 'primary.main' } }}
            onClick={() => navigate(`/agents/${a.name}`)}
          >
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
