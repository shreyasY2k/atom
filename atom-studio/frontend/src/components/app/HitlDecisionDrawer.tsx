import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle, XCircle, Clock } from 'lucide-react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Chip from '@mui/material/Chip'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import api from '@/lib/api'
import { useSnackbar } from '@/hooks/use-snackbar'
import { useHitlStore, HitlItem } from '@/lib/hitlStore'

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
    <Typography
      variant="body2"
      sx={{ fontFamily: 'monospace', fontWeight: 500, color: expired ? 'error.main' : 'warning.main' }}
    >
      {remaining || '—'}
    </Typography>
  )
}

export function HitlDecisionDrawer({ item, open, onClose }: Props) {
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()
  const { resolveItem } = useHitlStore()
  const { state: snack, show: showSnack, hide: hideSnack } = useSnackbar()

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
      showSnack(
        `${approved ? 'Approved' : 'Rejected'} — decision recorded for ${item!.agent_name}`,
        approved ? 'success' : 'warning',
      )
      onClose()
    },
    onError: () => showSnack('Failed to record decision.', 'error'),
  })

  if (!item) return null

  const isDeployment = item.workflow_type === 'DEPLOYMENT_APPROVAL'

  return (
    <>
      <Dialog
        open={open}
        onClose={() => onClose()}
        fullWidth
        maxWidth="sm"
        slotProps={{ paper: { sx: { m: 0, p: 0, overflow: 'hidden' } } }}
      >
        <DialogTitle sx={{ px: 3, pt: 3, pb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                {item.agent_name}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                <Chip
                  label={isDeployment ? 'Deployment Approval' : 'Business Decision'}
                  size="small"
                  variant={isDeployment ? 'outlined' : 'filled'}
                  sx={{ fontSize: 11 }}
                />
                <Typography variant="caption" color="text.secondary">
                  {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                </Typography>
              </Box>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
              <Clock size={14} style={{ color: '#6b7280' }} />
              <Countdown expiresAt={item.expires_at} />
            </Box>
          </Box>
        </DialogTitle>

        <Divider />

        <DialogContent sx={{ px: 3, py: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Deployment-specific summary */}
            {isDeployment && !!item.payload?.image && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, display: 'block', mb: 0.5 }}>Image</Typography>
                <Box component="code" sx={{ display: 'block', borderRadius: 1, bgcolor: 'grey.100', px: 1.5, py: 1, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {String(item.payload.image)}
                </Box>
                {!!item.payload.message && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {String(item.payload.message)}
                  </Typography>
                )}
              </Box>
            )}

            {/* Generic payload */}
            {!isDeployment && (
              <Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, display: 'block', mb: 0.5 }}>Payload</Typography>
                <Box component="pre" sx={{ borderRadius: 1, bgcolor: 'grey.100', px: 1.5, py: 1, fontSize: 12, fontFamily: 'monospace', overflow: 'auto', maxHeight: 144, lineHeight: 1.6, m: 0 }}>
                  {JSON.stringify(item.payload, null, 2)}
                </Box>
              </Box>
            )}

            {/* Decision note */}
            <TextField
              label="Decision note (optional)"
              multiline
              rows={2}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Reason for your decision…"
              size="small"
              fullWidth
              sx={{ '& .MuiInputBase-input': { fontSize: 14 } }}
            />
          </Box>
        </DialogContent>

        <Divider />

        <DialogActions sx={{ px: 3, py: 2, gap: 1 }}>
          <Button onClick={onClose} disabled={decideMutation.isPending}>Cancel</Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="outlined"
            color="error"
            startIcon={<XCircle size={16} />}
            onClick={() => decideMutation.mutate({ approved: false })}
            disabled={decideMutation.isPending}
          >
            Reject
          </Button>
          <Button
            variant="contained"
            sx={{ bgcolor: '#16a34a', '&:hover': { bgcolor: '#15803d' } }}
            startIcon={<CheckCircle size={16} />}
            onClick={() => decideMutation.mutate({ approved: true })}
            disabled={decideMutation.isPending}
          >
            {decideMutation.isPending ? 'Saving…' : 'Approve'}
          </Button>
        </DialogActions>
      </Dialog>

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
    </>
  )
}
