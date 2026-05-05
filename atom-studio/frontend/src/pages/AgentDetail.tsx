import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import IconButton from '@mui/material/IconButton'
import RefreshIcon from '@mui/icons-material/Refresh'
import DeleteIcon from '@mui/icons-material/Delete'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import TerminalIcon from '@mui/icons-material/Terminal'
import MessageIcon from '@mui/icons-material/Message'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckIcon from '@mui/icons-material/Check'
import api from '@/lib/api'
import { useSnackbar } from '@/hooks/use-snackbar'
import { TokenRevealModal } from '@/components/app/TokenRevealModal'

interface AgentDetailProps {
  domainId: string
  agentId: string
}

type AgentStatus = 'draft' | 'pending_approval' | 'deployed' | 'suspended'
type DeploymentStatus = 'pending' | 'approved' | 'rejected' | 'deployed' | 'failed' | 'rolled_back'

interface Deployment {
  id: string
  version: number
  status: DeploymentStatus
  manifest_json: { image?: string; git_sha?: string; message?: string } | null
  deployed_at: string | null
  created_at: string
}

const DEPLOY_COLOR: Record<DeploymentStatus, 'default' | 'primary' | 'warning' | 'error' | 'success'> = {
  pending: 'default',
  approved: 'warning',
  rejected: 'error',
  deployed: 'success',
  failed: 'error',
  rolled_back: 'default',
}

interface Agent {
  id: string
  name: string
  description: string | null
  domain_id: string
  status: AgentStatus
  allowed_models: string[]
  rpm_limit: number
  tpm_limit: number
  hitl_timeout_seconds: number
  hitl_fallback: string
  litellm_agent_id: string | null
  created_at: string
  updated_at: string
  tools: { id: string; name: string; description: string | null }[]
  skills: { id: string; name: string; description: string | null }[]
}

const STATUS_COLOR: Record<AgentStatus, 'default' | 'primary' | 'warning' | 'error'> = {
  draft: 'default',
  pending_approval: 'warning',
  deployed: 'primary',
  suspended: 'error',
}

