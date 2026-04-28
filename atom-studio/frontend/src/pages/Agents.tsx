import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Plus } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Agent {
  id: string
  name: string
  domain_id: string
  domain_name: string
  status: 'draft' | 'pending_approval' | 'deployed' | 'suspended'
  allowed_models: string[]
  tool_count: number
  skill_count: number
  created_at: string
}

const STATUS_VARIANT: Record<Agent['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  pending_approval: 'outline',
  deployed: 'default',
  suspended: 'destructive',
}

export function Agents() {
  const navigate = useNavigate()

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: async () => (await api.get('/api/agents/')).data,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Agents</h2>
        <Button onClick={() => navigate({ to: '/agents/new' })}>
          <Plus className="mr-2 h-4 w-4" />
          New Agent
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Models</TableHead>
              <TableHead>Tools</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No agents yet. Create one to get started.
                </TableCell>
              </TableRow>
            ) : (
              agents.map(a => (
                <TableRow
                  key={a.id}
                  className="cursor-pointer"
                  onClick={() =>
                    navigate({
                      to: '/domains/$domainId/agents/$agentId',
                      params: { domainId: a.domain_id, agentId: a.id },
                    })
                  }
                >
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{a.domain_name}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[a.status]}>{a.status}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(a.allowed_models ?? []).slice(0, 2).map(m => (
                        <Badge key={m} variant="outline" className="text-xs">
                          {m}
                        </Badge>
                      ))}
                      {(a.allowed_models ?? []).length > 2 && (
                        <Badge variant="outline" className="text-xs">
                          +{a.allowed_models.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{a.tool_count}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {format(new Date(a.created_at), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
