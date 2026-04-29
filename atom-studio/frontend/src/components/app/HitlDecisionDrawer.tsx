import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/hooks/use-toast'
import { useHitlStore, HitlItem } from '@/lib/hitlStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

interface Props {
  item: HitlItem | null
  open: boolean
  onClose: () => void
}

function Countdown({ expiresAt }: { expiresAt: string | null }) {
  const [remaining, setRemaining] = useState('')
  const [expired, setExpired] = useState(false)

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) { setRemaining('Expired'); setExpired(true); return }
      const s = Math.floor(diff / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      setRemaining(h > 0 ? `${h}h ${m}m ${sec}s` : m > 0 ? `${m}m ${sec}s` : `${sec}s`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return (
    <span className={`font-mono text-sm font-medium ${expired ? 'text-destructive' : 'text-amber-600'}`}>
      {remaining || '—'}
    </span>
  )
}

export function HitlDecisionDrawer({ item, open, onClose }: Props) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()
  const { resolveItem } = useHitlStore()

  useEffect(() => { if (!open) setNote('') }, [open])

  const decideMutation = useMutation({
    mutationFn: async ({ approved }: { approved: boolean }) => {
      const { data } = await api.post(`/api/hitl/${item!.id}/decide`, {
        approved,
        note: note.trim() || null,
      })
      return { approved, data }
    },
    onSuccess: ({ approved }) => {
      resolveItem(item!.id, approved, note.trim() || null)
      queryClient.invalidateQueries({ queryKey: ['hitl-queue'] })
      toast({
        title: approved ? '✓ Approved' : '✗ Rejected',
        description: `Decision recorded for ${item!.agent_name}`,
      })
      onClose()
    },
    onError: () =>
      toast({ title: 'Error', description: 'Failed to record decision.', variant: 'destructive' }),
  })

  if (!item) return null

  const isDeployment = item.workflow_type === 'DEPLOYMENT_APPROVAL'

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg gap-0 p-0 overflow-hidden">
        {/* Header */}
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <DialogTitle className="text-base font-semibold leading-tight">
                {item.agent_name}
              </DialogTitle>
              <div className="flex items-center gap-2">
                <Badge variant={isDeployment ? 'outline' : 'secondary'} className="text-xs">
                  {isDeployment ? 'Deployment Approval' : 'Business Decision'}
                </Badge>
                <DialogDescription className="text-xs">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-sm shrink-0">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <Countdown expiresAt={item.expires_at} />
            </div>
          </div>
        </DialogHeader>

        <div className="border-t" />

        {/* Body */}
        <div className="px-6 py-4 space-y-4">
          {/* Deployment-specific summary */}
          {isDeployment && !!item.payload?.image && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Image</p>
              <code className="block rounded-md bg-muted px-3 py-2 text-xs font-mono break-all leading-relaxed">
                {String(item.payload.image)}
              </code>
              {!!item.payload.message && (
                <p className="text-sm text-muted-foreground mt-1">{String(item.payload.message)}</p>
              )}
            </div>
          )}

          {/* Generic payload */}
          {!isDeployment && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Payload</p>
              <pre className="rounded-md bg-muted px-3 py-2 text-xs font-mono overflow-auto max-h-36 leading-relaxed">
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </div>
          )}

          {/* Decision note */}
          <div className="space-y-1.5">
            <Label htmlFor="hitl-note" className="text-sm">
              Decision note{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="hitl-note"
              rows={2}
              className="resize-none text-sm"
              placeholder="Reason for your decision…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>
        </div>

        <div className="border-t" />

        {/* Footer actions */}
        <div className="px-6 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            className="flex-none"
            onClick={onClose}
            disabled={decideMutation.isPending}
          >
            Cancel
          </Button>
          <div className="flex-1" />
          <Button
            variant="outline"
            className="border-destructive/60 text-destructive hover:bg-destructive/10 hover:text-destructive hover:border-destructive"
            onClick={() => decideMutation.mutate({ approved: false })}
            disabled={decideMutation.isPending}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Reject
          </Button>
          <Button
            className="bg-green-600 hover:bg-green-700 text-white"
            onClick={() => decideMutation.mutate({ approved: true })}
            disabled={decideMutation.isPending}
          >
            {decideMutation.isPending ? (
              'Saving…'
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                Approve
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
