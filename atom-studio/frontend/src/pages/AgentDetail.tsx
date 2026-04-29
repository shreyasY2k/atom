import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { RefreshCw, Trash2, ChevronLeft, Terminal } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

const DEPLOY_VARIANT: Record<DeploymentStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'secondary',
  approved: 'outline',
  rejected: 'destructive',
  deployed: 'default',
  failed: 'destructive',
  rolled_back: 'secondary',
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

const STATUS_VARIANT: Record<AgentStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  pending_approval: 'outline',
  deployed: 'default',
  suspended: 'destructive',
}

export function AgentDetail({ domainId, agentId }: AgentDetailProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [newToken, setNewToken] = useState<string | null>(null)

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
    onError: () => toast({ title: 'Error', description: 'Failed to suspend agent.', variant: 'destructive' }),
  })

  const regenMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(
        `/api/domains/${domainId}/agents/${agentId}/regenerate-token`,
      )
      return data.token as string
    },
    onSuccess: token => {
      setConfirmRegen(false)
      setNewToken(token)
    },
    onError: () => toast({ title: 'Error', description: 'Failed to regenerate token.', variant: 'destructive' }),
  })

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!agent) return <p className="text-sm text-destructive">Agent not found.</p>

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Back link */}
      <Link to="/agents" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold">{agent.name}</h2>
          {agent.description && (
            <p className="text-muted-foreground text-sm mt-1">{agent.description}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANT[agent.status]} className="capitalize">
          {agent.status.replace('_', ' ')}
        </Badge>
      </div>

      {/* Config cards */}
      <div className="grid gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Allowed Models
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1">
            {(agent.allowed_models ?? []).map(m => (
              <Badge key={m} variant="secondary">
                {m}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Rate Limits</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>RPM: <span className="font-medium">{agent.rpm_limit}</span></p>
              <p>TPM: <span className="font-medium">{agent.tpm_limit.toLocaleString()}</span></p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">HITL</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Timeout: <span className="font-medium">{agent.hitl_timeout_seconds}s</span></p>
              <p>Fallback: <span className="font-medium">{agent.hitl_fallback}</span></p>
            </CardContent>
          </Card>
        </div>

        {agent.tools.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Tools</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {agent.tools.map(t => (
                <Badge key={t.id} variant="outline">
                  {t.name}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        {agent.skills.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Skills</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {agent.skills.map(s => (
                <Badge key={s.id} variant="outline">
                  {s.name}
                </Badge>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Metadata</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>LiteLLM ID: <code className="font-mono text-xs">{agent.litellm_agent_id ?? '—'}</code></p>
            <p>Created: {format(new Date(agent.created_at), 'MMM d, yyyy HH:mm')}</p>
            <p>Updated: {format(new Date(agent.updated_at), 'MMM d, yyyy HH:mm')}</p>
          </CardContent>
        </Card>

        {deployments.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Deployment History
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Image</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Deployed at</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {deployments.map(d => (
                    <TableRow key={d.id}>
                      <TableCell className="font-mono text-xs">{d.version}</TableCell>
                      <TableCell className="font-mono text-xs truncate max-w-xs">
                        {d.manifest_json?.image ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={DEPLOY_VARIANT[d.status]} className="capitalize">
                          {d.status.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {d.deployed_at
                          ? format(new Date(d.deployed_at), 'MMM d, yyyy HH:mm')
                          : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <Button variant="outline" asChild>
          <Link to="/agents/$agentId/logs" params={{ agentId }}>
            <Terminal className="mr-2 h-4 w-4" />
            Live Logs
          </Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => setConfirmRegen(true)}
          disabled={agent.status === 'suspended'}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Regenerate Token
        </Button>
        <Button
          variant="destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={agent.status === 'suspended'}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Suspend
        </Button>
      </div>

      {/* Confirm suspend dialog */}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend agent?</DialogTitle>
            <DialogDescription>
              This will revoke the LiteLLM virtual key and set status to suspended. The agent JWT
              will stop working immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Suspending…' : 'Suspend'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirm regen dialog */}
      <Dialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Regenerate token?</DialogTitle>
            <DialogDescription>
              The current token will be revoked immediately and will stop working within seconds.
              You will receive a new token shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setConfirmRegen(false)}>
              Cancel
            </Button>
            <Button onClick={() => regenMutation.mutate()} disabled={regenMutation.isPending}>
              {regenMutation.isPending ? 'Regenerating…' : 'Regenerate'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* New token reveal */}
      {newToken && (
        <TokenRevealModal
          open={true}
          token={newToken}
          agentId={agentId}
          domainId={domainId}
        />
      )}
    </div>
  )
}
