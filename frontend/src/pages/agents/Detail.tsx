import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, IconButton,
  Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { builderApi, type DeploymentRecord } from '../../api/builder'
import { useAuth } from '../../context/AuthContext'
import DeploymentThread from '../../components/DeploymentThread'
import type { AgentRecord } from '../../types'

const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending: 'warning', approved: 'success', rejected: 'error',
  bypassed: 'info', changes_requested: 'warning',
  deploying: 'warning', deployed: 'success', failed: 'error',
}

function fmt(ts?: string | null) {
  return ts ? ts.slice(0, 19).replace('T', ' ') : '—'
}

function DeploymentCard({ rec }: { rec: DeploymentRecord }) {
  const [open, setOpen] = useState(false)

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
      <Box
        sx={{ p: 2, cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
        onClick={() => setOpen(v => !v)}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">
              {rec.deployment_id}
            </Typography>
            <Typography variant="body2" fontWeight={600}>v{rec.target_version}</Typography>
            <Chip size="small" label={rec.approval_status.replace('_', ' ')}
              color={STATUS_COLOR[rec.approval_status] ?? 'default'}
              sx={{ height: 18, fontSize: '0.65rem' }} />
            <Chip size="small" label={rec.deploy_status} variant="outlined"
              color={STATUS_COLOR[rec.deploy_status] ?? 'default'}
              sx={{ height: 18, fontSize: '0.65rem' }} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary">{fmt(rec.requested_at)}</Typography>
            {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          Requested by {rec.requested_by}
          {rec.approved_by && ` · ${rec.approval_status === 'rejected' ? 'Rejected' : 'Reviewed'} by ${rec.approved_by}`}
          {rec.service_account_id && ` · NHI: ${rec.service_account_id}`}
        </Typography>
      </Box>

      <Collapse in={open}>
        <Divider />
        <Box sx={{ p: 2, bgcolor: 'action.hover' }}>
          <Typography variant="caption" color="text.secondary" fontWeight={700} display="block" sx={{ mb: 1.5, letterSpacing: '0.06em' }}>
            APPROVAL THREAD
          </Typography>
          <DeploymentThread record={rec} />
          {rec.spec_hash && (
            <Typography variant="caption" color="text.disabled" display="block" sx={{ mt: 2 }}>
              spec {rec.spec_hash.slice(0, 30)}…
              {rec.code_hash ? ` · code ${rec.code_hash.slice(0, 20)}…` : ''}
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

function OverviewTab({ agent }: { agent: AgentRecord }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { role } = useAuth()

  const deployMut = useMutation({
    mutationFn: (): Promise<AgentRecord | DeploymentRecord> => {
      if (role === 'builder') return builderApi.submitDeployRequest(agent.name)
      if (role === 'platform_admin') return builderApi.deployDirect(agent.name)
      return builderApi.deployAgent(agent.name)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent', agent.name] }),
  })

  const delMut = useMutation({
    mutationFn: () => builderApi.deleteAgent(agent.name),
    onSuccess: () => navigate('/agents'),
  })

  const deployLabel = role === 'builder' ? 'Submit for Approval'
    : role === 'platform_admin' ? 'Redeploy (bypass)' : 'Redeploy'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 1 }}>
          {[
            ['Status', <Chip key="s" label={agent.status} size="small"
              color={agent.status === 'deployed' ? 'success' : 'default'}
              variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />],
            ['Version', `v${agent.version}`],
            ['Owner', agent.owner],
            ['Deployed', fmt(agent.deployed_at)],
            ['Endpoint', agent.endpoint || '—'],
            ['Spec hash', agent.spec_hash?.slice(0, 24) + '…'],
          ].map(([k, v]) => (
            <React.Fragment key={String(k)}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{k}</Typography>
              {typeof v === 'string'
                ? <Typography variant="caption" fontFamily="monospace">{v}</Typography>
                : v}
            </React.Fragment>
          ))}
        </Box>
        {agent.service_account_id && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" fontWeight={600}>NHI</Typography>
            <Chip label={agent.service_account_id} size="small"
              sx={{ fontFamily: 'monospace', bgcolor: '#4a148c', color: '#ce93d8', fontSize: '0.65rem' }} />
          </Box>
        )}
      </Paper>

      {deployMut.isSuccess && 'deployment_id' in (deployMut.data as object) && (
        <Alert severity="info" sx={{ fontSize: '0.8rem' }}>
          Request submitted: {(deployMut.data as DeploymentRecord).deployment_id}
        </Alert>
      )}
      {deployMut.isSuccess && !('deployment_id' in (deployMut.data as object)) && (
        <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
          Redeployed — new NHI: {(deployMut.data as AgentRecord).service_account_id}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained"
          startIcon={deployMut.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlineIcon />}
          onClick={() => deployMut.mutate()} disabled={deployMut.isPending}>
          {deployLabel}
        </Button>
        <Button size="small" variant="outlined" color="primary"
          onClick={() => navigate(`/chat?agent=${agent.name}`)}>
          Test in Chat
        </Button>
        <Button size="small" variant="outlined" color="error"
          onClick={() => delMut.mutate()} disabled={delMut.isPending}>
          Undeploy
        </Button>
      </Box>
    </Stack>
  )
}

function DeploymentsTab({ name }: { name: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['agent-deployments', name],
    queryFn: () => builderApi.listAgentDeployments(name),
    refetchInterval: 5000,
  })
  const records = data?.deployments ?? []

  if (isLoading) return <CircularProgress size={20} />
  if (!records.length) return (
    <Typography variant="body2" color="text.secondary">No deployment history yet.</Typography>
  )

  return (
    <Stack spacing={1.5}>
      {records.map(r => <DeploymentCard key={r.deployment_id} rec={r} />)}
    </Stack>
  )
}

export default function AgentDetail() {
  const { name = '' } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'overview' | 'deployments'>('overview')

  const { data: agent, isLoading, error } = useQuery({
    queryKey: ['agent', name],
    queryFn: () => builderApi.getAgent(name),
  })

  return (
    <Box sx={{ p: 4, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Tooltip title="Back to registry">
          <IconButton size="small" onClick={() => navigate('/agents')}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <SmartToyIcon sx={{ color: 'primary.main', fontSize: 20 }} />
        <Typography variant="h6" fontWeight={600}>{name}</Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Overview" />
        <Tab value="deployments" label="Deployments"
          icon={<HistoryIcon sx={{ fontSize: 14 }} />} iconPosition="end" />
      </Tabs>

      {isLoading && <CircularProgress size={20} />}
      {error && <Alert severity="error">Agent not found or not deployed</Alert>}

      {agent && tab === 'overview' && <OverviewTab agent={agent} />}
      {tab === 'deployments' && <DeploymentsTab name={name} />}
    </Box>
  )
}
