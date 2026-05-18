import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Box, Typography, TextField, Button, Paper, Chip, IconButton,
  CircularProgress, Alert, Divider, Stack, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, Tabs, Tab,
  LinearProgress, Switch, FormControlLabel,
} from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import ErrorIcon from '@mui/icons-material/Error'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import StorageIcon from '@mui/icons-material/Storage'
import PsychologyIcon from '@mui/icons-material/Psychology'
import CodeIcon from '@mui/icons-material/Code'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import LinkIcon from '@mui/icons-material/Link'
import SecurityIcon from '@mui/icons-material/Security'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditNoteIcon from '@mui/icons-material/EditNote'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import Editor from '@monaco-editor/react'
import { builderApi, ToolRecord, SkillRecord } from '../../api/builder'
import { useAuth } from '../../context/AuthContext'
import ToolFormDialog from '../../components/ToolFormDialog'

// ── Types ────────────────────────────────────────────────────────────────────

type StepId = 'basics' | 'tools' | 'generate' | 'deploy'
type StepStatus = 'pending' | 'active' | 'complete' | 'error'

interface WizardStep {
  id: StepId; num: number; label: string; sublabel: string; icon: React.ReactNode
}

const STEPS: WizardStep[] = [
  { id: 'basics',   num: 1, label: 'Basic Info',       sublabel: 'Name & description',   icon: <StorageIcon /> },
  { id: 'tools',    num: 2, label: 'Tools & Context',  sublabel: 'Capabilities',          icon: <CodeIcon /> },
  { id: 'generate', num: 3, label: 'Generate',          sublabel: 'Describe behavior',     icon: <PsychologyIcon /> },
  { id: 'deploy',   num: 4, label: 'Deploy',            sublabel: 'Review & launch',       icon: <RocketLaunchIcon /> },
]

