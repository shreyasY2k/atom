import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Typography, Button, Paper, Chip, IconButton,
  CircularProgress, Alert, Stack, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, Accordion,
  AccordionSummary, AccordionDetails, InputAdornment,
  Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Tooltip,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ExtensionIcon from '@mui/icons-material/Extension'
import PlayArrowIcon from '@mui/icons-material/PlayArrow'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SearchIcon from '@mui/icons-material/Search'
import { builderApi, ToolRecord } from '../../api/builder'
import ToolFormDialog from '../../components/ToolFormDialog'

// ── Type Chip ─────────────────────────────────────────────────────────────────

function TypeChip({ toolType }: { toolType?: string }) {
  const colorMap: Record<string, { label: string; color: string }> = {
    http: { label: 'HTTP', color: '#1a73e8' },
    python: { label: 'Python', color: '#34a853' },
    mcp: { label: 'MCP', color: '#9334e6' },
  }
  const info = colorMap[toolType ?? ''] ?? { label: toolType ?? '—', color: '#888' }
  return (
    <Chip
      label={info.label}
      size="small"
      sx={{
        fontFamily: 'monospace',
        fontSize: '0.68rem',
        height: 20,
        fontWeight: 700,
        bgcolor: info.color + '1a',
        color: info.color,
        border: `1px solid ${info.color}40`,
      }}
    />
  )
}

// ── Method Badge ──────────────────────────────────────────────────────────────

function MethodBadge({ method }: { method?: string }) {
  const colorMap: Record<string, 'default' | 'primary' | 'secondary' | 'error' | 'warning' | 'info' | 'success'> = {
    GET: 'success',
    POST: 'primary',
    PUT: 'warning',
    DELETE: 'error',
    PATCH: 'info',
  }
  return (
    <Chip
      label={method ?? '—'}
      size="small"
      color={colorMap[method ?? ''] ?? 'default'}
      sx={{ fontFamily: 'monospace', fontSize: '0.68rem', height: 20, fontWeight: 700 }}
    />
  )
}

// ── Delete Confirmation Dialog ────────────────────────────────────────────────

interface DeleteDialogProps {
  tool: ToolRecord | null
  onClose: () => void
  onConfirm: () => Promise<void>
  deleting: boolean
}

