import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import api from '@/lib/api'
import { useSnackbar } from '@/hooks/use-snackbar'

interface Domain {
  id: string
  name: string
  description: string | null
  owner_id: string
  is_active: boolean
  litellm_team_id: string | null
  created_at: string
  agent_count: number
}

const schema = z.object({
  name: z.string().min(1, 'Name required').max(64),
  description: z.string().optional(),
})
type FormValues = z.infer<typeof schema>

async function fetchDomains(): Promise<Domain[]> {
  const { data } = await api.get<Domain[]>('/api/domains/')
  return data
}

async function createDomain(values: FormValues): Promise<Domain> {
  const { data } = await api.post<Domain>('/api/domains/', values)
  return data
}

export function Domains() {
  const [open, setOpen] = useState(false)
  const queryClient = useQueryClient()
  const { state: snack, show: showSnack, hide: hideSnack } = useSnackbar()

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ['domains'],
    queryFn: fetchDomains,
  })

  const { control, handleSubmit, reset, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  })

  const mutation = useMutation({
    mutationFn: createDomain,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['domains'] })
      setOpen(false)
      reset()
      showSnack('Domain created — LiteLLM team provisioned.', 'success')
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Failed to create domain.'
      showSnack(msg, 'error')
    },
  })

  const onSubmit = (values: FormValues) => mutation.mutate(values)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Domains</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          New Domain
        </Button>
      </Box>

      {isLoading ? (
        <CircularProgress size={24} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Description</TableCell>
              <TableCell>Agents</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {domains.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No domains yet. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              domains.map(d => (
                <TableRow key={d.id}>
                  <TableCell><strong>{d.name}</strong></TableCell>
                  <TableCell sx={{ color: 'text.secondary' }}>{d.description ?? '—'}</TableCell>
                  <TableCell>{d.agent_count}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                    {format(new Date(d.created_at), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New Domain</DialogTitle>
        <Box component="form" onSubmit={handleSubmit(onSubmit)}>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Creates a domain and provisions a LiteLLM team for it.
            </Typography>
            <Controller
              name="name"
              control={control}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Name"
                  placeholder="acme-corp"
                  size="small"
                  fullWidth
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
            <Controller
              name="description"
              control={control}
              render={({ field, fieldState }) => (
                <TextField
                  {...field}
                  label="Description"
                  placeholder="Optional description"
                  size="small"
                  fullWidth
                  error={!!fieldState.error}
                  helperText={fieldState.error?.message}
                />
              )}
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="submit"
              variant="contained"
              disabled={mutation.isPending || formState.isSubmitting}
            >
              {mutation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </DialogActions>
        </Box>
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
    </Box>
  )
}
