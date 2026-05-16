import React, { useState, useEffect } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  Alert,
} from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import HttpIcon from '@mui/icons-material/Http'
import CodeIcon from '@mui/icons-material/Code'
import ExtensionIcon from '@mui/icons-material/Extension'
import type { ToolRecord, AuthConfig } from '../api/builder'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ToolFormDialogProps {
  open: boolean
  onClose: () => void
  onSave: (toolData: Partial<ToolRecord>) => Promise<void>
  initialData?: ToolRecord | null
  title?: string
}

type ToolType = 'http' | 'python' | 'mcp'
type AuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth2'

interface FormState {
  // Basic
  name: string
  display_name: string
  description: string
  tags: string[]
  tagInput: string

  // Type
  tool_type: ToolType

  // HTTP
  endpoint: string
  method: string

  // Python
  code: string

  // MCP
  mcp_server_url: string
  mcp_transport: 'sse' | 'stdio'
  mcp_tool_names: string[]
  mcpToolInput: string

  // Auth
  auth_type: AuthType
  // api_key
  auth_header_name: string
  auth_key: string
  auth_in: 'header' | 'query'
  auth_param_name: string
  // bearer
  auth_token: string
  // basic
  auth_username: string
  auth_password: string
  // oauth2
  auth_grant_type: 'client_credentials' | 'authorization_code'
  auth_token_url: string
  auth_client_id: string
  auth_client_secret: string
  auth_scope: string
  auth_audience: string
}

const EMPTY_FORM: FormState = {
  name: '',
  display_name: '',
  description: '',
  tags: [],
  tagInput: '',
  tool_type: 'http',
  endpoint: '',
  method: 'POST',
  code: '',
  mcp_server_url: '',
  mcp_transport: 'sse',
  mcp_tool_names: [],
  mcpToolInput: '',
  auth_type: 'none',
  auth_header_name: 'X-API-Key',
  auth_key: '',
  auth_in: 'header',
  auth_param_name: '',
  auth_token: '',
  auth_username: '',
  auth_password: '',
  auth_grant_type: 'client_credentials',
  auth_token_url: '',
  auth_client_id: '',
  auth_client_secret: '',
  auth_scope: '',
  auth_audience: '',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formToRecord(form: FormState, isEdit: boolean, scope: ToolRecord['scope']): Partial<ToolRecord> {
  const base: Partial<ToolRecord> = {
    name: form.name.trim(),
    display_name: form.display_name.trim() || undefined,
    description: form.description.trim() || undefined,
    tags: form.tags.length > 0 ? form.tags : undefined,
    tool_type: form.tool_type,
    scope,
  }

  if (form.tool_type === 'http') {
    base.endpoint = form.endpoint.trim() || null
    base.method = form.method
  }

  if (form.tool_type === 'python') {
    base.code = form.code.trim() || null
  }

  if (form.tool_type === 'mcp') {
    base.mcp_server_url = form.mcp_server_url.trim() || null
    base.mcp_transport = form.mcp_transport
    base.mcp_tool_names = form.mcp_tool_names.length > 0 ? form.mcp_tool_names : undefined
  }

  if (form.auth_type !== 'none') {
    const authConfig: AuthConfig = { type: form.auth_type }

    if (form.auth_type === 'api_key') {
      authConfig.header_name = form.auth_header_name.trim() || 'X-API-Key'
      authConfig.key = form.auth_key.trim()
      authConfig.in_ = form.auth_in
      if (form.auth_in === 'query') {
        authConfig.param_name = form.auth_param_name.trim()
      }
    }

    if (form.auth_type === 'bearer') {
      authConfig.token = form.auth_token.trim()
    }

    if (form.auth_type === 'basic') {
      authConfig.username = form.auth_username.trim()
      authConfig.password = form.auth_password.trim()
    }

    if (form.auth_type === 'oauth2') {
      authConfig.grant_type = form.auth_grant_type
      authConfig.token_url = form.auth_token_url.trim()
      authConfig.client_id = form.auth_client_id.trim()
      authConfig.client_secret = form.auth_client_secret.trim()
      if (form.auth_scope.trim()) authConfig.scope = form.auth_scope.trim()
      if (form.auth_audience.trim()) authConfig.audience = form.auth_audience.trim()
    }

    base.auth_type = form.auth_type
    base.auth_config = authConfig
  } else {
    base.auth_type = 'none'
    base.auth_config = undefined
  }

  return base
}

function recordToForm(tool: ToolRecord): FormState {
  const ac = tool.auth_config
  const authType: AuthType = (tool.auth_type as AuthType) ?? 'none'

  return {
    name: tool.name,
    display_name: tool.display_name ?? '',
    description: tool.description ?? '',
    tags: tool.tags ?? [],
    tagInput: '',
    tool_type: tool.tool_type ?? 'http',
    endpoint: tool.endpoint ?? '',
    method: tool.method ?? 'POST',
    code: tool.code ?? '',
    mcp_server_url: tool.mcp_server_url ?? '',
    mcp_transport: tool.mcp_transport ?? 'sse',
    mcp_tool_names: tool.mcp_tool_names ?? [],
    mcpToolInput: '',
    auth_type: authType,
    auth_header_name: ac?.header_name ?? 'X-API-Key',
    auth_key: ac?.key ?? '',
    auth_in: ac?.in_ ?? 'header',
    auth_param_name: ac?.param_name ?? '',
    auth_token: ac?.token ?? '',
    auth_username: ac?.username ?? '',
    auth_password: ac?.password ?? '',
    auth_grant_type: ac?.grant_type ?? 'client_credentials',
    auth_token_url: ac?.token_url ?? '',
    auth_client_id: ac?.client_id ?? '',
    auth_client_secret: ac?.client_secret ?? '',
    auth_scope: ac?.scope ?? '',
    auth_audience: ac?.audience ?? '',
  }
}

function nameIsValid(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/.test(name) && name.length >= 2 && name.length <= 40
}

// ── Password Field ─────────────────────────────────────────────────────────────

interface PasswordFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  placeholder?: string
}

