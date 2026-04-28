import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
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

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) {
        setRemaining('Expired')
        return
      }
      const s = Math.floor(diff / 1000)
      const h = Math.floor(s / 3600)
      const m = Math.floor((s % 3600) / 60)
      const sec = s % 60
      setRemaining(
        h > 0
          ? `${h}h ${m}m ${sec}s`
          : m > 0
            ? `${m}m ${sec}s`
            : `${sec}s`,
      )
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return <span className="font-mono text-sm">{remaining}</span>
}

export function HitlDecisionDrawer({ item, open, onClose }: Props) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()
  const { resolveItem } = useHitlStore()

  const decideMutation = useMutation({
    mutationFn: async ({ approved }: { approved: boolean }) => {
      const { data } = await api.post(`/api/hitl/${item!.id}/decide`, {
        approved,
        note: note || null,
      })
      return { approved, data }
    },
    onSuccess: ({ approved }) => {
      resolveItem(item!.id, approved, note || null)
      queryClient.invalidateQueries({ queryKey: ['hitl-queue'] })
      toast({
        title: approved ? 'Approved' : 'Rejected',
        description: `Decision recorded for ${item!.agent_name}`,
      })
      setNote('')
      onClose()
    },
    onError: () =>
      toast({ title: 'Error', description: 'Failed to record decision.', variant: 'destructive' }),
  })

  if (!item) return null

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {item.agent_name}
            <Badge variant={item.workflow_type === 'BUSINESS_DECISION' ? 'secondary' : 'outline'}>
              {item.workflow_type === 'BUSINESS_DECISION' ? 'Business' : 'Deployment'}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs text-muted-foreground">Payload</Label>
            <pre className="mt-1 rounded-md bg-muted px-3 py-2 text-xs overflow-auto max-h-48">
              {JSON.stringify(item.payload, null, 2)}
            </pre>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Expires in</span>
            <Countdown expiresAt={item.expires_at} />
          </div>

          <div className="text-sm text-muted-foreground">
            Submitted{' '}
            {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
          </div>

          <div>
            <Label htmlFor="note">Decision note (optional)</Label>
            <Textarea
              id="note"
              className="mt-1"
              placeholder="Reason for decision…"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => decideMutation.mutate({ approved: false })}
              disabled={decideMutation.isPending}
            >
              Reject
            </Button>
            <Button
              onClick={() => decideMutation.mutate({ approved: true })}
              disabled={decideMutation.isPending}
            >
              {decideMutation.isPending ? 'Saving…' : 'Approve →'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