const STEP_ORDER: StepId[] = ['basics', 'tools', 'generate', 'deploy']

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ status, num }: { status: StepStatus; num: number }) {
  if (status === 'complete') return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 28, flexShrink: 0 }} />
  if (status === 'error') return <ErrorIcon sx={{ color: 'error.main', fontSize: 28, flexShrink: 0 }} />
  if (status === 'active') return (
    <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 0 3px rgba(25,118,210,0.2)', flexShrink: 0 }}>
      <Typography sx={{ color: 'white', fontWeight: 700, fontSize: 13, lineHeight: 1 }}>{num}</Typography>
    </Box>
  )
  return (
    <Box sx={{ width: 28, height: 28, borderRadius: '50%', border: 2, borderColor: 'divider', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Typography sx={{ color: 'text.disabled', fontWeight: 600, fontSize: 13, lineHeight: 1 }}>{num}</Typography>
    </Box>
  )
}

// ── Step Tree ─────────────────────────────────────────────────────────────────

function StepTree({ steps, currentStep, stepStatus, onStepClick, editMode }: {
  steps: WizardStep[]; currentStep: StepId
  stepStatus: Record<StepId, StepStatus>; onStepClick: (id: StepId) => void
  editMode: boolean
}) {
  return (
    <Box sx={{ width: 240, flexShrink: 0, borderRight: 1, borderColor: 'divider', bgcolor: 'background.paper', pt: 4, pb: 2, px: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, mb: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ letterSpacing: 2, fontSize: '0.65rem' }}>
          {editMode ? 'EDIT AGENT' : 'NEW AGENT'}
        </Typography>
        {editMode && <AutoFixHighIcon sx={{ fontSize: 14, color: 'primary.main' }} />}
      </Box>

      {steps.map((step, idx) => {
        const status = stepStatus[step.id]
        const isLast = idx === steps.length - 1
        const isClickable = status === 'complete' || (editMode && status !== 'pending')
        return (
          <Box key={step.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, cursor: isClickable ? 'pointer' : 'default', py: 0.75, px: 1, borderRadius: 1.5, width: '100%', '&:hover': isClickable ? { bgcolor: 'action.hover' } : {} }}
              onClick={() => isClickable && onStepClick(step.id)}
            >
              <StepIndicator status={status} num={step.num} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: status === 'active' ? 700 : 400, color: status === 'pending' ? 'text.disabled' : 'text.primary', lineHeight: 1.2 }}>
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, display: 'block' }}>
                  {step.sublabel}
                </Typography>
              </Box>
            </Box>
            {!isLast && (
              <Box sx={{ ml: 2.25, width: 2, height: 24, bgcolor: status === 'complete' ? 'success.main' : 'divider', borderRadius: 1, transition: 'background-color 0.3s' }} />
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Back button ───────────────────────────────────────────────────────────────

function BackButton({ currentStep, onBack }: { currentStep: StepId; onBack: () => void }) {
  if (currentStep === 'basics') return null
  return (
    <Button size="small" variant="text" color="inherit" startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ mb: 2, opacity: 0.7, '&:hover': { opacity: 1 } }}>
      Back
    </Button>
  )
}

// ── Step 1: Basic Info ────────────────────────────────────────────────────────

function StepBasics({ agentName, setAgentName, description, setDescription, provisioning, provisionError, onContinue, identity, editMode }: {
  agentName: string; setAgentName: (v: string) => void; description: string; setDescription: (v: string) => void
  provisioning: boolean; provisionError: string; onContinue: () => void; identity: string; editMode: boolean
}) {
  const nameValid = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(agentName)
  const nameError = agentName && !nameValid ? 'Lowercase letters, numbers, hyphens only. 3–40 chars.' : ''
  const canContinue = nameValid && description.trim().length > 0 && !provisioning

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        {editMode ? 'Edit agent' : 'Create a new agent'}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {editMode
          ? 'Update the description if needed, then continue to edit tools and behavior.'
          : 'Give your agent a name and description. This provisions a service identity immediately — you can close and resume from the agent list.'}
      </Typography>
      <Stack spacing={3}>
        <TextField
          label="Agent Name *"
          value={agentName}
          onChange={e => setAgentName(e.target.value.toLowerCase().replace(/\s/g, '-'))}
          fullWidth
          error={!!nameError}
          helperText={nameError || (editMode ? 'Agent name cannot be changed.' : 'Used as the agent\'s identifier. Cannot be changed after creation.')}
          placeholder="my-kyc-agent"
          inputProps={{ spellCheck: false }}
          disabled={provisioning || editMode}
        />
        <TextField
          label="Description *"
          value={description}
          onChange={e => setDescription(e.target.value.slice(0, 500))}
          fullWidth multiline minRows={3} maxRows={6}
          placeholder="Describe what this agent does, the domain it operates in, and the outcomes it produces."
          helperText={`${description.length}/500`}
          disabled={provisioning}
        />
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>Owner (auto-assigned)</Typography>
          <Chip label={identity || 'user:builder@atom.io'} size="small" sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }} />
        </Box>
        {provisionError && <Alert severity="error" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{provisionError}</Alert>}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
          <Button variant="contained" size="large" onClick={onContinue} disabled={!canContinue}
            startIcon={provisioning ? <CircularProgress size={16} color="inherit" /> : undefined} sx={{ minWidth: 140 }}>
            {provisioning ? 'Provisioning…' : 'Continue'}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}

// ── Create Custom Context Dialog ──────────────────────────────────────────────

