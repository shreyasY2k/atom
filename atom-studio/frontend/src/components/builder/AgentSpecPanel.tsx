import { Shield, ClipboardList, Lock } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import type { AgentSpec } from '@/hooks/useBuilderChat'

interface Props {
  spec: AgentSpec
  stage: string
  ciTarget: 'gitlab' | 'local'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, py: 0.75, borderBottom: '1px solid', borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}>
      <Typography variant="caption" color="text.secondary" sx={{ width: 64, flexShrink: 0 }}>{label}</Typography>
      <Box sx={{ flex: 1, textAlign: 'right', fontSize: 12 }}>
        {value ?? <Typography variant="caption" sx={{ opacity: 0.4 }}>—</Typography>}
      </Box>
    </Box>
  )
}

export function AgentSpecPanel({ spec, stage, ciTarget }: Props) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600, display: 'block', mb: 1 }}>
          Agent Spec
        </Typography>
        <Box sx={{ bgcolor: 'grey.50', borderRadius: 1, px: 1.5, py: 0.5 }}>
          <Row label="Name" value={<Typography variant="caption" sx={{ fontWeight: 500 }}>{spec.agentName}</Typography>} />
          <Row label="Model" value={<Typography variant="caption">{spec.model}</Typography>} />
          <Row label="Tools" value={
            spec.tools.length
              ? <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                  {spec.tools.map(t => <Chip key={t} label={t} size="small" variant="outlined" sx={{ fontSize: 10, height: 18 }} />)}
                </Box>
              : null
          } />
          <Row label="Skills" value={
            spec.skills.length
              ? <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, justifyContent: 'flex-end' }}>
                  {spec.skills.map(s => <Chip key={s} label={s} size="small" sx={{ fontSize: 10, height: 18 }} />)}
                </Box>
              : null
          } />
          <Row label="HITL" value={spec.hitlConfig ? (spec.hitlConfig.enabled ? 'enabled' : 'disabled') : null} />
          <Row label="A2A" value={spec.a2aTargets.length ? spec.a2aTargets.join(', ') : 'none'} />
          <Row label="Build" value={ciTarget === 'gitlab' ? 'GitLab (private)' : 'Local Docker'} />
        </Box>
      </Box>

      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Shield size={14} style={{ color: '#1976d2' }} />
          <Typography variant="caption" color="text.secondary">Guardrails always active</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ClipboardList size={14} style={{ color: '#1976d2' }} />
          <Typography variant="caption" color="text.secondary">Audit always on</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Lock size={14} style={{ color: '#1976d2' }} />
          <Typography variant="caption" color="text.secondary">Agent ID + JWT auto-provisioned</Typography>
        </Box>
      </Box>

      {stage !== 'greeting' && (
        <Typography variant="caption" color="text.secondary" align="center">
          Stage: <strong style={{ color: 'inherit' }}>{stage}</strong>
        </Typography>
      )}
    </Box>
  )
}
