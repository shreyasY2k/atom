import React, { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { extractErrorMessage } from '../../utils/errors'
import {
  Alert, Box, Button, Chip, CircularProgress, Collapse, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Paper, Stack, Tab, Tabs, TextField,
  Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SmartToyIcon from '@mui/icons-material/SmartToy'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { builderApi, type DeploymentRecord } from '../../api/builder'
import DeploymentThread from '../../components/DeploymentThread'

const APPROVAL_STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  bypassed: 'info',
  changes_requested: 'warning',
}

const DEPLOY_STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default'> = {
  pending: 'default',
  deploying: 'warning',
  deployed: 'success',
  failed: 'error',
  undeployed: 'default',
}

function shortId(id: string) {
  return id.slice(0, 14)
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

interface ActionDialogProps {
  record: DeploymentRecord
  action: 'approve' | 'reject' | 'changes'
  onClose: () => void
}

function ActionDialog({ record, action, onClose }: ActionDialogProps) {
  const qc = useQueryClient()
  const [text, setText] = useState('')

  const titles = { approve: 'Approve deployment', reject: 'Reject deployment', changes: 'Request changes' }
  const labels = { approve: 'Notes (optional)', reject: 'Reason (required)', changes: 'Comments for requester' }
  const buttonLabels = { approve: 'Approve', reject: 'Reject', changes: 'Request Changes' }
  const buttonColors: Record<string, 'success' | 'error' | 'warning'> = { approve: 'success', reject: 'error', changes: 'warning' }

  const mut = useMutation({
    mutationFn: () => {
      if (action === 'approve') return builderApi.approveDeployment(record.deployment_id, text)
      if (action === 'reject') return builderApi.rejectDeployment(record.deployment_id, text)
      return builderApi.requestChanges(record.deployment_id, text)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deployments'] })
      onClose()
    },
  })

  const disabled = action === 'reject' && !text.trim()

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{titles[action]}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {record.target_type === 'agent' ? '🤖' : '🔀'} <strong>{record.target_name}</strong> v{record.target_version}
          {' '}· requested by <code>{record.requested_by}</code>
        </Typography>
        {record.notes && (
          <Alert severity="info" sx={{ mb: 2, fontSize: '0.8rem' }}>
            <strong>Requester note:</strong> {record.notes}
          </Alert>
        )}
        {mut.isError && (
          <Alert severity="error" sx={{ mb: 2 }}>{extractErrorMessage(mut.error)}</Alert>
        )}
        <TextField
          label={labels[action]}
          multiline rows={3}
          fullWidth size="small"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={action === 'approve' ? 'looks good' : action === 'reject' ? 'reason for rejection' : 'what needs to change'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">Cancel</Button>
        <Button
          variant="contained"
          color={buttonColors[action]}
          size="small"
          disabled={disabled || mut.isPending}
          startIcon={mut.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          onClick={() => mut.mutate()}
        >
          {buttonLabels[action]}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RequestCard({ rec, showActions }: { rec: DeploymentRecord; showActions: boolean }) {
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'changes' | null>(null)
  const [threadOpen, setThreadOpen] = useState(false)
  const Icon = rec.target_type === 'agent' ? SmartToyIcon : AccountTreeIcon

  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
          <Icon sx={{ fontSize: 18, color: 'primary.main', mt: 0.25, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight={600}>{rec.target_name}</Typography>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary">v{rec.target_version}</Typography>
              <Chip size="small" label={rec.approval_status.replace('_', ' ')}
                color={APPROVAL_STATUS_COLOR[rec.approval_status] ?? 'default'}
                sx={{ height: 18, fontSize: '0.65rem' }} />
              <Chip size="small" label={rec.deploy_status}
                color={DEPLOY_STATUS_COLOR[rec.deploy_status] ?? 'default'}
                variant="outlined" sx={{ height: 18, fontSize: '0.65rem' }} />
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
              {shortId(rec.deployment_id)} · requested by <code>{rec.requested_by}</code> · {timeAgo(rec.requested_at)}
            </Typography>
            {rec.notes && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                "{rec.notes}"
              </Typography>
            )}
            {rec.approved_by && (
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                {rec.approval_status === 'rejected' ? 'Rejected' : rec.approval_status === 'changes_requested' ? 'Changes requested' : 'Approved'} by <code>{rec.approved_by}</code>
              </Typography>
            )}
            {rec.deploy_error && (
              <Alert severity="error" sx={{ mt: 0.5, py: 0, fontSize: '0.75rem' }}>{rec.deploy_error}</Alert>
            )}
            {rec.service_account_id && (
              <Typography variant="caption" fontFamily="monospace" color="text.secondary" display="block" sx={{ mt: 0.25 }}>
                NHI: {rec.service_account_id}
              </Typography>
            )}
          </Box>
        </Box>

        {showActions && rec.approval_status === 'pending' && (
          <Box sx={{ display: 'flex', gap: 0.75, flexShrink: 0 }}>
            <Button size="small" variant="contained" color="success"
              startIcon={<CheckCircleOutlineIcon fontSize="small" />}
              onClick={() => setDialog('approve')} sx={{ fontSize: '0.7rem', py: 0.5 }}>
              Approve
            </Button>
            <Button size="small" variant="outlined" color="warning"
              startIcon={<EditNoteIcon fontSize="small" />}
              onClick={() => setDialog('changes')} sx={{ fontSize: '0.7rem', py: 0.5 }}>
              Changes
            </Button>
            <Button size="small" variant="outlined" color="error"
              startIcon={<CancelOutlinedIcon fontSize="small" />}
              onClick={() => setDialog('reject')} sx={{ fontSize: '0.7rem', py: 0.5 }}>
              Reject
            </Button>
          </Box>
        )}
      </Box>

      {/* Approval thread — expandable */}
      <Box
        sx={{ px: 2, pb: 0.5, display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', color: 'text.secondary', '&:hover': { color: 'primary.main' } }}
        onClick={() => setThreadOpen(v => !v)}
      >
        {threadOpen ? <ExpandLessIcon sx={{ fontSize: 14 }} /> : <ExpandMoreIcon sx={{ fontSize: 14 }} />}
        <Typography variant="caption">
          {threadOpen ? 'Hide thread' : 'View approval thread'}
        </Typography>
      </Box>
      <Collapse in={threadOpen}>
        <Divider />
        <Box sx={{ px: 2, py: 1.5, bgcolor: 'action.hover' }}>
          <DeploymentThread record={rec} />
        </Box>
      </Collapse>

      {dialog && (
        <ActionDialog record={rec} action={dialog} onClose={() => setDialog(null)} />
      )}
    </Paper>
  )
}

export default function Approvals() {
  const [tab, setTab] = useState<'pending' | 'resolved'>('pending')
  const { data, isLoading } = useQuery({
    queryKey: ['deployments', tab],
    queryFn: () => builderApi.listDeployments(
      tab === 'pending'
        ? { approval_status: 'pending' }
        : {}
    ),
    refetchInterval: 5000,
  })

  const records = (data?.deployments ?? []).filter(r =>
    tab === 'pending'
      ? r.approval_status === 'pending'
      : r.approval_status !== 'pending'
  )

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', maxWidth: { sm: '100%', md: '100%', lg: 1200 }, mx: 'auto' }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>Approvals</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review deployment requests. Every approve/reject is recorded in the audit trail.
      </Typography>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Tab value="pending" label="Pending" />
        <Tab value="resolved" label="Resolved" />
      </Tabs>

      {isLoading && <CircularProgress size={20} />}

      {!isLoading && records.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {tab === 'pending' ? 'No pending requests.' : 'No resolved requests yet.'}
        </Typography>
      )}

      <Stack spacing={1.5}>
        {records.map(r => (
          <RequestCard key={r.deployment_id} rec={r} showActions={tab === 'pending'} />
        ))}
      </Stack>
    </Box>
  )
}