function DeleteDialog({ tool, onClose, onConfirm, deleting }: DeleteDialogProps) {
  return (
    <Dialog open={!!tool} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Delete Tool</DialogTitle>
      <DialogContent>
        <Typography variant="body2">
          Are you sure you want to delete{' '}
          <Box component="span" fontWeight={600} fontFamily="monospace">
            {tool?.display_name ?? tool?.name}
          </Box>
          ? This cannot be undone. Agents using this tool will lose access.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={deleting}>Cancel</Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={deleting}
          startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : <DeleteIcon />}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Test Tool Dialog ──────────────────────────────────────────────────────────

interface TestToolDialogProps {
  tool: ToolRecord | null
  onClose: () => void
}

function TestToolDialog({ tool, onClose }: TestToolDialogProps) {
  const [inputText, setInputText] = useState('{}')
  const [executing, setExecuting] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [execError, setExecError] = useState('')

  useEffect(() => {
    if (tool) {
      setInputText('{}')
      setResult(null)
      setExecError('')
    }
  }, [tool])

  const handleExecute = async () => {
    if (!tool) return
    setExecError('')
    setResult(null)

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(inputText)
    } catch {
      setExecError('Invalid JSON input.')
      return
    }

    setExecuting(true)
    try {
      const res = await builderApi.executeGlobalTool(tool.tool_id, parsed)
      setResult(JSON.stringify(res.result, null, 2))
    } catch (e: unknown) {
      setExecError((e as { detail?: string })?.detail ?? String(e))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <Dialog open={!!tool} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        Test Tool
        {tool && (
          <Typography component="span" variant="caption" fontFamily="monospace" sx={{ ml: 1, color: 'text.secondary' }}>
            {tool.name}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Input (JSON)"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            fullWidth
            multiline
            minRows={4}
            inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.82rem' }, spellCheck: false }}
          />
          {execError && (
            <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{execError}</Alert>
          )}
          {result !== null && (
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                Result
              </Typography>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  p: 1.5,
                  borderRadius: 1,
                  bgcolor: 'grey.50',
                  border: 1,
                  borderColor: 'divider',
                  fontFamily: 'monospace',
                  fontSize: '0.78rem',
                  lineHeight: 1.6,
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 240,
                  overflowY: 'auto',
                }}
              >
                {result}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={executing}>Close</Button>
        <Button
          variant="contained"
          onClick={handleExecute}
          disabled={executing}
          startIcon={executing ? <CircularProgress size={14} color="inherit" /> : <PlayArrowIcon />}
        >
          Execute
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Empty State ───────────────────────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <Box sx={{ textAlign: 'center', py: 10 }}>
      <ExtensionIcon sx={{ fontSize: 56, color: 'text.disabled', mb: 2 }} />
      <Typography variant="h6" color="text.secondary" gutterBottom>
        No global tools yet
      </Typography>
      <Typography variant="body2" color="text.disabled" sx={{ mb: 3 }}>
        Global tools are shared across all agents. Create your first tool to get started.
      </Typography>
      <Button variant="contained" startIcon={<AddIcon />} onClick={onCreateClick}>
        Create Tool
      </Button>
    </Box>
  )
}

// ── Main Registry ─────────────────────────────────────────────────────────────

export default function ToolsRegistry() {
  const [tools, setTools] = useState<ToolRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState('')

  const [formOpen, setFormOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<ToolRecord | null>(null)

  const [deletingTool, setDeletingTool] = useState<ToolRecord | null>(null)
  const [deleteInProgress, setDeleteInProgress] = useState(false)

  const [testingTool, setTestingTool] = useState<ToolRecord | null>(null)

  const fetchTools = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const result = await builderApi.listGlobalTools()
      setTools(result.tools)
    } catch (e: unknown) {
      setLoadError((e as { detail?: string })?.detail ?? String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTools()
  }, [fetchTools])

  // Group tools by domain for display
  const filteredTools = tools.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase()) || (t.description || '').toLowerCase().includes(search.toLowerCase())
    const matchDomain = !domainFilter || t.domain === domainFilter
    return matchSearch && matchDomain
  })

  const domains = [...new Set(tools.map(t => t.domain).filter(Boolean))] as string[]
  const toolsByDomain: Record<string, ToolRecord[]> = {}
  const untagged: ToolRecord[] = []
  for (const t of filteredTools) {
    if (t.domain) {
      toolsByDomain[t.domain] = toolsByDomain[t.domain] || []
      toolsByDomain[t.domain].push(t)
    } else {
      untagged.push(t)
    }
  }
  if (untagged.length > 0) toolsByDomain['untagged'] = untagged

  const handleOpenCreate = () => {
    setEditingTool(null)
    setFormOpen(true)
  }

  const handleOpenEdit = (tool: ToolRecord) => {
    setEditingTool(tool)
    setFormOpen(true)
  }

  const handleFormClose = () => {
    setFormOpen(false)
    setEditingTool(null)
  }

  const handleFormSave = async (payload: Partial<ToolRecord>) => {
    if (editingTool) {
      await builderApi.updateGlobalTool(editingTool.tool_id, payload)
    } else {
      await builderApi.createGlobalTool({ ...payload, scope: 'global' })
    }
    setFormOpen(false)
    setEditingTool(null)
    await fetchTools()
  }

  const handleDeleteConfirm = async () => {
    if (!deletingTool) return
    setDeleteInProgress(true)
    try {
      await builderApi.deleteGlobalTool(deletingTool.tool_id)
      setDeletingTool(null)
      await fetchTools()
    } catch {
      // swallow — user can retry
    } finally {
      setDeleteInProgress(false)
    }
  }

  const ToolTable = ({ toolList }: { toolList: ToolRecord[] }) => (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow sx={{ '& th': { fontWeight: 700, bgcolor: 'background.default', fontSize: '0.75rem' } }}>
            <TableCell>Name</TableCell>
            <TableCell>Description</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Domain / Sub</TableCell>
            <TableCell>Tags</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
              {tools.map(tool => (
                <TableRow key={tool.tool_id} hover>
                  <TableCell>
                    <Box>
                      <Typography variant="body2" fontWeight={600} fontFamily="monospace" sx={{ fontSize: '0.8rem' }}>
                        {tool.name}
                      </Typography>
                      {tool.display_name && tool.display_name !== tool.name && (
                        <Typography variant="caption" color="text.secondary">
                          {tool.display_name}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontSize: '0.8rem', maxWidth: 220 }}>
                      {tool.description ?? '—'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <TypeChip toolType={tool.tool_type} />
                  </TableCell>
                  <TableCell>
                    {tool.domain ? (
                      <Box>
                        <Chip label={tool.domain} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.62rem', height: 16, mr: 0.5 }} />
                        {tool.subdomain && <Chip label={tool.subdomain} size="small" variant="outlined" sx={{ fontSize: '0.62rem', height: 16 }} />}
                      </Box>
                    ) : <Typography variant="caption" color="text.disabled">—</Typography>}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(tool.tags ?? []).length > 0
                        ? tool.tags!.map(tag => (
                            <Chip key={tag} label={tag} size="small" variant="outlined" sx={{ fontSize: '0.62rem', height: 16 }} />
                          ))
                        : <Typography variant="caption" color="text.disabled">—</Typography>
                      }
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                      <Tooltip title="Run">
                        <IconButton size="small" color="primary" onClick={() => setTestingTool(tool)}>
                          <PlayArrowIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => handleOpenEdit(tool)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" color="error" onClick={() => setDeletingTool(tool)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </TableContainer>
  )

  return (
    <Box sx={{ p: 3, height: '100%', overflowY: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Typography variant="h6" fontWeight={700}>Tools Registry</Typography>
          <Typography variant="body2" color="text.secondary">
            {tools.length} global tools · grouped by domain
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenCreate}>
          Create Tool
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <TextField
          size="small" placeholder="Search tools…" value={search} onChange={e => setSearch(e.target.value)}
          sx={{ minWidth: 200 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
        />
        {domains.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', alignItems: 'center' }}>
            <Chip label="All" size="small" variant={!domainFilter ? 'filled' : 'outlined'} color={!domainFilter ? 'primary' : 'default'} onClick={() => setDomainFilter('')} />
            {domains.map(d => (
              <Chip key={d} label={d} size="small" variant={domainFilter === d ? 'filled' : 'outlined'} color={domainFilter === d ? 'primary' : 'default'} onClick={() => setDomainFilter(domainFilter === d ? '' : d)} />
            ))}
          </Box>
        )}
      </Box>

      {/* Load error */}
      {loadError && <Alert severity="error" sx={{ mb: 2, fontSize: '0.75rem' }}>{loadError}</Alert>}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : tools.length === 0 ? (
        <EmptyState onCreateClick={handleOpenCreate} />
      ) : filteredTools.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No tools match your filters.</Typography>
      ) : (
        <Stack spacing={1.5}>
          {Object.entries(toolsByDomain).sort(([a], [b]) => a.localeCompare(b)).map(([domain, domainTools]) => (
            <Accordion key={domain} defaultExpanded variant="outlined" sx={{ borderRadius: '8px !important', '&:before': { display: 'none' } }}>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Chip label={domain} size="small" color={domain === 'untagged' ? 'default' : 'primary'} variant="outlined" sx={{ fontWeight: 700, fontSize: '0.72rem' }} />
                  <Typography variant="body2" color="text.secondary">{domainTools.length} tool{domainTools.length !== 1 ? 's' : ''}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    {[...new Set(domainTools.map(t => t.subdomain).filter(Boolean))].map(sd => (
                      <Chip key={sd} label={sd} size="small" variant="outlined" sx={{ fontSize: '0.62rem', height: 16 }} />
                    ))}
                  </Box>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <ToolTable toolList={domainTools} />
              </AccordionDetails>
            </Accordion>
          ))}
        </Stack>
      )}

      <ToolFormDialog open={formOpen} onClose={handleFormClose} onSave={handleFormSave} initialData={editingTool} title={editingTool ? 'Edit Tool' : 'Create Global Tool'} />
      <DeleteDialog tool={deletingTool} onClose={() => setDeletingTool(null)} onConfirm={handleDeleteConfirm} deleting={deleteInProgress} />
      <TestToolDialog tool={testingTool} onClose={() => setTestingTool(null)} />
    </Box>
  )
}
