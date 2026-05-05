import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Chip from '@mui/material/Chip'
import api from '@/lib/api'
import { useHitlWebSocket } from '@/hooks/useHitlWebSocket'
import { useHitlStore, HitlItem } from '@/lib/hitlStore'
import { HitlDecisionDrawer } from '@/components/app/HitlDecisionDrawer'

type FilterType = 'ALL' | 'BUSINESS_DECISION' | 'DEPLOYMENT_APPROVAL'

function Countdown({ expiresAt }: { expiresAt: string | null }) {
  if (!expiresAt) return <Typography variant="caption" color="text.secondary">—</Typography>
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return <Typography variant="caption" color="error.main">Expired</Typography>
  const s = Math.floor(diff / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const label = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${sec}s` : `${sec}s`
  return <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'warning.main' }}>{label} ↓</Typography>
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>HITL Queue</Typography>
          {pending.length > 0 && (
            <Chip label={`${pending.length} pending`} size="small" color="primary" />
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {(['ALL', 'BUSINESS_DECISION', 'DEPLOYMENT_APPROVAL'] as const).map(f => (
            <Button
              key={f}
              size="small"
              variant={filter === f ? 'contained' : 'outlined'}
              onClick={() => setFilter(f)}
              sx={{ fontSize: 12 }}
            >
              {f === 'ALL' ? 'All' : f === 'BUSINESS_DECISION' ? 'Business' : 'Deployment'}
            </Button>
          ))}
        </Box>
      </Box>

      {filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 6 }}>
          No pending decisions
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Agent</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Submitted</TableCell>
              <TableCell>Expires in</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map(item => (
              <TableRow
                key={item.id}
                hover
                sx={{ cursor: 'pointer' }}
                onClick={() => setSelected(item)}
              >
                <TableCell><strong>{item.agent_name}</strong></TableCell>
                <TableCell>
                  <Chip
                    label={item.workflow_type === 'BUSINESS_DECISION' ? 'Business' : 'Deployment'}
                    size="small"
                    variant={item.workflow_type === 'BUSINESS_DECISION' ? 'filled' : 'outlined'}
                    color="default"
                  />
                </TableCell>
                <TableCell sx={{ fontSize: 13, color: 'text.secondary' }}>
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
    </Box>
  )
}