function CreateContextDialog({ open, onClose, onSave, saving, saveError }: {
  open: boolean; onClose: () => void; onSave: (name: string, content: string) => Promise<void>; saving: boolean; saveError: string
}) {
  const [skillName, setSkillName] = useState('')
  const [content, setContent] = useState('')
  const reset = () => { setSkillName(''); setContent('') }
  const handleClose = () => { reset(); onClose() }
  const handleSave = async () => { await onSave(skillName, content); reset() }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Custom Context</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Alert severity="info" sx={{ fontSize: '0.75rem' }}>
            Custom context is injected into the LLM generation prompt (step 3) to give the agent domain-specific knowledge, rules, or output templates. It is baked into the generated role file.
          </Alert>
          <TextField label="Name *" value={skillName} onChange={e => setSkillName(e.target.value)} fullWidth placeholder="e.g. KYC Compliance Rules" />
          <TextField
            label="Content *" value={content} onChange={e => setContent(e.target.value)}
            fullWidth multiline minRows={6}
            placeholder="# Domain Rules&#10;&#10;List any domain-specific rules, output format requirements, or terminology the agent must know..."
            inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
          />
          {saveError && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{saveError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!skillName.trim() || !content.trim() || saving}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Step 2: Tools & Context ───────────────────────────────────────────────────

function StepTools({ agentName, agentTools, globalTools, agentSkills, loadingTools, toolsError, onAssociateTool, onCreateAgentTool, onRemoveAgentTool, onAddSkill, onDeleteSkill, onBack, onContinue }: {
  agentName: string; agentTools: ToolRecord[]; globalTools: ToolRecord[]; agentSkills: SkillRecord[]
  loadingTools: boolean; toolsError: string
  onAssociateTool: (id: string) => Promise<void>; onCreateAgentTool: (t: Partial<ToolRecord>) => Promise<void>
  onRemoveAgentTool: (id: string) => Promise<void>; onAddSkill: (n: string, c: string) => Promise<void>
  onDeleteSkill: (n: string) => Promise<void>; onBack: () => void; onContinue: () => void
}) {
  const [tabIndex, setTabIndex] = useState(0)
  const [globalSearch, setGlobalSearch] = useState('')
  const [createToolOpen, setCreateToolOpen] = useState(false)
  const [createSkillOpen, setCreateSkillOpen] = useState(false)
  const [skillSaving, setSkillSaving] = useState(false)
  const [skillSaveError, setSkillSaveError] = useState('')
  const [associating, setAssociating] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [deletingSkill, setDeletingSkill] = useState<string | null>(null)

  const agentToolIds = new Set(agentTools.map(t => t.tool_id))
  const filteredGlobal = globalTools.filter(t =>
    !globalSearch.trim() || t.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(globalSearch.toLowerCase())
  )

  const handleAssociate = async (id: string) => { setAssociating(id); try { await onAssociateTool(id) } finally { setAssociating(null) } }
  const handleRemove = async (id: string) => { setRemoving(id); try { await onRemoveAgentTool(id) } finally { setRemoving(null) } }
  const handleCreateTool = async (t: Partial<ToolRecord>) => { await onCreateAgentTool(t); setCreateToolOpen(false) }
  const handleAddSkill = async (n: string, c: string) => {
    setSkillSaving(true); setSkillSaveError('')
    try { await onAddSkill(n, c); setCreateSkillOpen(false) }
    catch (e: unknown) { setSkillSaveError((e as { detail?: string })?.detail ?? String(e)) }
    finally { setSkillSaving(false) }
  }
  const handleDeleteSkill = async (n: string) => { setDeletingSkill(n); try { await onDeleteSkill(n) } finally { setDeletingSkill(null) } }

  return (
    <Box>
      <BackButton currentStep="tools" onBack={onBack} />
      <Typography variant="h5" fontWeight={700} gutterBottom>Tools &amp; Custom Context</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Add callable tools and domain context for{' '}
        <Box component="span" fontFamily="monospace" sx={{ color: 'primary.main' }}>{agentName}</Box>.
        Both are optional.
      </Typography>

      {loadingTools && <LinearProgress sx={{ mb: 2 }} />}
      {toolsError && <Alert severity="error" sx={{ mb: 2, fontSize: '0.75rem' }}>{toolsError}</Alert>}

      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
        <Tab label={`Tools (${agentTools.length})`} />
        <Tab label={`Custom Context (${agentSkills.length})`} />
      </Tabs>

      {tabIndex === 0 && (
        <Stack spacing={3}>
          <Box>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Global Tools (from registry)</Typography>
            <TextField size="small" placeholder="Search tools…" value={globalSearch} onChange={e => setGlobalSearch(e.target.value)} fullWidth sx={{ mb: 1.5 }} />
            {filteredGlobal.length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>No global tools found.</Typography>
            ) : (
              <Stack spacing={0.75}>
                {filteredGlobal.map(tool => {
                  const isAdded = agentToolIds.has(tool.tool_id)
                  return (
                    <Paper key={tool.tool_id} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={500}>{tool.display_name ?? tool.name}</Typography>
                        {tool.description && <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{tool.description}</Typography>}
                      </Box>
                      {isAdded ? (
                        <Chip label="Added" size="small" color="success" icon={<CheckCircleOutlineIcon />} sx={{ fontSize: '0.7rem' }} />
                      ) : (
                        <Button size="small" variant="outlined" startIcon={associating === tool.tool_id ? <CircularProgress size={12} /> : <AddIcon />} onClick={() => handleAssociate(tool.tool_id)} disabled={associating === tool.tool_id}>Add</Button>
                      )}
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Box>
          <Divider />
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>Agent-specific Tools</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateToolOpen(true)}>Create Tool</Button>
            </Box>
            {agentTools.filter(t => t.scope === 'agent').length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>No agent-specific tools yet.</Typography>
            ) : (
              <Stack spacing={0.75}>
                {agentTools.filter(t => t.scope === 'agent').map(tool => (
                  <Paper key={tool.tool_id} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{tool.name}</Typography>
                      {tool.endpoint && <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><LinkIcon sx={{ fontSize: 11 }} />{tool.method ?? 'POST'} {tool.endpoint}</Typography>}
                    </Box>
                    <IconButton size="small" color="error" onClick={() => handleRemove(tool.tool_id)} disabled={removing === tool.tool_id}>
                      {removing === tool.tool_id ? <CircularProgress size={14} /> : <DeleteIcon fontSize="small" />}
                    </IconButton>
                  </Paper>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      )}

      {tabIndex === 1 && (
        <Box>
          <Alert severity="info" sx={{ mb: 2, fontSize: '0.75rem' }}>
            <strong>Custom Context</strong> is domain knowledge injected into the generation prompt (step 3) — rules, output formats, terminology. It is baked into the generated role file, not stored separately after deployment.
          </Alert>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateSkillOpen(true)}>Add Context</Button>
          </Box>
          {agentSkills.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>No custom context yet. Add domain rules or output format requirements to improve generation quality.</Typography>
          ) : (
            <Stack spacing={0.75}>
              {agentSkills.map(skill => (
                <Paper key={skill.name} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={500} fontFamily="monospace">{skill.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {skill.content.slice(0, 120)}{skill.content.length > 120 ? '…' : ''}
                    </Typography>
                  </Box>
                  <IconButton size="small" color="error" onClick={() => handleDeleteSkill(skill.name)} disabled={deletingSkill === skill.name}>
                    {deletingSkill === skill.name ? <CircularProgress size={14} /> : <DeleteIcon fontSize="small" />}
                  </IconButton>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 3, mt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack}>Back</Button>
        <Button variant="contained" size="large" onClick={onContinue} sx={{ minWidth: 140 }}>Continue</Button>
      </Box>

      <ToolFormDialog open={createToolOpen} onClose={() => setCreateToolOpen(false)} onSave={handleCreateTool} title="Create Agent-Specific Tool" />
      <CreateContextDialog open={createSkillOpen} onClose={() => setCreateSkillOpen(false)} onSave={handleAddSkill} saving={skillSaving} saveError={skillSaveError} />
    </Box>
  )
}

// ── Editable file header ──────────────────────────────────────────────────────

function FileHeader({ filename, language }: { filename: string; language: string }) {
  return (
    <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default', display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="caption" fontFamily="monospace" fontWeight={600}>{filename}</Typography>
      <Typography variant="caption" color="text.secondary">— {language}</Typography>
      <Box sx={{ flexGrow: 1 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, bgcolor: 'action.selected', px: 0.75, py: 0.2, borderRadius: 0.75 }}>
        <EditNoteIcon sx={{ fontSize: 12, color: 'primary.main' }} />
        <Typography variant="caption" sx={{ fontSize: '0.62rem', color: 'primary.main', fontWeight: 600 }}>Editable</Typography>
      </Box>
    </Box>
  )
}

// ── Step 3: Generate ──────────────────────────────────────────────────────────

function StepGenerate({ agentName, agentTools, agentSkills, behavior, setBehavior, generating, generatedSpec, setGeneratedSpec, generatedRole, setGeneratedRole, generateError, previewTab, setPreviewTab, onGenerate, onBack, onContinue }: {
  agentName: string; agentTools: ToolRecord[]; agentSkills: SkillRecord[]
  behavior: string; setBehavior: (v: string) => void; generating: boolean
  generatedSpec: string; setGeneratedSpec: (v: string) => void
  generatedRole: string; setGeneratedRole: (v: string) => void
  generateError: string; previewTab: number; setPreviewTab: (v: number) => void
  onGenerate: () => void; onBack: () => void; onContinue: () => void
}) {
  const canGenerate = behavior.trim().length > 0 && !generating
  const hasGenerated = generatedSpec.length > 0 || generatedRole.length > 0

  return (
    <Box>
      <BackButton currentStep="generate" onBack={onBack} />
      <Typography variant="h5" fontWeight={700} gutterBottom>Describe how your agent should behave</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The AI will generate a spec and role file from your description, tools, and custom context.
        {agentSkills.length > 0 && ` Your ${agentSkills.length} custom context item${agentSkills.length > 1 ? 's' : ''} will be injected into the prompt.`}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Chip label={`${agentTools.length} tool${agentTools.length !== 1 ? 's' : ''}`} size="small" variant="outlined" icon={<CodeIcon sx={{ fontSize: 14 }} />} />
        <Chip label={`${agentSkills.length} custom context`} size="small" variant="outlined" icon={<PsychologyIcon sx={{ fontSize: 14 }} />} />
      </Box>

      <TextField
        label="Agent behavior *" value={behavior} onChange={e => setBehavior(e.target.value)}
        fullWidth multiline minRows={5} maxRows={12}
        placeholder="Describe when this agent should run, how it should use each tool, what decisions it makes, and what it outputs. Be specific about inputs, conditions, and expected outputs."
        disabled={generating}
        sx={{ mb: 2, '& textarea': { fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 } }}
      />

      <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Button variant="contained" size="large" onClick={onGenerate} disabled={!canGenerate}
          startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <PsychologyIcon />}>
          {generating ? 'Generating…' : hasGenerated ? 'Regenerate' : 'Generate'}
        </Button>
        {hasGenerated && !generating && (
          <Tooltip title="Generating again will overwrite the current role and spec">
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
              You can regenerate any time — your edits below are preserved until you click Regenerate.
            </Typography>
          </Tooltip>
        )}
      </Box>

      {generating && <LinearProgress sx={{ mb: 2 }} />}
      {generateError && <Alert severity="error" sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>{generateError}</Alert>}

      {hasGenerated && (
        <Box sx={{ mt: 1 }}>
          <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }}>
            Generated successfully — you can edit both files below before continuing.
          </Alert>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Tabs value={previewTab} onChange={(_, v) => setPreviewTab(v)} sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Tab label="Role Markdown" sx={{ fontSize: '0.8rem' }} />
              <Tab label="Spec YAML" sx={{ fontSize: '0.8rem' }} />
            </Tabs>
            {previewTab === 0 && (
              <Box sx={{ position: 'relative' }}>
                <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, bgcolor: 'action.selected', px: 0.75, py: 0.25, borderRadius: 0.75, display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <EditNoteIcon sx={{ fontSize: 12, color: 'primary.main' }} />
                  <Typography sx={{ fontSize: '0.62rem', color: 'primary.main', fontWeight: 600 }}>Editable</Typography>
                </Box>
                <Box component="textarea" value={generatedRole} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGeneratedRole(e.target.value)} spellCheck={false}
                  sx={{ display: 'block', width: '100%', minHeight: 320, m: 0, p: 2, boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6, bgcolor: 'background.default', border: 'none', outline: 'none', resize: 'vertical', color: 'text.primary' }} />
              </Box>
            )}
            {previewTab === 1 && (
              <Box sx={{ position: 'relative' }}>
                <Box sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, bgcolor: 'action.selected', px: 0.75, py: 0.25, borderRadius: 0.75, display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <EditNoteIcon sx={{ fontSize: 12, color: 'primary.main' }} />
                  <Typography sx={{ fontSize: '0.62rem', color: 'primary.main', fontWeight: 600 }}>Editable</Typography>
                </Box>
                <Box component="textarea" value={generatedSpec} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setGeneratedSpec(e.target.value)} spellCheck={false}
                  sx={{ display: 'block', width: '100%', minHeight: 320, m: 0, p: 2, boxSizing: 'border-box', fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6, bgcolor: 'background.default', border: 'none', outline: 'none', resize: 'vertical', color: 'text.primary' }} />
              </Box>
            )}
          </Paper>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, ml: 0.5 }}>
            Click inside either editor to modify directly. Changes carry through to the Deploy step.
          </Typography>
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 3, mt: 2, borderTop: 1, borderColor: 'divider' }}>
        <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack}>Back</Button>
        <Tooltip title={!hasGenerated ? 'Generate the spec first' : ''}>
          <span>
            <Button variant="contained" size="large" onClick={onContinue} disabled={!hasGenerated} sx={{ minWidth: 140 }}>
              Continue to Deploy
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}

// ── Step 4: Deploy ────────────────────────────────────────────────────────────

function injectGuardrails(specYaml: string, enabled: boolean): string {
  if (enabled) return specYaml
  const trimmed = specYaml.trimEnd()
  if (trimmed.includes('guardrails:')) return trimmed
  return trimmed + '\n  guardrails:\n    agentarmor: false\n'
}

function StepDeploy({ agentName, generatedSpec, setGeneratedSpec, generatedRole, setGeneratedRole, guardrailEnabled, setGuardrailEnabled, deploying, deployError, deployed, onDeployDirect, onSubmitApproval, onBack }: {
  agentName: string; generatedSpec: string; setGeneratedSpec: (v: string) => void
  generatedRole: string; setGeneratedRole: (v: string) => void
  guardrailEnabled: boolean; setGuardrailEnabled: (v: boolean) => void
  deploying: boolean; deployError: string; deployed: boolean
  onDeployDirect: () => void; onSubmitApproval: () => void; onBack: () => void
}) {
  return (
    <Box>
      <BackButton currentStep="deploy" onBack={onBack} />
      <Typography variant="h5" fontWeight={700} gutterBottom>Review and deploy</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Edit the spec and role file for{' '}
        <Box component="span" fontFamily="monospace" sx={{ color: 'primary.main' }}>{agentName}</Box>
        {' '}if needed, then deploy.
      </Typography>

      <Stack spacing={2} sx={{ mb: 3 }}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <FileHeader filename="role.md" language="Markdown — agent persona and instructions" />
          <Editor
            height="280px"
            language="markdown"
            value={generatedRole}
            onChange={v => setGeneratedRole(v ?? '')}
            loading={
              <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
                <CircularProgress size={20} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>Loading editor…</Typography>
              </Box>
            }
            options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 12, scrollBeyondLastLine: false, lineNumbers: 'off' }}
          />
        </Paper>

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <FileHeader filename="agent-spec.yaml" language="YAML — deployment spec" />
          <Editor
            height="280px"
            language="yaml"
            value={generatedSpec}
            onChange={v => setGeneratedSpec(v ?? '')}
            loading={
              <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
                <CircularProgress size={20} />
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>Loading editor…</Typography>
              </Box>
            }
            options={{ minimap: { enabled: false }, wordWrap: 'on', fontSize: 12, scrollBeyondLastLine: false, lineNumbers: 'off' }}
          />
        </Paper>
      </Stack>

      {deployError && <Alert severity="error" sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>{deployError}</Alert>}

      {deployed ? (
        <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }}>
          Agent deployed successfully. Redirecting to agent page…
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <SecurityIcon fontSize="small" color={guardrailEnabled ? 'primary' : 'disabled'} />
              <Typography variant="subtitle2" fontWeight={600}>AgentArmor Guardrails</Typography>
              <Chip size="small" label={guardrailEnabled ? 'ON' : 'OFF'} color={guardrailEnabled ? 'success' : 'default'} sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }} />
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.25, ml: 3.5 }}>
              10-layer security scanning: prompt injection, PII redaction, planning risk, output scanning, exfiltration detection.
            </Typography>
            <FormControlLabel sx={{ ml: 2.5 }}
              control={<Switch checked={guardrailEnabled} onChange={e => setGuardrailEnabled(e.target.checked)} size="small" color="primary" />}
              label={<Typography variant="caption" color="text.secondary">{guardrailEnabled ? 'Guardrails active for this agent' : 'Guardrails disabled — use only in trusted environments'}</Typography>}
            />
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>Deploy options</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 1 }}>
              <Button variant="contained" color="success" size="large" onClick={onDeployDirect} disabled={deploying}
                startIcon={deploying ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}>
                Deploy directly
              </Button>
              <Button variant="outlined" size="large" onClick={onSubmitApproval} disabled={deploying}>
                Submit for approval
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              "Deploy directly" bypasses the approval queue. Use "Submit for approval" to follow the governance workflow.
            </Typography>
          </Paper>
        </Stack>
      )}

      {!deployed && (
        <Box sx={{ display: 'flex', pt: 2 }}>
          <Button variant="text" startIcon={<ArrowBackIcon />} onClick={onBack}>Back to Generate</Button>
        </Box>
      )}
    </Box>
  )
}

