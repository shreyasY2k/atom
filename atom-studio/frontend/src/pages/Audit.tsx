import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ShieldCheck, ShieldAlert, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

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

export function Audit() {
  const [page, setPage] = useState(1)
  const pageSize = 50
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null)

  const { data, isLoading } = useQuery<AuditPage>({
    queryKey: ['audit', page],
    queryFn: async () =>
      (await api.get(`/api/audit/?page=${page}&page_size=${pageSize}`)).data,
  })

  const verifyMutation = useMutation<VerifyResult>({
    mutationFn: async () => (await api.post('/api/audit/verify?n=500')).data,
    onSuccess: result => setVerifyResult(result),
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Audit Log</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Hash-chained GATE audit events — {data?.total ?? '…'} total entries
          </p>
        </div>
        <Button
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending}
          variant="outline"
        >
          {verifyMutation.isPending ? (
            'Verifying…'
          ) : (
            <>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Verify Chain
            </>
          )}
        </Button>
      </div>

      {verifyResult && (
        <Card className={verifyResult.valid ? 'border-green-500' : 'border-destructive'}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {verifyResult.valid ? (
                <ShieldCheck className="h-4 w-4 text-green-600" />
              ) : (
                <ShieldAlert className="h-4 w-4 text-destructive" />
              )}
              Chain integrity: {verifyResult.valid ? 'VALID' : 'INVALID'}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-1">
            <p>Entries checked: {verifyResult.checked}</p>
            {verifyResult.valid && verifyResult.message && <p>{verifyResult.message}</p>}
            {!verifyResult.valid && (
              <>
                <p>First invalid seq: <span className="font-mono">{verifyResult.first_invalid_seq}</span></p>
                <p>Reason: {verifyResult.reason}</p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Seq</TableHead>
                  <TableHead className="w-16">Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="w-16">Status</TableHead>
                  <TableHead className="w-20">Latency</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="w-20">Policy</TableHead>
                  <TableHead className="w-40">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.items ?? []).map(entry => (
                  <TableRow key={entry.seq}>
                    <TableCell className="font-mono text-xs">{entry.seq}</TableCell>
                    <TableCell className="font-mono text-xs font-medium">
                      {entry.event.method ?? '—'}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs max-w-xs truncate"
                      title={entry.event.path}
                    >
                      {entry.event.path ?? '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge code={entry.event.status_code} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry.event.latency_ms != null ? `${entry.event.latency_ms}ms` : '—'}
                    </TableCell>
                    <TableCell
                      className="font-mono text-xs text-muted-foreground max-w-[8rem] truncate"
                      title={entry.event.agent_id}
                    >
                      {entry.event.agent_id ? entry.event.agent_id.slice(0, 8) + '…' : '—'}
                    </TableCell>
                    <TableCell>
                      {entry.event.policy_decision ? (
                        <Badge
                          variant={entry.event.policy_decision.allow ? 'default' : 'destructive'}
                          className="text-xs"
                        >
                          {entry.event.policy_decision.allow ? 'allow' : 'deny'}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(entry.created_at), 'MMM d HH:mm:ss')}
                    </TableCell>
                  </TableRow>
                ))}
                {data?.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground text-sm py-8">
                      No audit entries yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ code }: { code?: number }) {
  if (code == null) return <span className="text-xs text-muted-foreground">—</span>
  const variant =
    code < 300 ? 'default' : code < 400 ? 'secondary' : 'destructive'
  return (
    <Badge variant={variant} className="text-xs font-mono">
      {code}
    </Badge>
  )
}
