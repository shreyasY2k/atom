import React from 'react'
import { Box, Chip, Divider, Paper, Typography } from '@mui/material'
import LockIcon from '@mui/icons-material/Lock'

const USERS = [
  { role: 'builder',        identity: 'user:builder@atom.io',  displayName: 'Builder',       color: 'default' as const },
  { role: 'approver',       identity: 'user:approver@atom.io', displayName: 'Approver',      color: 'info' as const },
  { role: 'platform_admin', identity: 'user:admin@atom.io',    displayName: 'Platform Admin', color: 'secondary' as const },
]

const ROLES = [
  { name: 'Builder',       permissions: 'Build agents/workflows; submit deployment requests; view own + approved' },
  { name: 'Approver',      permissions: 'All Builder capabilities; approve/reject requests; deploy directly' },
  { name: 'Platform Admin', permissions: 'All; bypass approval; access settings and feature flags' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Typography variant="subtitle2" fontWeight={700} color="text.secondary" sx={{ mb: 1.5, letterSpacing: '0.06em' }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

export default function Settings() {
  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', maxWidth: { sm: '100%', md: '100%', lg: 1200 }, mx: 'auto' }}>
      <Typography variant="h6" fontWeight={600} gutterBottom>Settings</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Platform Admin view. Most settings are read-only in V1.
      </Typography>

      <Section title="USERS">
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {USERS.map((u, i) => (
            <React.Fragment key={u.role}>
              {i > 0 && <Divider />}
              <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip size="small" label={u.displayName} color={u.color} sx={{ fontWeight: 600, fontSize: '0.7rem', width: 110 }} />
                <Typography variant="caption" fontFamily="monospace" color="text.secondary">{u.identity}</Typography>
              </Box>
            </React.Fragment>
          ))}
        </Paper>
      </Section>

      <Section title="ROLES">
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {ROLES.map((r, i) => (
            <React.Fragment key={r.name}>
              {i > 0 && <Divider />}
              <Box sx={{ px: 2, py: 1.5 }}>
                <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                <Typography variant="caption" color="text.secondary">{r.permissions}</Typography>
              </Box>
            </React.Fragment>
          ))}
        </Paper>
      </Section>

      <Section title="AUDIT RETENTION">
        <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LockIcon fontSize="small" sx={{ color: 'warning.main' }} />
            <Typography variant="body2" fontWeight={600}>COMPLIANCE · 90 days</Typography>
          </Box>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Audit logs in MinIO <code>audit-logs/</code> bucket are object-locked in COMPLIANCE mode.
            Cannot be deleted or modified during the retention period, even by the bucket owner.
          </Typography>
        </Paper>
      </Section>

      <Section title="FEATURE FLAGS">
        <Paper variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
          {[
            { name: 'AI Composer (Mode C)', value: 'off', note: 'Natural-language workflow generation; configure and enable via settings' },
            { name: 'Web search for agents', value: 'off', note: 'Agents can call web-search tool (not in current specs)' },
            { name: 'Free-text input adapter', value: 'on',  note: 'Enables chat-style invocation on Builder Test panel' },
          ].map((f, i) => (
            <React.Fragment key={f.name}>
              {i > 0 && <Divider />}
              <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip size="small" label={f.value} color={f.value === 'on' ? 'success' : 'default'}
                  variant="outlined" sx={{ width: 48, fontSize: '0.65rem', fontFamily: 'monospace' }} />
                <Box>
                  <Typography variant="body2">{f.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{f.note}</Typography>
                </Box>
              </Box>
            </React.Fragment>
          ))}
        </Paper>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
          Feature flag mutation is Phase 2 (API-backed). These are display-only in V1.
        </Typography>
      </Section>

      <Section title="V1 SECURITY BOUNDARY">
        <Paper variant="outlined" sx={{ px: 2, py: 1.5, borderRadius: 2, borderColor: 'warning.main' }}>
          <Typography variant="caption" color="text.secondary">
            Role-button login sets a session cookie. Backends trust <code>X-Atom-Actor</code> header unconditionally.
            No gateway enforcement in V1. Production adds IDP integration + API gateway validation.
            See <code>docs/identity-and-audit.md § V1 Security Boundary</code> before rehearsal Q&amp;A.
          </Typography>
        </Paper>
      </Section>
    </Box>
  )
}
