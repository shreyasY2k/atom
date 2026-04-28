import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import api from '@/lib/api'
import { useHitlWebSocket } from '@/hooks/useHitlWebSocket'
import { useHitlStore, HitlItem } from '@/lib/hitlStore'
import { HitlDecisionDrawer } from '@/components/app/HitlDecisionDrawer'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type FilterType = 'ALL' | 'BUSINESS_DECISION' | 'DEPLOYMENT_APPROVAL'

function Countdown({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <span className="text-muted-foreground">—</span>
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return <span className="text-destructive text-xs">Expired</span>
  const s = Math.floor(diff / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`
  return <span className="font-mono text-xs text-amber-600">{label} ↓</span>
}

export function HitlQueue() {
  useHitlWebSocket()

  const [filter, setFilter] = useState<FilterType>('ALL')
  const [selected, setSelected] = useState<HitlItem | null>(null)
  const { items, setItems } = useHitlStore()

  useQuery({
    queryKey: ['hitl-queue'],
    queryFn: async () => {
      const { data } = await api.get<HitlItem[]>('/api/hitl/queue')
      setItems(data)
      return data
    },
  })

  const pending = items.filter(i => i.status === 'pending')
  const filtered =
    filter === 'ALL' ? pending : pending.filter(i => i.workflow_type === filter)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold">HITL Queue</h2>
          {pending.length > 0 && (
            <Badge>{pending.length} pending</Badge>
          )}
        </div>
        <div className="flex gap-1 text-sm">
          {(['ALL', 'BUSINESS_DECISION', 'DEPLOYMENT_APPROVAL'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-md border transition-colors ${
                filter === f
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:bg-accent'
              }`}
            >
              {f === 'ALL' ? 'All' : f === 'BUSINESS_DECISION' ? 'Business' : 'Deployment'}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No pending decisions
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Submitted</TableHead>
              <TableHead>Expires in</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map(item => (
              <TableRow
                key={item.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelected(item)}
              >
                <TableCell className="font-medium">{item.agent_name}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      item.workflow_type === 'BUSINESS_DECISION' ? 'secondary' : 'outline'
                    }
                  >
                    {item.workflow_type === 'BUSINESS_DECISION' ? 'Business' : 'Deployment'}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </TableCell>
                <TableCell>
                  <Countdown expiresAt={item.expires_at} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <HitlDecisionDrawer
        item={selected}
        open={!!selected}
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
