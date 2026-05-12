import React, { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Paper, Skeleton, TextField, Typography,
} from '@mui/material'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import TerminalIcon from '@mui/icons-material/Terminal'
import AddIcon from '@mui/icons-material/Add'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import { workflowApi } from '../../api/workflow'
import { extractErrorMessage } from '../../utils/errors'
import type { WorkflowRecord } from '../../types'

const TILE_SX = {
  p: 2.5,
  borderRadius: 2,
  border: '1.5px solid',
  cursor: 'pointer',
  transition: 'border-color 0.15s, box-shadow 0.15s',
  display: 'flex',
  flexDirection: 'column',
  gap: 1.5,
  height: '100%',   // fill grid cell height so all tiles in row are equal
  boxSizing: 'border-box',
  '&:hover': { boxShadow: 3 },
}

// ── Import from YAML dialog ───────────────────────────────────────────────────

function ImportYamlDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [yaml, setYaml] = useState('')
  const [err, setErr] = useState('')

  const register = useMutation({
    mutationFn: async () => {
      if (!yaml.trim()) throw new Error('Paste or upload a YAML spec first.')
      // Extract name from YAML
      const match = yaml.match(/^\s*name:\s*(\S+)/m)
      if (!match) throw new Error('Could not find "name:" field in YAML.')
      const name = match[1]
      // Save to disk then register
      await workflowApi.saveWorkflowSpec(name, yaml)
      const result = await workflowApi.registerWorkflow(name, yaml)
      return { name, result }
    },
    onSuccess: ({ name }) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow-specs'] })
      onClose()
      navigate(`/workflows/compose/${name}`)
    },
    onError: (e: unknown) => setErr(extractErrorMessage(e)),
  })

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => { setYaml(ev.target?.result as string ?? ''); setErr('') }
    reader.readAsText(f)
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>Import Workflow from YAML</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<UploadFileIcon />}
            onClick={() => fileRef.current?.click()}
          >
            Upload .yaml file
          </Button>
          <input ref={fileRef} type="file" accept=".yaml,.yml" hidden onChange={onFile} />
        </Box>
        <TextField
          multiline
          fullWidth
          rows={16}
          placeholder="Or paste YAML here…"
          value={yaml}
          onChange={(e) => { setYaml(e.target.value); setErr('') }}
          inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.78rem' } }}
        />
        {err && <Alert severity="error" sx={{ mt: 1.5 }}>{err}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={register.isPending}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!yaml.trim() || register.isPending}
          startIcon={register.isPending ? <CircularProgress size={14} color="inherit" /> : undefined}
          onClick={() => register.mutate()}
        >
          Save & Register
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Main landing ──────────────────────────────────────────────────────────────

