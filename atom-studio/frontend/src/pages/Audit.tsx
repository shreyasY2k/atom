import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import CircularProgress from '@mui/material/CircularProgress'
import ShieldIcon from '@mui/icons-material/Shield'
import GppBadIcon from '@mui/icons-material/GppBad'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import api from '@/lib/api'

interface AuditEntry {
  seq: number
  prev_hash: string
  event: {
    timestamp?: string
    method?: string
    path?: string
    status_code?: number
    latency_ms?: number
    agent_id?: string
    domain_id?: string
    policy_decision?: { allow: boolean; reason: string }
  }
  hmac: string
  created_at: string
}

interface AuditPage {
  total: number
  page: number
  page_size: number
  items: AuditEntry[]
}

interface VerifyResult {
  valid: boolean
  checked: number
  first_invalid_seq?: number
  reason?: string
  message?: string
}

function StatusChip({ code }: { code?: number }) {
  if (code == null) return <Typography variant="caption" color="text.secondary">—</Typography>
  const color = code < 300 ? 'success' : code < 400 ? 'default' : 'error'
  return <Chip label={code} size="small" color={color as 'success' | 'default' | 'error'} sx={{ fontFamily: 'monospace', fontSize: 11 }} />
}

export function Audit() {
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  const { data, isLoading } = useQuery<AuditPage>({
    queryKey: ['audit', page],
    queryFn: async () => (await api.get(`/api/audit/?page=${page}&page_size=${pageSize}`)).data,
  })

  const verifyMutation = useMutation<VerifyResult>({
    mutationFn: async () => (await api.post('/api/audit/verify?n=500')).data,
    onSuccess: result => setVerifyResult(result),
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Audit Log</Typography>
          <Typography variant="body2" color="text.secondary">
            Hash-chained GATE audit events — {data?.total ?? '…'} total entries
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<ShieldIcon />}
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
        >
          {verifyMutation.isPending ? 'Verifying…' : 'Verify Chain'}
        </Button>
      </Box>

      {verifyResult && (
        <Card variant="outlined" sx={{ borderColor: verifyResult.valid ? 'success.main' : 'error.main' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              {verifyResult.valid
                ? <ShieldIcon sx={{ color: 'success.main' }} fontSize="small" />
                : <GppBadIcon sx={{ color: 'error.main' }} fontSize="small" />}
              <Typography variant="subtitle2">
                Chain integrity: {verifyResult.valid ? 'VALID' : 'INVALID'}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">Entries checked: {verifyResult.checked}</Typography>
            {verifyResult.valid && verifyResult.message && (
              <Typography variant="body2" color="text.secondary">{verifyResult.message}</Typography>
            )}
            {!verifyResult.valid && (
              <>
                <Typography variant="body2" color="text.secondary">
                  First invalid seq: <code>{verifyResult.first_invalid_seq}</code>
                </Typography>
                <Typography variant="body2" color="text.secondary">Reason: {verifyResult.reason}</Typography>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card variant="outlined">
        <CardContent sx={{ p: 0, '&:last-child': { pb: 0 } }}>
          {isLoading ? (
            <Box sx={{ p: 2 }}><CircularProgress size={20} /></Box>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: 64 }}>Seq</TableCell>
                  <TableCell sx={{ width: 64 }}>Method</TableCell>
                  <TableCell>Path</TableCell>
                  <TableCell sx={{ width: 64 }}>Status</TableCell>
                  <TableCell sx={{ width: 80 }}>Latency</TableCell>
                  <TableCell>Agent</TableCell>
                  <TableCell sx={{ width: 80 }}>Policy</TableCell>
                  <TableCell sx={{ width: 160 }}>Time</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(data?.items ?? []).map(entry => (
                  <TableRow key={entry.seq}>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>{entry.seq}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                      {entry.event.method ?? '—'}
                    </TableCell>
                    <TableCell
                      sx={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={entry.event.path}
                    >
                      {entry.event.path ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusChip code={entry.event.status_code} />
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                      {entry.event.latency_ms != null ? `${entry.event.latency_ms}ms` : '—'}
                    </TableCell>
                    <TableCell
                      sx={{ fontFamily: 'monospace', fontSize: 12, color: 'text.secondary', maxWidth: 128, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={entry.event.agent_id}
                    >
                      {entry.event.agent_id ? entry.event.agent_id.slice(0, 8) + '…' : '—'}
                    </TableCell>
                    <TableCell>
                      {entry.event.policy_decision ? (
                        <Chip
                          label={entry.event.policy_decision.allow ? 'allow' : 'deny'}
                          color={entry.event.policy_decision.allow ? 'success' : 'error'}
                          size="small"
                          sx={{ fontSize: 11 }}
                        />
                      ) : '—'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {format(new Date(entry.created_at), 'MMM d HH:mm:ss')}
                    </TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} align="center">
                      <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
                        No audit entries yet.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">Page {page} of {totalPages}</Typography>
          <IconButton size="small" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeftIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRightIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </Box>
  )
}