// ── Main Builder ─────────────────────────────────────────────────────────────

export default function Builder() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editAgentName = searchParams.get('edit') ?? ''
  const editMode = Boolean(editAgentName)
  const { identity } = useAuth()

  // Wizard state
  const [currentStep, setCurrentStep] = useState<StepId>(editMode ? 'basics' : 'basics')
  const [stepStatus, setStepStatus] = useState<Record<StepId, StepStatus>>({
    basics: editMode ? 'complete' : 'active',
    tools: 'pending', generate: 'pending', deploy: 'pending',
  })
  const [loadingEdit, setLoadingEdit] = useState(editMode)

  // Step 1
  const [agentName, setAgentName] = useState(editAgentName)
  const [description, setDescription] = useState('')
  const [provisioning, setProvisioning] = useState(false)
  const [provisionError, setProvisionError] = useState('')

  // Step 2
  const [agentTools, setAgentTools] = useState<ToolRecord[]>([])
  const [globalTools, setGlobalTools] = useState<ToolRecord[]>([])
  const [agentSkills, setAgentSkills] = useState<SkillRecord[]>([])
  const [loadingTools, setLoadingTools] = useState(false)
  const [toolsError, setToolsError] = useState('')

  // Step 3
  const [behavior, setBehavior] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedSpec, setGeneratedSpec] = useState('')
  const [generatedRole, setGeneratedRole] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [previewTab, setPreviewTab] = useState(0)

  // Step 4
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState('')
  const [deployed, setDeployed] = useState(false)
  const [guardrailEnabled, setGuardrailEnabled] = useState(true)

  // Load existing agent data in edit mode
  useEffect(() => {
    if (!editMode) return
    const load = async () => {
      setLoadingEdit(true)
      try {
        const [agentData, toolsData, skillsData, globalToolsData, draftData] = await Promise.all([
          builderApi.getAgent(editAgentName),
          builderApi.getAgentTools(editAgentName).catch(() => ({ tools: [] })),
          builderApi.getAgentSkills(editAgentName).catch(() => ({ skills: [] })),
          builderApi.listGlobalTools().catch(() => ({ tools: [] })),
          builderApi.getDraft(editAgentName).catch(() => ({ spec_yaml: '', role_md: '', has_draft: false })),
        ])
        setAgentName(agentData.name)
        setDescription(agentData.description || '')
        setAgentTools(toolsData.tools)
        setGlobalTools(globalToolsData.tools)
        setAgentSkills(skillsData.skills)
        if (draftData.spec_yaml) setGeneratedSpec(draftData.spec_yaml)
        if (draftData.role_md) setGeneratedRole(draftData.role_md)
        // Mark all prior steps complete, start at generate
        setStepStatus({
          basics: 'complete', tools: 'complete',
          generate: draftData.has_draft ? 'complete' : 'active',
          deploy: 'pending',
        })
        setCurrentStep(draftData.has_draft ? 'deploy' : 'generate')
      } catch (e) {
        console.error('Failed to load agent for editing', e)
      } finally {
        setLoadingEdit(false)
      }
    }
    load()
  }, [editAgentName, editMode])

  // ── Navigation ──

  const goToStep = useCallback((id: StepId) => {
    setCurrentStep(id)
    setStepStatus(s => ({ ...s, [id]: 'active' }))
  }, [])

  const completeStep = useCallback((id: StepId, next: StepId) => {
    setStepStatus(s => ({ ...s, [id]: 'complete', [next]: 'active' }))
    setCurrentStep(next)
  }, [])

  const goBack = useCallback(() => {
    const idx = STEP_ORDER.indexOf(currentStep)
    if (idx > 0) goToStep(STEP_ORDER[idx - 1])
  }, [currentStep, goToStep])

  // ── Step 1 ──

  const handleProvision = async () => {
    if (editMode) { completeStep('basics', 'tools'); return }
    setProvisioning(true); setProvisionError('')
    try {
      await builderApi.provisionAgent(agentName, description)
      setLoadingTools(true)
      try {
        const [gt, at, sk] = await Promise.all([
          builderApi.listGlobalTools().catch(() => ({ tools: [] })),
          builderApi.getAgentTools(agentName).catch(() => ({ tools: [] })),
          builderApi.getAgentSkills(agentName).catch(() => ({ skills: [] })),
        ])
        setGlobalTools(gt.tools); setAgentTools(at.tools); setAgentSkills(sk.skills)
      } catch { /* non-fatal */ } finally { setLoadingTools(false) }
      completeStep('basics', 'tools')
    } catch (e: unknown) {
      setProvisionError((e as { detail?: string })?.detail ?? String(e))
    } finally { setProvisioning(false) }
  }

  // ── Step 2 ──

  const handleAssociateTool = async (id: string) => { const r = await builderApi.associateGlobalTool(agentName, id); setAgentTools(r.tools) }
  const handleCreateAgentTool = async (t: Partial<ToolRecord>) => { const r = await builderApi.addAgentTool(agentName, t); setAgentTools(r.tools) }
  const handleRemoveAgentTool = async (id: string) => { const r = await builderApi.removeAgentTool(agentName, id); setAgentTools(r.tools) }
  const handleAddSkill = async (n: string, c: string) => { const r = await builderApi.upsertSkill(agentName, n, c); setAgentSkills(r.skills) }
  const handleDeleteSkill = async (n: string) => { const r = await builderApi.deleteSkill(agentName, n); setAgentSkills(r.skills) }

  // ── Step 3 ──

  const handleGenerate = async () => {
    setGenerating(true); setGenerateError('')
    try {
      const r = await builderApi.generateAgent(agentName, behavior)
      setGeneratedSpec(r.spec_yaml ?? ''); setGeneratedRole(r.role_md ?? '')
    } catch (e: unknown) {
      setGenerateError((e as { detail?: string })?.detail ?? String(e))
    } finally { setGenerating(false) }
  }

  // ── Step 4 ──

  const handleDeployDirect = async () => {
    setDeploying(true); setDeployError('')
    try {
      const spec = injectGuardrails(generatedSpec, guardrailEnabled)
      await builderApi.deployDirect(agentName, '', spec, generatedRole)
      setDeployed(true)
      setStepStatus(s => ({ ...s, deploy: 'complete' }))
      setTimeout(() => navigate(`/agents/${agentName}`), 2000)
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setDeployError(msg); setStepStatus(s => ({ ...s, deploy: 'error' }))
    } finally { setDeploying(false) }
  }

  const handleSubmitApproval = async () => {
    setDeploying(true); setDeployError('')
    try {
      const spec = injectGuardrails(generatedSpec, guardrailEnabled)
      await builderApi.submitDeployRequest(agentName, '', spec, generatedRole)
      setDeployed(true)
      setStepStatus(s => ({ ...s, deploy: 'complete' }))
      setTimeout(() => navigate(`/agents/${agentName}`), 2000)
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setDeployError(msg); setStepStatus(s => ({ ...s, deploy: 'error' }))
    } finally { setDeploying(false) }
  }

  // ── Render ──

  if (loadingEdit) {
    return (
      <Box sx={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
        <CircularProgress size={24} />
        <Typography color="text.secondary">Loading agent for editing…</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default' }}>
      <StepTree steps={STEPS} currentStep={currentStep} stepStatus={stepStatus} onStepClick={goToStep} editMode={editMode} />
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 3, md: 4 } }}>
        <Paper elevation={0} sx={{ maxWidth: 800, mx: 'auto', p: { xs: 2, sm: 3, md: 4 }, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          {currentStep === 'basics' && (
            <StepBasics agentName={agentName} setAgentName={setAgentName} description={description} setDescription={setDescription} provisioning={provisioning} provisionError={provisionError} onContinue={handleProvision} identity={identity} editMode={editMode} />
          )}
          {currentStep === 'tools' && (
            <StepTools agentName={agentName} agentTools={agentTools} globalTools={globalTools} agentSkills={agentSkills} loadingTools={loadingTools} toolsError={toolsError} onAssociateTool={handleAssociateTool} onCreateAgentTool={handleCreateAgentTool} onRemoveAgentTool={handleRemoveAgentTool} onAddSkill={handleAddSkill} onDeleteSkill={handleDeleteSkill} onBack={goBack} onContinue={() => completeStep('tools', 'generate')} />
          )}
          {currentStep === 'generate' && (
            <StepGenerate agentName={agentName} agentTools={agentTools} agentSkills={agentSkills} behavior={behavior} setBehavior={setBehavior} generating={generating} generatedSpec={generatedSpec} setGeneratedSpec={setGeneratedSpec} generatedRole={generatedRole} setGeneratedRole={setGeneratedRole} generateError={generateError} previewTab={previewTab} setPreviewTab={setPreviewTab} onGenerate={handleGenerate} onBack={goBack} onContinue={() => completeStep('generate', 'deploy')} />
          )}
          {currentStep === 'deploy' && (
            <StepDeploy agentName={agentName} generatedSpec={generatedSpec} setGeneratedSpec={setGeneratedSpec} generatedRole={generatedRole} setGeneratedRole={setGeneratedRole} guardrailEnabled={guardrailEnabled} setGuardrailEnabled={setGuardrailEnabled} deploying={deploying} deployError={deployError} deployed={deployed} onDeployDirect={handleDeployDirect} onSubmitApproval={handleSubmitApproval} onBack={goBack} />
          )}
        </Paper>
      </Box>
    </Box>
  )
}