export default function ComposerLanding() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [importOpen, setImportOpen] = useState(false)

  const { data: workflowsData, isLoading: wfLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: workflowApi.listWorkflows,
  })

  const { data: specsData, isLoading: specsLoading } = useQuery({
    queryKey: ['workflow-specs'],
    queryFn: workflowApi.listWorkflowSpecs,
  })

  const workflows: WorkflowRecord[] = workflowsData?.workflows ?? []
  const diskSpecs = specsData?.specs ?? []
  const unregistered = diskSpecs.filter(s => !s.registered)

  const newBlank = useMutation({
    mutationFn: async () => {
      const name = `workflow-${Date.now()}`
      const stub = [
        'apiVersion: atom.platform/v1',
        'kind: WorkflowDeployment',
        'metadata:',
        `  name: ${name}`,
        '  domain: payments',
        '  version: 0.1.0',
        '  description: New workflow',
        '  owner: demo-user',
        'spec:',
        '  input_schema:',
        '    type: object',
        '    required: []',
        '    properties: {}',
        '  nodes: []',
        '  audit:',
        '    log_to: minio://audit-logs/workflow/' + name,
        '    retention_days: 90',
        '  deployment:',
        '    runtime: temporal',
        '    task_queue: ats-task-queue',
      ].join('\n')
      await workflowApi.saveWorkflowSpec(name, stub)
      return name
    },
    onSuccess: (name) => navigate(`/workflows/compose/${name}`),
  })

  const registerSpec = useMutation({
    mutationFn: (name: string) => workflowApi.registerWorkflow(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow-specs'] })
    },
  })

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', boxSizing: 'border-box' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>Workflow Composer</Typography>
        <Typography variant="body2" color="text.secondary">
          Build auditable workflows — agent, HTTP, decision, and human-task nodes.
        </Typography>
      </Box>

      {/* Start options */}
      <Typography variant="caption" color="text.secondary" fontWeight={600}
        sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Start a workflow
      </Typography>
      <Box sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' },
        gridAutoRows: '1fr',
        gap: 2,
        mt: 1,
        mb: 5,
      }}>

        {/* AI composer — coming soon */}
        <Paper variant="outlined" sx={{ ...TILE_SX, borderColor: 'divider', opacity: 0.5, cursor: 'not-allowed' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AutoFixHighIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
            <Typography variant="body2" fontWeight={700} color="text.secondary">AI COMPOSER</Typography>
            <Chip label="Soon" size="small" sx={{ ml: 'auto', fontSize: '0.62rem', height: 18 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
            Describe a process in plain English and we'll generate the full workflow spec.
          </Typography>
        </Paper>

        {/* CLI init */}
        <Paper variant="outlined" sx={{ ...TILE_SX, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <TerminalIcon sx={{ color: 'text.secondary', fontSize: 18 }} />
            <Typography variant="body2" fontWeight={700}>CLI INIT</Typography>
            <Chip label="Mode B" size="small" variant="outlined" sx={{ ml: 'auto', fontSize: '0.62rem', height: 18 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
            Scaffold from terminal — CLI creates a stub YAML that you edit and open here.
          </Typography>
          <Box component="pre" sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1,
            fontSize: '0.68rem', fontFamily: 'monospace', m: 0, overflow: 'auto', mt: 'auto' }}>
            {'atom workflow init <name>'}
          </Box>
        </Paper>

        {/* Import from YAML */}
        <Paper variant="outlined"
          onClick={() => setImportOpen(true)}
          sx={{ ...TILE_SX, borderColor: 'warning.main', '&:hover': { borderColor: 'warning.dark', boxShadow: 3 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <UploadFileIcon sx={{ color: 'warning.main', fontSize: 18 }} />
            <Typography variant="body2" fontWeight={700} color="warning.main">IMPORT YAML</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
            Paste or upload a workflow spec YAML — saved, registered, and opened in one click.
          </Typography>
          <Button variant="outlined" color="warning" size="small" startIcon={<UploadFileIcon sx={{ fontSize: 14 }} />}
            sx={{ mt: 'auto', alignSelf: 'flex-start' }}
            onClick={(e) => { e.stopPropagation(); setImportOpen(true) }}>
            Import YAML
          </Button>
        </Paper>

        {/* Empty canvas */}
        <Paper variant="outlined"
          onClick={() => newBlank.mutate()}
          sx={{ ...TILE_SX, borderColor: 'primary.main', '&:hover': { borderColor: 'primary.dark', boxShadow: 3 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <AddIcon sx={{ color: 'primary.main', fontSize: 18 }} />
            <Typography variant="body2" fontWeight={700} color="primary.main">EMPTY CANVAS</Typography>
            <Chip label="Mode A" size="small" color="primary" sx={{ ml: 'auto', fontSize: '0.62rem', height: 18 }} />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
            Start blank. Drag nodes from the palette, draw edges, configure in the inspector.
          </Typography>
          <Button variant="contained" size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            disabled={newBlank.isPending} sx={{ mt: 'auto', alignSelf: 'flex-start' }}
            onClick={(e) => { e.stopPropagation(); newBlank.mutate() }}>
            New workflow
          </Button>
        </Paper>
      </Box>

      {/* Unregistered specs on disk */}
      {unregistered.length > 0 && (
        <>
          <Typography variant="caption" color="text.secondary" fontWeight={600}
            sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Available to register
          </Typography>
          <Box sx={{ mt: 1, mb: 4, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {unregistered.map((s) => (
              <Paper key={s.name} variant="outlined"
                sx={{ px: 2.5, py: 1.5, borderRadius: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <AccountTreeIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} fontFamily="monospace">{s.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    v{s.version} · {s.domain}
                    {s.description && ` — ${s.description.slice(0, 80)}`}
                  </Typography>
                </Box>
                <Button size="small" variant="contained"
                  disabled={registerSpec.isPending}
                  startIcon={registerSpec.isPending ? <CircularProgress size={12} color="inherit" /> : <CheckCircleOutlineIcon />}
                  onClick={() => registerSpec.mutate(s.name)}>
                  Register
                </Button>
              </Paper>
            ))}
          </Box>
        </>
      )}

      {/* Registered workflows */}
      <Typography variant="caption" color="text.secondary" fontWeight={600}
        sx={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        Registered workflows
      </Typography>
      <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {(wfLoading || specsLoading) && [0, 1].map((i) => (
          <Skeleton key={i} variant="rectangular" height={56} sx={{ borderRadius: 1.5 }} />
        ))}
        {!wfLoading && !specsLoading && workflows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
            No registered workflows yet. Register one above or import a YAML.
          </Typography>
        )}
        {workflows.map((wf) => (
          <Paper key={wf.name} variant="outlined"
            sx={{ px: 2.5, py: 1.5, borderRadius: 1.5, display: 'flex', alignItems: 'center', gap: 2,
              '&:hover': { bgcolor: 'action.hover', cursor: 'pointer' } }}
            onClick={() => navigate(`/workflows/compose/${wf.name}`)}>
            <AccountTreeIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} fontFamily="monospace">{wf.name}</Typography>
              <Typography variant="caption" color="text.secondary">
                v{wf.version} · {wf.domain} · registered {new Date(wf.registered_at).toLocaleDateString()}
              </Typography>
            </Box>
            <Chip label={wf.status} size="small"
              color={wf.status === 'registered' ? 'success' : 'default'} variant="outlined"
              sx={{ height: 20, fontSize: '0.65rem' }} />
            <Button size="small" variant="outlined"
              onClick={(e) => { e.stopPropagation(); navigate(`/workflows/compose/${wf.name}`) }}>
              Open
            </Button>
          </Paper>
        ))}
      </Box>

      <ImportYamlDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  )
}
