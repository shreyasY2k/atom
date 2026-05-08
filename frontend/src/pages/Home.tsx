import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Grid, Paper, Typography, Chip } from '@mui/material'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import AccountTreeIcon from '@mui/icons-material/AccountTree'
import AssignmentIcon from '@mui/icons-material/Assignment'
import HistoryIcon from '@mui/icons-material/History'

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
    desc: 'Load the ATS 9-step workflow. Replace routine human steps with agents live. Watch the execution timeline update node by node.',
    badge: 'React Flow canvas',
    borderColor: 'rgba(96,165,250,0.3)',
    borderHover: 'rgba(96,165,250,0.7)',
  },
  {
    to: '/tasks',
    icon: <AssignmentIcon sx={{ fontSize: 22, color: '#4ade80' }} />,
    title: 'Human Tasks',
    desc: 'Open tasks waiting for a human decision. Accept, reject, or edit. Resolving a task resumes the paused Temporal workflow.',
    badge: 'BFSI invariant',
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

export default function Home() {
  const navigate = useNavigate()

  return (
    <Box sx={{ p: 4, maxWidth: 800 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h5" fontWeight={600} gutterBottom>
          Atom Agent Platform
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 560, mb: 2 }}>
          We don't sell agents. We help you remove routine human work from your existing processes —
          keeping humans on the calls that matter, with one audit trail across every step.
        </Typography>
        <Chip
          label="Gemini-only · Temporal · MinIO object lock"
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
    </Box>
  )
}