function PasswordField({ label, value, onChange, required, placeholder }: PasswordFieldProps) {
  const [show, setShow] = useState(false)
  return (
    <TextField
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      onChange={e => onChange(e.target.value)}
      fullWidth
      required={required}
      placeholder={placeholder}
      inputProps={{ spellCheck: false }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <IconButton size="small" onClick={() => setShow(s => !s)} edge="end" tabIndex={-1}>
              {show ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
            </IconButton>
          </InputAdornment>
        ),
      }}
    />
  )
}

// ── Section Header ─────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{
        display: 'block',
        color: 'text.secondary',
        letterSpacing: 1.5,
        fontSize: '0.65rem',
        fontWeight: 700,
        mt: 1,
        mb: 0.5,
      }}
    >
      {children}
    </Typography>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function ToolFormDialog({
  open,
  onClose,
  onSave,
  initialData,
  title,
}: ToolFormDialogProps) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const isEdit = !!initialData
  const scope: ToolRecord['scope'] = initialData?.scope ?? 'global'

  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm(recordToForm(initialData))
      } else {
        setForm(EMPTY_FORM)
      }
      setSaveError('')
    }
  }, [open, initialData])

  const set = <K extends keyof FormState>(field: K) =>
    (value: FormState[K]) => setForm(f => ({ ...f, [field]: value }))

  const setStr = <K extends keyof FormState>(field: K) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value as FormState[K] }))

  // ── Tag management ──

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const tag = form.tagInput.trim().replace(/,$/, '')
      if (tag && !form.tags.includes(tag)) {
        setForm(f => ({ ...f, tags: [...f.tags, tag], tagInput: '' }))
      } else {
        setForm(f => ({ ...f, tagInput: '' }))
      }
    }
  }

  const removeTag = (tag: string) => {
    setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }))
  }

  // ── MCP tool name management ──

  const handleMcpToolInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      const tool = form.mcpToolInput.trim().replace(/,$/, '')
      if (tool && !form.mcp_tool_names.includes(tool)) {
        setForm(f => ({ ...f, mcp_tool_names: [...f.mcp_tool_names, tool], mcpToolInput: '' }))
      } else {
        setForm(f => ({ ...f, mcpToolInput: '' }))
      }
    }
  }

  const removeMcpTool = (tool: string) => {
    setForm(f => ({ ...f, mcp_tool_names: f.mcp_tool_names.filter(t => t !== tool) }))
  }

  // ── Validation ──

  const nameError = form.name && !nameIsValid(form.name)
    ? 'Lowercase letters, numbers, hyphens only. 2–40 chars.'
    : ''

  const canSave = (() => {
    if (!nameIsValid(form.name)) return false
    if (!form.description.trim()) return false
    if (form.tool_type === 'http' && !form.endpoint.trim()) return false
    if (form.tool_type === 'python' && !form.code.trim()) return false
    if (form.tool_type === 'mcp' && !form.mcp_server_url.trim()) return false
    return !saving
  })()

  // ── Save ──

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      const payload = formToRecord(form, isEdit, scope)
      await onSave(payload)
    } catch (e: unknown) {
      setSaveError((e as { detail?: string })?.detail ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  const dialogTitle = title ?? (isEdit ? 'Edit Tool' : 'Create Tool')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{dialogTitle}</DialogTitle>

      <DialogContent dividers sx={{ pt: 2, pb: 3 }}>
        <Stack spacing={3}>

          {/* ── Section 1: Basic Info ── */}
          <Box>
            <SectionHeader>Basic Info</SectionHeader>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              <TextField
                label="Tool Name *"
                value={form.name}
                onChange={setStr('name')}
                fullWidth
                disabled={isEdit}
                error={!!nameError}
                helperText={
                  nameError ||
                  (isEdit
                    ? 'Name cannot be changed after creation.'
                    : 'Lowercase, hyphens, numbers. 2–40 chars.')
                }
                inputProps={{ spellCheck: false }}
              />

              <TextField
                label="Display Name"
                value={form.display_name}
                onChange={setStr('display_name')}
                fullWidth
                placeholder="Human-friendly label (optional)"
              />

              <TextField
                label="Description *"
                value={form.description}
                onChange={setStr('description')}
                fullWidth
                multiline
                minRows={3}
                placeholder="Describe what this tool does and when it should be used."
              />

              {/* Tags chip input */}
              <Box>
                <TextField
                  label="Tags"
                  value={form.tagInput}
                  onChange={setStr('tagInput')}
                  onKeyDown={handleTagInputKeyDown}
                  fullWidth
                  placeholder="Type a tag and press Enter or comma"
                  helperText="Press Enter or comma to add each tag."
                  size="small"
                />
                {form.tags.length > 0 && (
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                    {form.tags.map(tag => (
                      <Chip
                        key={tag}
                        label={tag}
                        size="small"
                        onDelete={() => removeTag(tag)}
                        sx={{ fontSize: '0.7rem', height: 22 }}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Stack>
          </Box>

          {/* ── Section 2: Type & Configuration ── */}
          <Box>
            <SectionHeader>Type &amp; Configuration</SectionHeader>
            <Box sx={{ mt: 1.5 }}>
              <ToggleButtonGroup
                value={form.tool_type}
                exclusive
                onChange={(_, v: ToolType | null) => { if (v) set('tool_type')(v) }}
                size="small"
                sx={{ mb: 2.5 }}
              >
                <ToggleButton value="http" sx={{ px: 2, gap: 0.75, textTransform: 'none' }}>
                  <HttpIcon fontSize="small" />
                  HTTP
                </ToggleButton>
                <ToggleButton value="python" sx={{ px: 2, gap: 0.75, textTransform: 'none' }}>
                  <CodeIcon fontSize="small" />
                  Python
                </ToggleButton>
                <ToggleButton value="mcp" sx={{ px: 2, gap: 0.75, textTransform: 'none' }}>
                  <ExtensionIcon fontSize="small" />
                  MCP
                </ToggleButton>
              </ToggleButtonGroup>

              {form.tool_type === 'http' && (
                <Stack spacing={2}>
                  <TextField
                    label="Endpoint URL *"
                    value={form.endpoint}
                    onChange={setStr('endpoint')}
                    fullWidth
                    placeholder="https://api.example.com/endpoint"
                    inputProps={{ spellCheck: false }}
                  />
                  <FormControl fullWidth>
                    <InputLabel>Method</InputLabel>
                    <Select
                      value={form.method}
                      label="Method"
                      onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
                    >
                      {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => (
                        <MenuItem key={m} value={m}>{m}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Stack>
              )}

              {form.tool_type === 'python' && (
                <Stack spacing={1}>
                  <TextField
                    label="Python Code *"
                    value={form.code}
                    onChange={setStr('code')}
                    fullWidth
                    multiline
                    minRows={10}
                    placeholder={'def run(input: dict) -> dict:\n    # your code here\n    return {}'}
                    inputProps={{
                      style: { fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.6 },
                      spellCheck: false,
                    }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    Define a <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>run(input: dict) -&gt; dict</Box> function.
                    Available: <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>json</Box>,{' '}
                    <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>re</Box>,{' '}
                    <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>math</Box>,{' '}
                    <Box component="code" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>datetime</Box>.
                  </Typography>
                </Stack>
              )}

              {form.tool_type === 'mcp' && (
                <Stack spacing={2}>
                  <TextField
                    label="MCP Server URL *"
                    value={form.mcp_server_url}
                    onChange={setStr('mcp_server_url')}
                    fullWidth
                    placeholder="http://mcp-server:8000"
                    inputProps={{ spellCheck: false }}
                  />
                  <FormControl fullWidth>
                    <InputLabel>Transport</InputLabel>
                    <Select
                      value={form.mcp_transport}
                      label="Transport"
                      onChange={e => setForm(f => ({ ...f, mcp_transport: e.target.value as 'sse' | 'stdio' }))}
                    >
                      <MenuItem value="sse">SSE</MenuItem>
                      <MenuItem value="stdio">stdio</MenuItem>
                    </Select>
                  </FormControl>

                  {/* MCP tool names chip input */}
                  <Box>
                    <TextField
                      label="Tool Names"
                      value={form.mcpToolInput}
                      onChange={setStr('mcpToolInput')}
                      onKeyDown={handleMcpToolInputKeyDown}
                      fullWidth
                      placeholder="Type a tool name and press Enter or comma"
                      helperText="Restrict to specific tool names from this MCP server (optional)."
                      size="small"
                    />
                    {form.mcp_tool_names.length > 0 && (
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                        {form.mcp_tool_names.map(tool => (
                          <Chip
                            key={tool}
                            label={tool}
                            size="small"
                            onDelete={() => removeMcpTool(tool)}
                            sx={{ fontSize: '0.7rem', height: 22, fontFamily: 'monospace' }}
                          />
                        ))}
                      </Box>
                    )}
                  </Box>
                </Stack>
              )}
            </Box>
          </Box>

          {/* ── Section 3: Authorization ── */}
          <Box>
            <SectionHeader>Authorization</SectionHeader>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <FormControl fullWidth>
                <InputLabel>Auth Type</InputLabel>
                <Select
                  value={form.auth_type}
                  label="Auth Type"
                  onChange={e => setForm(f => ({ ...f, auth_type: e.target.value as AuthType }))}
                >
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="api_key">API Key</MenuItem>
                  <MenuItem value="bearer">Bearer Token</MenuItem>
                  <MenuItem value="basic">Basic Auth</MenuItem>
                  <MenuItem value="oauth2">OAuth 2.0</MenuItem>
                </Select>
              </FormControl>

              {form.auth_type === 'api_key' && (
                <>
                  <TextField
                    label="Header Name"
                    value={form.auth_header_name}
                    onChange={setStr('auth_header_name')}
                    fullWidth
                    placeholder="X-API-Key"
                    inputProps={{ spellCheck: false }}
                  />
                  <PasswordField
                    label="Key Value *"
                    value={form.auth_key}
                    onChange={v => setForm(f => ({ ...f, auth_key: v }))}
                    required
                  />
                  <Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                      Location
                    </Typography>
                    <RadioGroup
                      row
                      value={form.auth_in}
                      onChange={e => setForm(f => ({ ...f, auth_in: e.target.value as 'header' | 'query' }))}
                    >
                      <FormControlLabel value="header" control={<Radio size="small" />} label="Header" />
                      <FormControlLabel value="query" control={<Radio size="small" />} label="Query Parameter" />
                    </RadioGroup>
                  </Box>
                  {form.auth_in === 'query' && (
                    <TextField
                      label="Param Name"
                      value={form.auth_param_name}
                      onChange={setStr('auth_param_name')}
                      fullWidth
                      placeholder="api_key"
                      inputProps={{ spellCheck: false }}
                    />
                  )}
                </>
              )}

              {form.auth_type === 'bearer' && (
                <PasswordField
                  label="Token *"
                  value={form.auth_token}
                  onChange={v => setForm(f => ({ ...f, auth_token: v }))}
                  required
                />
              )}

              {form.auth_type === 'basic' && (
                <>
                  <TextField
                    label="Username *"
                    value={form.auth_username}
                    onChange={setStr('auth_username')}
                    fullWidth
                    inputProps={{ spellCheck: false }}
                  />
                  <PasswordField
                    label="Password *"
                    value={form.auth_password}
                    onChange={v => setForm(f => ({ ...f, auth_password: v }))}
                    required
                  />
                </>
              )}

              {form.auth_type === 'oauth2' && (
                <>
                  <TextField
                    label="Token URL *"
                    value={form.auth_token_url}
                    onChange={setStr('auth_token_url')}
                    fullWidth
                    placeholder="https://auth.example.com/oauth/token"
                    inputProps={{ spellCheck: false }}
                  />
                  <TextField
                    label="Client ID *"
                    value={form.auth_client_id}
                    onChange={setStr('auth_client_id')}
                    fullWidth
                    inputProps={{ spellCheck: false }}
                  />
                  <PasswordField
                    label="Client Secret *"
                    value={form.auth_client_secret}
                    onChange={v => setForm(f => ({ ...f, auth_client_secret: v }))}
                    required
                  />
                  <TextField
                    label="Scope"
                    value={form.auth_scope}
                    onChange={setStr('auth_scope')}
                    fullWidth
                    placeholder="openid profile email"
                    inputProps={{ spellCheck: false }}
                  />
                  <TextField
                    label="Audience"
                    value={form.auth_audience}
                    onChange={setStr('auth_audience')}
                    fullWidth
                    placeholder="https://api.example.com"
                    inputProps={{ spellCheck: false }}
                  />
                  <FormControl fullWidth>
                    <InputLabel>Grant Type</InputLabel>
                    <Select
                      value={form.auth_grant_type}
                      label="Grant Type"
                      onChange={e =>
                        setForm(f => ({
                          ...f,
                          auth_grant_type: e.target.value as 'client_credentials' | 'authorization_code',
                        }))
                      }
                    >
                      <MenuItem value="client_credentials">client_credentials</MenuItem>
                      <MenuItem value="authorization_code">authorization_code</MenuItem>
                    </Select>
                  </FormControl>
                </>
              )}
            </Stack>
          </Box>

          {saveError && (
            <Alert severity="error" sx={{ fontSize: '0.75rem' }}>
              {saveError}
            </Alert>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={!canSave}
          startIcon={saving ? <CircularProgress size={14} color="inherit" /> : undefined}
        >
          {isEdit ? 'Save Changes' : 'Create Tool'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
