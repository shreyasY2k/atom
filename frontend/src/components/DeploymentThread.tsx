import React from 'react'
import { Box, Chip, Typography } from '@mui/material'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import CancelIcon from '@mui/icons-material/Cancel'
import EditNoteIcon from '@mui/icons-material/EditNote'
import SendIcon from '@mui/icons-material/Send'
import SettingsIcon from '@mui/icons-material/Settings'
import ErrorIcon from '@mui/icons-material/Error'
import SkipNextIcon from '@mui/icons-material/SkipNext'
import type { DeploymentRecord } from '../api/builder'

interface Step {
  label: string
  actor: string
  timestamp?: string | null
  notes?: string | null
  icon: React.ReactNode
  color: string
}

function fmt(ts?: string | null) {
  return ts ? ts.slice(0, 19).replace('T', ' ') : ''
}

function buildSteps(r: DeploymentRecord): Step[] {
  const steps: Step[] = []

  steps.push({
    label: 'Requested',
    actor: r.requested_by,
    timestamp: r.requested_at,
    notes: r.notes || null,
    icon: <SendIcon sx={{ fontSize: 14 }} />,
    color: '#60a5fa',
  })

  if (r.approved_by) {
    if (r.approval_status === 'approved') {
      steps.push({
        label: 'Approved',
        actor: r.approved_by,
        timestamp: r.approved_at,
        notes: r.notes || null,
        icon: <CheckCircleIcon sx={{ fontSize: 14 }} />,
        color: '#4ade80',
      })
    } else if (r.approval_status === 'bypassed') {
      steps.push({
        label: 'Bypass deploy (admin)',
        actor: r.approved_by,
        timestamp: r.approved_at,
        notes: 'Platform Admin bypassed approval gate',
        icon: <SkipNextIcon sx={{ fontSize: 14 }} />,
        color: '#a78bfa',
      })
    } else if (r.approval_status === 'rejected') {
      steps.push({
        label: 'Rejected',
        actor: r.approved_by,
        timestamp: r.approved_at,
        notes: r.notes || null,
        icon: <CancelIcon sx={{ fontSize: 14 }} />,
        color: '#f87171',
      })
    } else if (r.approval_status === 'changes_requested') {
      steps.push({
        label: 'Changes requested',
        actor: r.approved_by,
        notes: r.notes || null,
        icon: <EditNoteIcon sx={{ fontSize: 14 }} />,
        color: '#fbbf24',
      })
    }
  }

  if (['deploying', 'deployed', 'failed'].includes(r.deploy_status) && r.approved_at) {
    steps.push({
      label: 'Deploy started',
      actor: 'system:builder-backend',
      timestamp: r.approved_at,
      notes: null,
      icon: <SettingsIcon sx={{ fontSize: 14 }} />,
      color: '#94a3b8',
    })
  }

  if (r.deploy_status === 'deployed' && r.deployed_at) {
    steps.push({
      label: 'Deploy completed',
      actor: 'system:builder-backend',
      timestamp: r.deployed_at,
      notes: r.service_account_id ? `NHI issued: ${r.service_account_id}` : null,
      icon: <CheckCircleIcon sx={{ fontSize: 14 }} />,
      color: '#4ade80',
    })
  } else if (r.deploy_status === 'failed') {
    steps.push({
      label: 'Deploy failed',
      actor: 'system:builder-backend',
      notes: r.deploy_error || 'unknown error',
      icon: <ErrorIcon sx={{ fontSize: 14 }} />,
      color: '#f87171',
    })
  }

  return steps
}

export default function DeploymentThread({ record }: { record: DeploymentRecord }) {
  const steps = buildSteps(record)

  return (
    <Box sx={{ pl: 0.5 }}>
      {steps.map((step, i) => (
        <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: i < steps.length - 1 ? 0 : 0 }}>
          {/* Left rail: dot + line */}
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 20, flexShrink: 0 }}>
            <Box sx={{
              width: 20, height: 20, borderRadius: '50%',
              bgcolor: step.color, color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, mt: 0.25,
            }}>
              {step.icon}
            </Box>
            {i < steps.length - 1 && (
              <Box sx={{ width: 2, flex: 1, minHeight: 20, bgcolor: 'divider', my: 0.5 }} />
            )}
          </Box>

          {/* Content */}
          <Box sx={{ pb: i < steps.length - 1 ? 2 : 0, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant="body2" fontWeight={600}>{step.label}</Typography>
              {step.timestamp && (
                <Typography variant="caption" color="text.secondary" fontFamily="monospace">
                  {fmt(step.timestamp)}
                </Typography>
              )}
            </Box>
            <Typography variant="caption" color="text.secondary" display="block">
              {step.actor}
            </Typography>
            {step.notes && (
              <Typography variant="caption" display="block" sx={{ mt: 0.25, fontStyle: 'italic', color: 'text.secondary' }}>
                "{step.notes}"
              </Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
