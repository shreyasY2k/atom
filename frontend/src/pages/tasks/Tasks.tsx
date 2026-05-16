import React, { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, IconButton, Paper, Stack, Tab, Tabs, TextField,
  Tooltip, Typography,
} from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import { workflowApi } from '../../api/workflow'
import type { Task } from '../../types'

function EditModal({
  task,
  open,
  onClose,
  onSave,
}: {
  task: Task
  open: boolean
  onClose: () => void
  onSave: (edits: Record<string, unknown>) => void
}) {
  const [draft, setDraft] = useState(() => JSON.stringify(task.context, null, 2))
  const [parseError, setParseError] = useState('')

  const handleSave = () => {
    try {
      const edits = JSON.parse(draft)
      onSave(edits)
      onClose()
    } catch {
      setParseError('Invalid JSON — fix before saving.')
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: '1rem', fontWeight: 600 }}>
        Edit agent draft — {task.task_id}
      </DialogTitle>
      <DialogContent>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {task.description}
        </Typography>
        <TextField
          multiline
          fullWidth
          rows={12}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setParseError('') }}
          error={!!parseError}
          helperText={parseError}
          inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.78rem' } }}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose}>Cancel</Button>
        <Button size="small" variant="contained" onClick={handleSave}>Save &amp; resolve</Button>
      </DialogActions>
    </Dialog>
  )
}

function TaskCard({ task, onResolve }: { task: Task; onResolve: (id: string, res: string, edits?: Record<string, unknown>) => void }) {
  const [showEdit, setShowEdit] = useState(false)
  const created = new Date(task.created_at)
  const age = Math.floor((Date.now() - created.getTime()) / 60000)
  const slaMs = (task as Task & { sla_seconds?: number }).sla_seconds
    ? ((task as Task & { sla_seconds?: number }).sla_seconds! * 1000 - (Date.now() - created.getTime()))
    : null
  const slaMin = slaMs ? Math.max(0, Math.floor(slaMs / 60000)) : null

  return (
    <Paper elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">{task.task_id}</Typography>
            <Chip label={task.assignee_group} size="small" color="success" variant="outlined" sx={{ height: 18, fontSize: '0.65rem', fontFamily: 'monospace' }} />
          </Box>
          <Typography variant="body2" fontWeight={600}>{task.title}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.25 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <AccessTimeIcon sx={{ fontSize: 11, color: 'text.secondary' }} />
              <Typography variant="caption" color="text.secondary">{age}m ago</Typography>
            </Box>
            {slaMin !== null && (
              <Typography variant="caption" sx={{ color: slaMin < 30 ? 'error.main' : 'text.secondary' }}>
                SLA in {slaMin}m
              </Typography>
            )}
            <Typography variant="caption" fontFamily="monospace" color="text.secondary">run: {task.workflow_run_id.slice(0, 12)}</Typography>
          </Box>
        </Box>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.6 }}>{task.description}</Typography>

      {Object.keys(task.context || {}).length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.25, mb: 1.5, bgcolor: 'background.default' }}>
          <Typography variant="caption" color="text.secondary" display="block" gutterBottom>Context</Typography>
          <Box component="pre" sx={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'text.secondary', m: 0, overflow: 'auto', maxHeight: 96 }}>
            {JSON.stringify(task.context, null, 2)}
          </Box>
        </Paper>
      )}

      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        {task.actions.includes('accept') && (
          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<CheckCircleOutlineIcon />}
            onClick={() => onResolve(task.task_id, 'accept')}
          >
            Accept
          </Button>
        )}
        {task.actions.includes('reject') && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<CancelOutlinedIcon />}
            onClick={() => onResolve(task.task_id, 'reject')}
          >
            Reject
          </Button>
        )}
        {task.actions.includes('edit') && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditOutlinedIcon />}
            onClick={() => setShowEdit(true)}
          >
            Edit
          </Button>
        )}
      </Box>

      {showEdit && (
        <EditModal
          task={task}
          open={showEdit}
          onClose={() => setShowEdit(false)}
          onSave={(edits) => onResolve(task.task_id, 'edit', edits)}
        />
      )}
    </Paper>
  )
}

export default function Tasks() {
  const [tab, setTab] = useState<'OPEN' | 'RESOLVED'>('OPEN')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', tab],
    queryFn: () => workflowApi.listTasks(tab),
    refetchInterval: tab === 'OPEN' ? 5000 : false,
  })

  const resolve = useMutation({
    mutationFn: ({ id, resolution, edits }: { id: string; resolution: string; edits?: Record<string, unknown> }) =>
      workflowApi.resolveTask(id, resolution),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', 'OPEN'] })
      qc.invalidateQueries({ queryKey: ['tasks', 'RESOLVED'] })
    },
  })

  const tasks: Task[] = data?.tasks ?? []

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', maxWidth: { sm: '100%', md: '100%', lg: 1200 }, mx: 'auto' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Typography variant="h6" fontWeight={600}>Human Tasks</Typography>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => qc.invalidateQueries({ queryKey: ['tasks', tab] })}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label={`Open${data && tab === 'OPEN' ? ` (${data.count})` : ''}`} value="OPEN" />
        <Tab label="Resolved" value="RESOLVED" />
      </Tabs>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}

      {!isLoading && tasks.length === 0 && (
        <Box sx={{ py: 8, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            {tab === 'OPEN' ? 'No open tasks — all workflows are running or completed.' : 'No resolved tasks yet.'}
          </Typography>
        </Box>
      )}

      <Stack spacing={1.5}>
        {tasks.map((t) =>
          tab === 'OPEN'
            ? <TaskCard key={t.task_id} task={t} onResolve={(id, res, edits) => resolve.mutate({ id, resolution: res, edits })} />
            : (
              <Paper key={t.task_id} elevation={0} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary">{t.task_id}</Typography>
                  <Chip
                    label={t.resolution}
                    size="small"
                    color={t.resolution === 'accept' ? 'success' : 'error'}
                    variant="outlined"
                    sx={{ height: 18, fontSize: '0.65rem' }}
                  />
                </Box>
                <Typography variant="body2">{t.title}</Typography>
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                  resolved by {t.resolved_by} · {t.resolved_at?.slice(0, 16)}
                </Typography>
              </Paper>
            )
        )}
      </Stack>
    </Box>
  )
}
