import React from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Box, Chip, Grid, Paper, Stack, Typography } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AssignmentIcon from '@mui/icons-material/Assignment'
import HistoryIcon from '@mui/icons-material/History'
import { useAuth } from '../context/AuthContext'
import { builderApi, type DeploymentRecord } from '../api/builder'
import { getActorHeader } from '../context/AuthContext'

const cards = [
  {
    to: '/agents/build',
    icon: <AutoFixHighIcon sx={{ fontSize: 22, color: '#8ab4f8' }} />,
    title: 'Agent Builder',
    desc: 'Generate, compile, and deploy agents from prose or YAML. Each agent gets a non-human service-account identity at deploy time.',
    badge: 'Mode A · B · C',
    borderColor: 'rgba(138,180,248,0.3)',
    borderHover: 'rgba(138,180,248,0.7)',
  },
  {
    to: '/workflows/compose',
    icon: <AccountTreeIcon sx={{ fontSize: 22, color: '#60a5fa' }} />,
    title: 'Workflow Composer',
    desc: 'Load your existing processes as graphs. Replace routine human steps with agents. Watch the execution timeline update node by node.',
    badge: 'React Flow canvas',
    borderColor: 'rgba(96,165,250,0.3)',
    borderHover: 'rgba(96,165,250,0.7)',
  },
  {
    to: '/tasks',
    icon: <AssignmentIcon sx={{ fontSize: 22, color: '#4ade80' }} />,
    title: 'Human Tasks',
    desc: 'Open tasks waiting for a human decision. Accept, reject, or edit. Resolving a task resumes the paused Temporal workflow.',
    badge: 'Safety gate',
    borderColor: 'rgba(74,222,128,0.3)',
    borderHover: 'rgba(74,222,128,0.7)',
  },
  {
    to: '/audit',
    icon: <HistoryIcon sx={{ fontSize: 22, color: '#fbbf24' }} />,
    title: 'Audit Trail',
    desc: 'Every LLM call, tool call, node execution, and human decision — one timeline. Three actor types, one audit trail.',
    badge: 'MinIO · 90-day lock',
    borderColor: 'rgba(251,191,36,0.3)',
    borderHover: 'rgba(251,191,36,0.7)',
  },
]

const STATUS_COLOR: Record<string, 'warning' | 'success' | 'error' | 'default' | 'info'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
  bypassed: 'info',
  changes_requested: 'warning',
  deployed: 'success',
  failed: 'error',
}

function MyRequests() {
  const { data } = useQuery({
    queryKey: ['my-requests'],
    queryFn: () => builderApi.listDeployments({ requester: getActorHeader() }),
    refetchInterval: 10_000,
  })
  const navigate = useNavigate()
  const requests = (data?.deployments ?? []).slice(0, 5)

  if (requests.length === 0) return null

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="subtitle2" fontWeight={600} gutterBottom>My Deployment Requests</Typography>
      <Stack spacing={1}>
        {requests.map((r: DeploymentRecord) => (
          <Paper
            key={r.deployment_id}
            variant="outlined"
            sx={{ px: 2, py: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { borderColor: 'primary.main' } }}
            onClick={() => navigate('/approvals')}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary">
                {r.deployment_id.slice(0, 14)}
              </Typography>
              <Typography variant="caption" fontWeight={600}>
                {r.target_type} {r.target_name} v{r.target_version}
              </Typography>
              <Chip
                size="small"
                label={r.approval_status.replace('_', ' ')}
                color={STATUS_COLOR[r.approval_status] ?? 'default'}
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
              {r.deploy_status !== 'pending' && (
                <Chip
                  size="small"
                  label={r.deploy_status}
                  color={STATUS_COLOR[r.deploy_status] ?? 'default'}
                  variant="outlined"
                  sx={{ height: 18, fontSize: '0.65rem' }}
                />
              )}
            </Box>
          </Paper>
        ))}
      </Stack>
    </Box>
  )
}

export default function Home() {
  const navigate = useNavigate()
  const { role } = useAuth()

  return (
    <Box sx={{ p: { xs: 2, sm: 3, md: 4 }, width: '100%', maxWidth: { sm: '100%', md: '100%', lg: 1200 }, mx: 'auto' }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Atom Agent Platform
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mb: 2 }}>
          Build, deploy, and govern AI agents for your processes — keeping humans at critical decision points,
          with one audit trail across every step.
        </Typography>
        <Chip
          label="Gemini · Temporal · MinIO object lock"
          size="small"
          sx={{ fontFamily: 'monospace', fontSize: '0.7rem' }}
          variant="outlined"
          color="primary"
        />
      </Box>

      <Grid container spacing={2}>
        {cards.map((c) => (
          <Grid item xs={12} sm={6} key={c.to}>
            <Paper
              variant="outlined"
              onClick={() => navigate(c.to)}
              sx={{
                p: 2.5,
                cursor: 'pointer',
                borderColor: c.borderColor,
                borderRadius: 2,
                transition: 'border-color 0.2s, box-shadow 0.2s',
                '&:hover': { borderColor: c.borderHover, boxShadow: 2 },
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                {c.icon}
                <Typography variant="subtitle2" fontWeight={600}>{c.title}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, lineHeight: 1.6 }}>
                {c.desc}
              </Typography>
              <Typography variant="caption" fontFamily="monospace" color="text.secondary"
                sx={{ bgcolor: 'action.hover', px: 1, py: 0.25, borderRadius: 0.5 }}>
                {c.badge}
              </Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>

      {role === 'builder' && <MyRequests />}
    </Box>
  )
}