export function AgentDetail({ domainId, agentId }: AgentDetailProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const { state: snack, show: showSnack, hide: hideSnack } = useSnackbar()

  function copyToClipboard(value: string, label: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedId(label)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ['agent', domainId, agentId],
    queryFn: async () => (await api.get(`/api/domains/${domainId}/agents/${agentId}`)).data,
  })

  const { data: deployments = [] } = useQuery<Deployment[]>({
    queryKey: ['deployments', agentId],
    queryFn: async () => (await api.get(`/api/deployments/${agentId}`)).data,
    enabled: !!agentId,
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/domains/${domainId}/agents/${agentId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      navigate({ to: '/agents' })
    },
    onError: () => showSnack('Failed to suspend agent.', 'error'),
  })

  const regenMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/api/domains/${domainId}/agents/${agentId}/regenerate-token`)
      return data.token as string
    },
    onSuccess: token => {
      setConfirmRegen(false)
      setNewToken(token)
    },
    onError: () => showSnack('Failed to regenerate token.', 'error'),
  })

  if (isLoading) return <Typography variant="body2" color="text.secondary">Loading…</Typography>
  if (!agent) return <Typography variant="body2" color="error">Agent not found.</Typography>

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 680 }}>
      {/* Back link */}
      <Box
        component={Link}
        to="/agents"
        sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', textDecoration: 'none', fontSize: 14, '&:hover': { color: 'text.primary' } }}
      >
        <ChevronLeftIcon fontSize="small" /> Agents
      </Box>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>{agent.name}</Typography>
          {agent.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{agent.description}</Typography>
          )}
        </Box>
        <Chip
          label={agent.status.replace('_', ' ')}
          color={STATUS_COLOR[agent.status]}
          size="small"
          sx={{ textTransform: 'capitalize' }}
        />
      </Box>

      {/* Config cards */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>
              Allowed Models
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {(agent.allowed_models ?? []).map(m => (
                <Chip key={m} label={m} size="small" />
              ))}
            </Box>
          </CardContent>
        </Card>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>Rate Limits</Typography>
              <Typography variant="body2">RPM: <strong>{agent.rpm_limit}</strong></Typography>
              <Typography variant="body2">TPM: <strong>{agent.tpm_limit.toLocaleString()}</strong></Typography>
            </CardContent>
          </Card>
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>HITL</Typography>
              <Typography variant="body2">Timeout: <strong>{agent.hitl_timeout_seconds}s</strong></Typography>
              <Typography variant="body2">Fallback: <strong>{agent.hitl_fallback}</strong></Typography>
            </CardContent>
          </Card>
        </Box>

        {agent.tools.length > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>Tools</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {agent.tools.map(t => <Chip key={t.id} label={t.name} size="small" variant="outlined" />)}
              </Box>
            </CardContent>
          </Card>
        )}

        {agent.skills.length > 0 && (
          <Card variant="outlined">
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>Skills</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {agent.skills.map(s => <Chip key={s.id} label={s.name} size="small" variant="outlined" />)}
              </Box>
            </CardContent>
          </Card>
        )}

        <Card variant="outlined">
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }} gutterBottom>Metadata</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 13 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 80 }}>Domain ID:</Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{domainId}</Typography>
                <IconButton size="small" onClick={() => copyToClipboard(domainId, 'domain')}>
                  {copiedId === 'domain' ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                </IconButton>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: 80 }}>Agent ID:</Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{agentId}</Typography>
                <IconButton size="small" onClick={() => copyToClipboard(agentId, 'agent')}>
                  {copiedId === 'agent' ? <CheckIcon sx={{ fontSize: 14, color: 'success.main' }} /> : <ContentCopyIcon sx={{ fontSize: 14 }} />}
                </IconButton>
              </Box>
              <Typography variant="caption" color="text.secondary">
                LiteLLM ID: <code>{agent.litellm_agent_id ?? '—'}</code>
              </Typography>
              <Typography variant="caption">Created: {format(new Date(agent.created_at), 'MMM d, yyyy HH:mm')}</Typography>
              <Typography variant="caption">Updated: {format(new Date(agent.updated_at), 'MMM d, yyyy HH:mm')}</Typography>
            </Box>
          </CardContent>
        </Card>

        {deployments.length > 0 && (
          <Card variant="outlined">
            <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
              <Typography variant="caption" color="text.secondary" sx={{ p: 2, display: 'block' }}>
                Deployment History
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ width: 48 }}>#</TableCell>
                    <TableCell>Image</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Deployed at</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {deployments.map(d => (
                    <TableRow key={d.id}>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{d.version}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {d.manifest_json?.image ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={d.status.replace('_', ' ')}
                          color={DEPLOY_COLOR[d.status]}
                          size="small"
                          sx={{ textTransform: 'capitalize' }}
                        />
                      </TableCell>
                      <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                        {d.deployed_at ? format(new Date(d.deployed_at), 'MMM d, yyyy HH:mm') : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', pt: 1 }}>
        <Button
          variant="outlined"
          component={Link}
          to="/domains/$domainId/agents/$agentId/conversations"
          params={{ domainId, agentId } as never}
          startIcon={<MessageIcon />}
        >
          Conversations
        </Button>
        <Button
          variant="outlined"
          component={Link}
          to="/domains/$domainId/agents/$agentId/logs"
          params={{ domainId, agentId } as never}
          startIcon={<TerminalIcon />}
        >
          Live Logs
        </Button>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={() => setConfirmRegen(true)}
          disabled={agent.status === 'suspended'}
        >
          Regenerate Token
        </Button>
        <Button
          variant="contained"
          color="error"
          startIcon={<DeleteIcon />}
          onClick={() => setConfirmDelete(true)}
          disabled={agent.status === 'suspended'}
        >
          Suspend
        </Button>
      </Box>

      {/* Confirm suspend dialog */}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <DialogTitle>Suspend agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will revoke the LiteLLM virtual key and set status to suspended. The agent JWT
            will stop working immediately.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Suspending…' : 'Suspend'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Confirm regen dialog */}
      <Dialog open={confirmRegen} onClose={() => setConfirmRegen(false)}>
        <DialogTitle>Regenerate token?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The current token will be revoked immediately and will stop working within seconds.
            You will receive a new token shown once.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRegen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => regenMutation.mutate()}
            disabled={regenMutation.isPending}
          >
            {regenMutation.isPending ? 'Regenerating…' : 'Regenerate'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* New token reveal */}
      {newToken && (
        <TokenRevealModal open={true} token={newToken} agentId={agentId} domainId={domainId} />
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={hideSnack}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={hideSnack} severity={snack.severity} variant="filled">
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
