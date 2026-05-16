import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, TextField, Button, Paper, Chip, IconButton,
  CircularProgress, Alert, Divider, Stack, Tooltip, Dialog,
  DialogTitle, DialogContent, DialogActions, Tabs, Tab,
  LinearProgress,
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
import { builderApi, ToolRecord, SkillRecord } from '../../api/builder'
import { useAuth } from '../../context/AuthContext'
import ToolFormDialog from '../../components/ToolFormDialog'

// ── Types ────────────────────────────────────────────────────────────────────

type StepId = 'basics' | 'tools' | 'generate' | 'deploy'
type StepStatus = 'pending' | 'active' | 'complete' | 'error'

interface WizardStep {
  id: StepId
  num: number
  label: string
  sublabel: string
  icon: React.ReactNode
}

const STEPS: WizardStep[] = [
  { id: 'basics',   num: 1, label: 'Basic Info',     sublabel: 'Name & description',  icon: <StorageIcon /> },
  { id: 'tools',    num: 2, label: 'Tools & Skills',  sublabel: 'Capabilities',        icon: <CodeIcon /> },
  { id: 'generate', num: 3, label: 'Generate',        sublabel: 'Describe behavior',   icon: <PsychologyIcon /> },
  { id: 'deploy',   num: 4, label: 'Deploy',          sublabel: 'Review & launch',     icon: <RocketLaunchIcon /> },
]

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepIndicator({ status, num }: { status: StepStatus; num: number }) {
  if (status === 'complete') {
    return <CheckCircleIcon sx={{ color: 'success.main', fontSize: 28, flexShrink: 0 }} />
  }
  if (status === 'error') {
    return <ErrorIcon sx={{ color: 'error.main', fontSize: 28, flexShrink: 0 }} />
  }
  if (status === 'active') {
    return (
      <Box sx={{
        width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 0 3px rgba(25,118,210,0.2)', flexShrink: 0,
      }}>
        <Typography sx={{ color: 'white', fontWeight: 700, fontSize: 13, lineHeight: 1 }}>{num}</Typography>
      </Box>
    )
  }
  // pending
  return (
    <Box sx={{
      width: 28, height: 28, borderRadius: '50%', border: 2, borderColor: 'divider',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <Typography sx={{ color: 'text.disabled', fontWeight: 600, fontSize: 13, lineHeight: 1 }}>{num}</Typography>
    </Box>
  )
}

// ── Step Tree ─────────────────────────────────────────────────────────────────

interface StepTreeProps {
  steps: WizardStep[]
  currentStep: StepId
  stepStatus: Record<StepId, StepStatus>
  onStepClick: (id: StepId) => void
}

function StepTree({ steps, currentStep, stepStatus, onStepClick }: StepTreeProps) {
  return (
    <Box sx={{
      width: 240,
      flexShrink: 0,
      borderRight: 1,
      borderColor: 'divider',
      bgcolor: 'background.paper',
      pt: 4,
      pb: 2,
      px: 2,
    }}>
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ px: 1, mb: 2, display: 'block', letterSpacing: 2, fontSize: '0.65rem' }}
      >
        NEW AGENT
      </Typography>

      {steps.map((step, idx) => {
        const status = stepStatus[step.id]
        const isLast = idx === steps.length - 1
        const isClickable = status === 'complete'

        return (
          <Box key={step.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                cursor: isClickable ? 'pointer' : 'default',
                py: 0.75,
                px: 1,
                borderRadius: 1.5,
                width: '100%',
                transition: 'background-color 0.15s',
                '&:hover': isClickable ? { bgcolor: 'action.hover' } : {},
              }}
              onClick={() => isClickable && onStepClick(step.id)}
            >
              <StepIndicator status={status} num={step.num} />
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: status === 'active' ? 700 : 400,
                    color: status === 'pending' ? 'text.disabled' : 'text.primary',
                    lineHeight: 1.2,
                  }}
                >
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3, display: 'block' }}>
                  {step.sublabel}
                </Typography>
              </Box>
            </Box>

            {!isLast && (
              <Box sx={{
                ml: 2.25,
                width: 2,
                height: 24,
                bgcolor: status === 'complete' ? 'success.main' : 'divider',
                borderRadius: 1,
                transition: 'background-color 0.3s',
              }} />
            )}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Step 1: Basic Info ────────────────────────────────────────────────────────

interface StepBasicsProps {
  agentName: string
  setAgentName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  provisioning: boolean
  provisionError: string
  onContinue: () => void
  identity: string
}

function StepBasics({
  agentName, setAgentName,
  description, setDescription,
  provisioning, provisionError,
  onContinue, identity,
}: StepBasicsProps) {
  const nameValid = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/.test(agentName)
  const nameError = agentName && !nameValid
    ? 'Lowercase letters, numbers, hyphens only. 3–40 chars. Must start and end with a letter or digit.'
    : ''
  const canContinue = nameValid && description.trim().length > 0 && !provisioning

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Create a new agent
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Give your agent a name and description. This provisions a service identity immediately — you can close and
        resume from the agent list.
      </Typography>

      <Stack spacing={3}>
        <TextField
          label="Agent Name *"
          value={agentName}
          onChange={e => setAgentName(e.target.value.toLowerCase().replace(/\s/g, '-'))}
          fullWidth
          error={!!nameError}
          helperText={nameError || 'Used as the agent\'s identifier. Cannot be changed after creation.'}
          placeholder="my-kyc-agent"
          inputProps={{ spellCheck: false }}
          disabled={provisioning}
        />

        <TextField
          label="Description *"
          value={description}
          onChange={e => setDescription(e.target.value.slice(0, 500))}
          fullWidth
          multiline
          minRows={3}
          maxRows={6}
          placeholder="Describe what this agent does, the domain it operates in, and the outcomes it produces."
          helperText={`${description.length}/500`}
          disabled={provisioning}
        />

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
            Owner (auto-assigned)
          </Typography>
          <Chip
            label={identity || 'user:builder@atom.io'}
            size="small"
            sx={{ fontFamily: 'monospace', fontSize: '0.72rem' }}
          />
        </Box>

        {provisionError && (
          <Alert severity="error" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
            {provisionError}
          </Alert>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 1 }}>
          <Button
            variant="contained"
            size="large"
            onClick={onContinue}
            disabled={!canContinue}
            startIcon={provisioning ? <CircularProgress size={16} color="inherit" /> : undefined}
            sx={{ minWidth: 140 }}
          >
            {provisioning ? 'Provisioning…' : 'Continue'}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}

// ── Create Skill Dialog ───────────────────────────────────────────────────────

interface CreateSkillDialogProps {
  open: boolean
  onClose: () => void
  onSave: (skillName: string, content: string) => Promise<void>
  saving: boolean
  saveError: string
}

function CreateSkillDialog({ open, onClose, onSave, saving, saveError }: CreateSkillDialogProps) {
  const [skillName, setSkillName] = useState('')
  const [content, setContent] = useState('')

  const reset = () => { setSkillName(''); setContent('') }
  const handleClose = () => { reset(); onClose() }
  const handleSave = async () => {
    await onSave(skillName, content)
    reset()
  }
  const canSave = skillName.trim() && content.trim() && !saving

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Skill</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <TextField label="Skill Name *" value={skillName} onChange={e => setSkillName(e.target.value)} fullWidth />
          <TextField
            label="Content *"
            value={content}
            onChange={e => setContent(e.target.value)}
            fullWidth
            multiline
            minRows={6}
            placeholder="# Skill: My Custom Behavior&#10;&#10;Describe the skill instructions in markdown..."
            inputProps={{ style: { fontFamily: 'monospace', fontSize: '0.82rem' } }}
          />
          {saveError && <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{saveError}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!canSave}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}>
          Save Skill
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Step 2: Tools & Skills ────────────────────────────────────────────────────

interface StepToolsProps {
  agentName: string
  agentTools: ToolRecord[]
  globalTools: ToolRecord[]
  agentSkills: SkillRecord[]
  loadingTools: boolean
  toolsError: string
  onAssociateTool: (toolId: string) => Promise<void>
  onCreateAgentTool: (tool: Partial<ToolRecord>) => Promise<void>
  onRemoveAgentTool: (toolId: string) => Promise<void>
  onAddSkill: (skillName: string, content: string) => Promise<void>
  onDeleteSkill: (skillName: string) => Promise<void>
  onContinue: () => void
}

function StepTools({
  agentName,
  agentTools,
  globalTools,
  agentSkills,
  loadingTools,
  toolsError,
  onAssociateTool,
  onCreateAgentTool,
  onRemoveAgentTool,
  onAddSkill,
  onDeleteSkill,
  onContinue,
}: StepToolsProps) {
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
    !globalSearch.trim() ||
    t.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
    (t.description ?? '').toLowerCase().includes(globalSearch.toLowerCase())
  )

  const handleAssociate = async (toolId: string) => {
    setAssociating(toolId)
    try { await onAssociateTool(toolId) } finally { setAssociating(null) }
  }

  const handleRemove = async (toolId: string) => {
    setRemoving(toolId)
    try { await onRemoveAgentTool(toolId) } finally { setRemoving(null) }
  }

  const handleCreateTool = async (tool: Partial<ToolRecord>) => {
    await onCreateAgentTool(tool)
    setCreateToolOpen(false)
  }

  const handleAddSkill = async (skillName: string, content: string) => {
    setSkillSaving(true)
    setSkillSaveError('')
    try {
      await onAddSkill(skillName, content)
      setCreateSkillOpen(false)
    } catch (e: unknown) {
      setSkillSaveError((e as { detail?: string })?.detail ?? String(e))
    } finally {
      setSkillSaving(false)
    }
  }

  const handleDeleteSkill = async (skillName: string) => {
    setDeletingSkill(skillName)
    try { await onDeleteSkill(skillName) } finally { setDeletingSkill(null) }
  }

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Tools &amp; Skills
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Add tools and skills to give{' '}
        <Box component="span" fontFamily="monospace" sx={{ color: 'primary.main' }}>{agentName}</Box>
        {' '}its capabilities. Both are optional — you can continue anytime.
      </Typography>

      {loadingTools && <LinearProgress sx={{ mb: 2 }} />}
      {toolsError && <Alert severity="error" sx={{ mb: 2, fontSize: '0.75rem' }}>{toolsError}</Alert>}

      <Tabs value={tabIndex} onChange={(_, v) => setTabIndex(v)} sx={{ mb: 2 }}>
        <Tab label={`Tools (${agentTools.length})`} />
        <Tab label={`Skills (${agentSkills.length})`} />
      </Tabs>

      {tabIndex === 0 && (
        <Stack spacing={3}>
          {/* Global tools */}
          <Box>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
              Global Tools (from registry)
            </Typography>
            <TextField
              size="small"
              placeholder="Search tools…"
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              fullWidth
              sx={{ mb: 1.5 }}
            />
            {filteredGlobal.length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
                No global tools found.
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                {filteredGlobal.map(tool => {
                  const isAdded = agentToolIds.has(tool.tool_id)
                  return (
                    <Paper key={tool.tool_id} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight={500}>{tool.display_name ?? tool.name}</Typography>
                        {tool.description && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {tool.description}
                          </Typography>
                        )}
                      </Box>
                      {isAdded ? (
                        <Chip label="Added" size="small" color="success" icon={<CheckCircleOutlineIcon />} sx={{ fontSize: '0.7rem' }} />
                      ) : (
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={associating === tool.tool_id ? <CircularProgress size={12} /> : <AddIcon />}
                          onClick={() => handleAssociate(tool.tool_id)}
                          disabled={associating === tool.tool_id}
                        >
                          Add
                        </Button>
                      )}
                    </Paper>
                  )
                })}
              </Stack>
            )}
          </Box>

          <Divider />

          {/* Agent-specific tools */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" fontWeight={600}>Agent-specific Tools</Typography>
              <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateToolOpen(true)}>
                Create Tool
              </Button>
            </Box>
            {agentTools.filter(t => t.scope === 'agent').length === 0 ? (
              <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
                No agent-specific tools yet.
              </Typography>
            ) : (
              <Stack spacing={0.75}>
                {agentTools.filter(t => t.scope === 'agent').map(tool => (
                  <Paper key={tool.tool_id} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight={500}>{tool.name}</Typography>
                      {tool.endpoint && (
                        <Typography variant="caption" color="text.secondary" fontFamily="monospace" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          <LinkIcon sx={{ fontSize: 11 }} />
                          {tool.method ?? 'POST'} {tool.endpoint}
                        </Typography>
                      )}
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
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Skills are custom knowledge or behavior instructions injected into the agent's context.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setCreateSkillOpen(true)}>
              Add Skill
            </Button>
          </Box>
          {agentSkills.length === 0 ? (
            <Typography variant="body2" color="text.disabled" sx={{ py: 1 }}>
              No skills yet. Add a skill to shape the agent's behavior.
            </Typography>
          ) : (
            <Stack spacing={0.75}>
              {agentSkills.map(skill => (
                <Paper key={skill.name} variant="outlined" sx={{ px: 2, py: 1.25, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1 }}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" fontWeight={500} fontFamily="monospace">{skill.name}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                      {skill.content.slice(0, 80)}{skill.content.length > 80 ? '…' : ''}
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

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 3, mt: 1, borderTop: 1, borderColor: 'divider' }}>
        <Button variant="contained" size="large" onClick={onContinue} sx={{ minWidth: 140 }}>
          Continue
        </Button>
      </Box>

      <ToolFormDialog
        open={createToolOpen}
        onClose={() => setCreateToolOpen(false)}
        onSave={handleCreateTool}
        title="Create Agent-Specific Tool"
      />
      <CreateSkillDialog
        open={createSkillOpen}
        onClose={() => setCreateSkillOpen(false)}
        onSave={handleAddSkill}
        saving={skillSaving}
        saveError={skillSaveError}
      />
    </Box>
  )
}

// ── Step 3: Generate ──────────────────────────────────────────────────────────

interface StepGenerateProps {
  agentName: string
  agentTools: ToolRecord[]
  agentSkills: SkillRecord[]
  behavior: string
  setBehavior: (v: string) => void
  generating: boolean
  generatedSpec: string
  generatedRole: string
  generateError: string
  previewTab: number
  setPreviewTab: (v: number) => void
  onGenerate: () => void
  onContinue: () => void
}

function StepGenerate({
  agentName,
  agentTools,
  agentSkills,
  behavior,
  setBehavior,
  generating,
  generatedSpec,
  generatedRole,
  generateError,
  previewTab,
  setPreviewTab,
  onGenerate,
  onContinue,
}: StepGenerateProps) {
  const canGenerate = behavior.trim().length > 0 && !generating
  const hasGenerated = generatedSpec.length > 0 || generatedRole.length > 0

  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Describe how your agent should behave
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The AI will generate a spec and role file from your description, tools, and skills.
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Chip
          label={`${agentTools.length} tool${agentTools.length !== 1 ? 's' : ''}`}
          size="small"
          variant="outlined"
          icon={<CodeIcon sx={{ fontSize: 14 }} />}
        />
        <Chip
          label={`${agentSkills.length} skill${agentSkills.length !== 1 ? 's' : ''}`}
          size="small"
          variant="outlined"
          icon={<PsychologyIcon sx={{ fontSize: 14 }} />}
        />
      </Box>

      <TextField
        label="Agent behavior *"
        value={behavior}
        onChange={e => setBehavior(e.target.value)}
        fullWidth
        multiline
        minRows={5}
        maxRows={12}
        placeholder="Describe when this agent should run, how it should use each tool, what decisions it makes, and what it outputs. Be specific about inputs, conditions, and expected outputs."
        disabled={generating}
        sx={{ mb: 2, '& textarea': { fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 } }}
      />

      <Button
        variant="contained"
        size="large"
        onClick={onGenerate}
        disabled={!canGenerate}
        startIcon={generating ? <CircularProgress size={16} color="inherit" /> : <PsychologyIcon />}
        sx={{ mb: 2 }}
      >
        {generating ? 'Generating…' : 'Generate'}
      </Button>

      {generating && <LinearProgress sx={{ mb: 2 }} />}

      {generateError && (
        <Alert severity="error" sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {generateError}
        </Alert>
      )}

      {hasGenerated && (
        <Box sx={{ mt: 1 }}>
          <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }}>
            Generated successfully
          </Alert>

          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Tabs value={previewTab} onChange={(_, v) => setPreviewTab(v)} sx={{ px: 1, borderBottom: 1, borderColor: 'divider' }}>
              <Tab label="Role Markdown" sx={{ fontSize: '0.8rem' }} />
              <Tab label="Spec YAML" sx={{ fontSize: '0.8rem' }} />
            </Tabs>
            <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
              {previewTab === 0 && (
                <Box component="pre" sx={{ m: 0, p: 2, fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6, bgcolor: 'grey.50', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {generatedRole || '(no role file generated)'}
                </Box>
              )}
              {previewTab === 1 && (
                <Box component="pre" sx={{ m: 0, p: 2, fontFamily: 'monospace', fontSize: '0.78rem', lineHeight: 1.6, bgcolor: 'grey.50', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {generatedSpec || '(no spec generated)'}
                </Box>
              )}
            </Box>
          </Paper>
        </Box>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 3, mt: 2, borderTop: 1, borderColor: 'divider' }}>
        <Tooltip title={!hasGenerated ? 'Generate the spec first' : ''}>
          <span>
            <Button
              variant="contained"
              size="large"
              onClick={onContinue}
              disabled={!hasGenerated}
              sx={{ minWidth: 140 }}
            >
              Continue
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  )
}

// ── Step 4: Deploy ────────────────────────────────────────────────────────────

interface StepDeployProps {
  agentName: string
  generatedSpec: string
  generatedRole: string
  deploying: boolean
  deployError: string
  deployed: boolean
  onDeployDirect: () => void
  onSubmitApproval: () => void
}

function StepDeploy({
  agentName,
  generatedSpec,
  generatedRole,
  deploying,
  deployError,
  deployed,
  onDeployDirect,
  onSubmitApproval,
}: StepDeployProps) {
  return (
    <Box>
      <Typography variant="h5" fontWeight={700} gutterBottom>
        Review and deploy
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Review the generated spec and role file for{' '}
        <Box component="span" fontFamily="monospace" sx={{ color: 'primary.main' }}>{agentName}</Box>
        , then deploy or submit for approval.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 3 }}>
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
            <Typography variant="caption" fontFamily="monospace" fontWeight={600}>role.md</Typography>
          </Box>
          <Box
            component="pre"
            sx={{
              m: 0, p: 2,
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              lineHeight: 1.6,
              maxHeight: 400,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              bgcolor: 'grey.50',
            }}
          >
            {generatedRole || '(no role file)'}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Box sx={{ px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.default' }}>
            <Typography variant="caption" fontFamily="monospace" fontWeight={600}>agent-spec.yaml</Typography>
          </Box>
          <Box
            component="pre"
            sx={{
              m: 0, p: 2,
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              lineHeight: 1.6,
              maxHeight: 400,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              bgcolor: 'grey.50',
            }}
          >
            {generatedSpec || '(no spec)'}
          </Box>
        </Paper>
      </Box>

      {deployError && (
        <Alert severity="error" sx={{ mb: 2, fontFamily: 'monospace', fontSize: '0.75rem' }}>
          {deployError}
        </Alert>
      )}

      {deployed ? (
        <Alert severity="success" icon={<CheckCircleOutlineIcon />} sx={{ mb: 2 }}>
          Agent deployed successfully. Redirecting to agent page…
        </Alert>
      ) : (
        <Paper variant="outlined" sx={{ p: 2.5 }}>
          <Typography variant="subtitle2" fontWeight={600} gutterBottom>Deploy options</Typography>
          <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
            <Button
              variant="contained"
              color="success"
              size="large"
              onClick={onDeployDirect}
              disabled={deploying}
              startIcon={deploying ? <CircularProgress size={16} color="inherit" /> : <RocketLaunchIcon />}
            >
              Deploy directly
            </Button>
            <Button
              variant="outlined"
              size="large"
              onClick={onSubmitApproval}
              disabled={deploying}
            >
              Submit for approval
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            "Deploy directly" bypasses the approval queue. Use "Submit for approval" to follow the governance workflow.
          </Typography>
        </Paper>
      )}
    </Box>
  )
}

// ── Main Builder ─────────────────────────────────────────────────────────────

export default function Builder() {
  const navigate = useNavigate()
  const { identity } = useAuth()

  // Navigation state
  const [currentStep, setCurrentStep] = useState<StepId>('basics')
  const [stepStatus, setStepStatus] = useState<Record<StepId, StepStatus>>({
    basics: 'active',
    tools: 'pending',
    generate: 'pending',
    deploy: 'pending',
  })

  // Step 1 state
  const [agentName, setAgentName] = useState('')
  const [description, setDescription] = useState('')
  const [provisioning, setProvisioning] = useState(false)
  const [provisionError, setProvisionError] = useState('')

  // Step 2 state
  const [agentTools, setAgentTools] = useState<ToolRecord[]>([])
  const [globalTools, setGlobalTools] = useState<ToolRecord[]>([])
  const [agentSkills, setAgentSkills] = useState<SkillRecord[]>([])
  const [loadingTools, setLoadingTools] = useState(false)
  const [toolsError, setToolsError] = useState('')

  // Step 3 state
  const [behavior, setBehavior] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generatedSpec, setGeneratedSpec] = useState('')
  const [generatedRole, setGeneratedRole] = useState('')
  const [generateError, setGenerateError] = useState('')
  const [previewTab, setPreviewTab] = useState(0)

  // Step 4 state
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState('')
  const [deployed, setDeployed] = useState(false)

  // ── Navigation helpers ──

  const goToStep = useCallback((id: StepId) => {
    setCurrentStep(id)
    setStepStatus(s => ({ ...s, [id]: 'active' }))
  }, [])

  const completeStep = useCallback((id: StepId, next: StepId) => {
    setStepStatus(s => ({ ...s, [id]: 'complete', [next]: 'active' }))
    setCurrentStep(next)
  }, [])

  // ── Step 1: Provision ──

  const handleProvision = async () => {
    setProvisioning(true)
    setProvisionError('')
    try {
      await builderApi.provisionAgent(agentName, description)
      setLoadingTools(true)
      try {
        const [gt, at, sk] = await Promise.all([
          builderApi.listGlobalTools().catch(() => ({ tools: [] })),
          builderApi.getAgentTools(agentName).catch(() => ({ tools: [] })),
          builderApi.getAgentSkills(agentName).catch(() => ({ skills: [] })),
        ])
        setGlobalTools(gt.tools)
        setAgentTools(at.tools)
        setAgentSkills(sk.skills)
      } catch {
        // non-fatal — tools/skills can be loaded later
      } finally {
        setLoadingTools(false)
      }
      completeStep('basics', 'tools')
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setProvisionError(msg)
    } finally {
      setProvisioning(false)
    }
  }

  // ── Step 2: Tools & Skills handlers ──

  const handleAssociateTool = async (toolId: string) => {
    const result = await builderApi.associateGlobalTool(agentName, toolId)
    setAgentTools(result.tools)
  }

  const handleCreateAgentTool = async (tool: Partial<ToolRecord>) => {
    const result = await builderApi.addAgentTool(agentName, tool)
    setAgentTools(result.tools)
  }

  const handleRemoveAgentTool = async (toolId: string) => {
    const result = await builderApi.removeAgentTool(agentName, toolId)
    setAgentTools(result.tools)
  }

  const handleAddSkill = async (skillName: string, content: string) => {
    const result = await builderApi.upsertSkill(agentName, skillName, content)
    setAgentSkills(result.skills)
  }

  const handleDeleteSkill = async (skillName: string) => {
    const result = await builderApi.deleteSkill(agentName, skillName)
    setAgentSkills(result.skills)
  }

  const handleToolsContinue = () => {
    completeStep('tools', 'generate')
  }

  // ── Step 3: Generate ──

  const handleGenerate = async () => {
    setGenerating(true)
    setGenerateError('')
    try {
      const result = await builderApi.generateAgent(agentName, behavior)
      setGeneratedSpec(result.spec_yaml ?? '')
      setGeneratedRole(result.role_md ?? '')
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setGenerateError(msg)
    } finally {
      setGenerating(false)
    }
  }

  const handleGenerateContinue = () => {
    completeStep('generate', 'deploy')
  }

  // ── Step 4: Deploy ──

  const handleDeployDirect = async () => {
    setDeploying(true)
    setDeployError('')
    try {
      await builderApi.deployDirect(agentName, '', generatedSpec, generatedRole)
      setDeployed(true)
      setStepStatus(s => ({ ...s, deploy: 'complete' }))
      setTimeout(() => navigate(`/agents/${agentName}`), 2000)
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setDeployError(msg)
      setStepStatus(s => ({ ...s, deploy: 'error' }))
    } finally {
      setDeploying(false)
    }
  }

  const handleSubmitApproval = async () => {
    setDeploying(true)
    setDeployError('')
    try {
      await builderApi.submitDeployRequest(agentName, '', generatedSpec, generatedRole)
      setDeployed(true)
      setStepStatus(s => ({ ...s, deploy: 'complete' }))
      setTimeout(() => navigate(`/agents/${agentName}`), 2000)
    } catch (e: unknown) {
      const msg = (e as { detail?: string })?.detail ?? String(e)
      setDeployError(msg)
      setStepStatus(s => ({ ...s, deploy: 'error' }))
    } finally {
      setDeploying(false)
    }
  }

  // ── Render ──

  return (
    <Box sx={{ display: 'flex', height: '100%', bgcolor: 'background.default' }}>
      {/* Left: Step tree */}
      <StepTree
        steps={STEPS}
        currentStep={currentStep}
        stepStatus={stepStatus}
        onStepClick={goToStep}
      />

      {/* Right: Step content */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 4 }}>
        <Paper
          elevation={0}
          sx={{
            maxWidth: '100%',
            mx: 'auto',
            p: 4,
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          {currentStep === 'basics' && (
            <StepBasics
              agentName={agentName}
              setAgentName={setAgentName}
              description={description}
              setDescription={setDescription}
              provisioning={provisioning}
              provisionError={provisionError}
              onContinue={handleProvision}
              identity={identity}
            />
          )}
          {currentStep === 'tools' && (
            <StepTools
              agentName={agentName}
              agentTools={agentTools}
              globalTools={globalTools}
              agentSkills={agentSkills}
              loadingTools={loadingTools}
              toolsError={toolsError}
              onAssociateTool={handleAssociateTool}
              onCreateAgentTool={handleCreateAgentTool}
              onRemoveAgentTool={handleRemoveAgentTool}
              onAddSkill={handleAddSkill}
              onDeleteSkill={handleDeleteSkill}
              onContinue={handleToolsContinue}
            />
          )}
          {currentStep === 'generate' && (
            <StepGenerate
              agentName={agentName}
              agentTools={agentTools}
              agentSkills={agentSkills}
              behavior={behavior}
              setBehavior={setBehavior}
              generating={generating}
              generatedSpec={generatedSpec}
              generatedRole={generatedRole}
              generateError={generateError}
              previewTab={previewTab}
              setPreviewTab={setPreviewTab}
              onGenerate={handleGenerate}
              onContinue={handleGenerateContinue}
            />
          )}
          {currentStep === 'deploy' && (
            <StepDeploy
              agentName={agentName}
              generatedSpec={generatedSpec}
              generatedRole={generatedRole}
              deploying={deploying}
              deployError={deployError}
              deployed={deployed}
              onDeployDirect={handleDeployDirect}
              onSubmitApproval={handleSubmitApproval}
            />
          )}
        </Paper>
      </Box>
    </Box>
  )
}
