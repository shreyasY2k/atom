import React, { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Divider, IconButton,
  Paper, Stack, Tab, Tabs, Tooltip, Typography,
} from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { builderApi, type DeploymentRecord } from '../../api/builder'
import { workflowApi } from '../../api/workflow'
import { useAuth, getActorHeader } from '../../context/AuthContext'
import DeploymentThread from '../../components/DeploymentThread'
import type { WorkflowRecord } from '../../types'

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
          {rec.approved_by && ` · Reviewed by ${rec.approved_by}`}
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
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  )
}

function OverviewTab({ workflow, name }: { workflow: WorkflowRecord; name: string }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { role } = useAuth()

  const submitMut = useMutation({
    mutationFn: (): Promise<unknown> => {
      if (role === 'builder') {
        return fetch(`http://localhost:8081/workflows/${name}/deploy-request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Atom-Actor': getActorHeader() },
          body: JSON.stringify({ notes: '' }),
        }).then(r => r.json())
      }
      return workflowApi.registerWorkflow(name)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', name] })
      qc.invalidateQueries({ queryKey: ['workflow-deployments', name] })
    },
  })

  const submitLabel = role === 'builder' ? 'Submit for Approval' : 'Re-register'

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 1 }}>
          {[
            ['Status', <Chip key="s" label={workflow.status} size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />],
            ['Version', `v${workflow.version}`],
            ['Domain', workflow.domain],
            ['Task queue', workflow.task_queue],
            ['Registered', fmt(workflow.registered_at)],
            ['Spec hash', workflow.spec_hash?.slice(0, 24) + '…'],
          ].map(([k, v]) => (
            <React.Fragment key={String(k)}>
              <Typography variant="caption" color="text.secondary" fontWeight={600}>{k}</Typography>
              {typeof v === 'string'
                ? <Typography variant="caption" fontFamily="monospace">{v}</Typography>
                : v}
            </React.Fragment>
          ))}
        </Box>
      </Paper>

      {submitMut.isSuccess && (
        <Alert severity={role === 'builder' ? 'info' : 'success'} sx={{ fontSize: '0.8rem' }}>
          {role === 'builder' ? `Request submitted` : 'Workflow re-registered successfully'}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained"
          startIcon={submitMut.isPending ? <CircularProgress size={12} color="inherit" /> : undefined}
          onClick={() => submitMut.mutate()} disabled={submitMut.isPending}>
          {submitLabel}
        </Button>
        <Button size="small" variant="outlined" onClick={() => navigate(`/workflows/compose/${name}`)}>
          Open Composer
        </Button>
        <Button size="small" variant="outlined" onClick={() => navigate('/workflows/runs')}>
          View Runs
        </Button>
      </Box>
    </Stack>
  )
}

function DeploymentsTab({ name }: { name: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-deployments', name],
    queryFn: () => builderApi.listDeployments({ target_type: 'workflow', target_name: name }),
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

export default function WorkflowDetail() {
  const { name = '' } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'overview' | 'deployments'>('overview')

  const { data: workflow, isLoading, error } = useQuery({
    queryKey: ['workflow', name],
    queryFn: () => workflowApi.getWorkflow(name),
  })

  return (
    <Box sx={{ p: 4, maxWidth: 860 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Tooltip title="Back to registry">
          <IconButton size="small" onClick={() => navigate('/workflows')}>
            <ArrowBackIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <AccountTreeIcon sx={{ color: '#60a5fa', fontSize: 20 }} />
        <Typography variant="h6" fontWeight={600}>{name}</Typography>
      </Box>

      <Tabs value={tab} onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="overview" label="Overview" />
        <Tab value="deployments" label="Deployments"
          icon={<HistoryIcon sx={{ fontSize: 14 }} />} iconPosition="end" />
      </Tabs>

      {isLoading && <CircularProgress size={20} />}
      {error && <Alert severity="warning">Workflow not registered yet</Alert>}

      {workflow && tab === 'overview' && <OverviewTab workflow={workflow} name={name} />}
      {tab === 'deployments' && <DeploymentsTab name={name} />}
    </Box>
  )
}
