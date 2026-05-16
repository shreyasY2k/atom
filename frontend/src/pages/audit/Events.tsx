import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Box, Chip, Collapse, Divider, IconButton, InputBase,
  Paper, Tooltip, Typography,
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import VerifiedIcon from '@mui/icons-material/Verified'
import HelpOutlineIcon from '@mui/icons-material/HelpOutline'
import { workflowApi } from '../../api/workflow'
import type { AuditEvent } from '../../types'

const ACTOR_COLORS: Record<string, { bgcolor: string; color: string }> = {
  agent:  { bgcolor: '#4a148c', color: '#ce93d8' },
  human:  { bgcolor: '#0d47a1', color: '#90caf9' },
  system: { bgcolor: '#212121', color: '#9e9e9e' },
}

// ---------------------------------------------------------------------------
// HMAC badge
// ---------------------------------------------------------------------------

function HmacBadge({ hmac }: { hmac?: string | null }) {
  if (!hmac) {
    return (
      <Tooltip title="No HMAC — event predates signing or came from an unsigned source">
        <HelpOutlineIcon sx={{ fontSize: 14, color: 'text.disabled', flexShrink: 0 }} />
      </Tooltip>
    )
  }
  const short = hmac.replace('hmac-sha256:', '').slice(0, 12)
  return (
    <Tooltip
      title={
        <Box>
          <Typography variant="caption" display="block" fontWeight={700} color="success.light">
            ✓ HMAC-SHA256 signed
          </Typography>
          <Typography variant="caption" fontFamily="monospace" display="block" sx={{ wordBreak: 'break-all', mt: 0.5 }}>
            {hmac}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
            Offline verify: python scripts/verify_audit_hmac.py
          </Typography>
        </Box>
      }
      placement="left"
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'default' }}>
        <VerifiedIcon sx={{ fontSize: 14, color: 'success.main', flexShrink: 0 }} />
        <Typography variant="caption" fontFamily="monospace" color="success.main" sx={{ fontSize: '0.6rem' }}>
          {short}…
        </Typography>
      </Box>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Event row
// ---------------------------------------------------------------------------

function EventRow({ event }: { event: AuditEvent }) {
  const [expanded, setExpanded] = useState(false)
  const ts = event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : '—'
  const ac = ACTOR_COLORS[event.actor_type] || ACTOR_COLORS.system
  const hmac = event.hmac ?? ((event.raw as Record<string, unknown>)?._hmac as string | null | undefined)

  return (
    <Box>
      <Box
        component="button"
        onClick={() => setExpanded(!expanded)}
        sx={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          cursor: 'pointer', px: 2, py: 1.25,
          display: 'flex', alignItems: 'flex-start', gap: 1.5,
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        <Typography variant="caption" fontFamily="monospace" color="text.secondary" sx={{ width: 80, flexShrink: 0, mt: 0.25 }}>
          {ts}
        </Typography>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Chip
              label={event.actor_type.toUpperCase()}
              size="small"
              sx={{ height: 18, fontSize: '0.6rem', fontFamily: 'monospace', fontWeight: 700, bgcolor: ac.bgcolor, color: ac.color }}
            />
            <Typography variant="caption" fontFamily="monospace" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {event.actor_id}
            </Typography>
            {event.model && <Typography variant="caption" color="text.secondary" fontFamily="monospace">{event.model}</Typography>}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 0.25 }}>
            <Typography variant="caption" color="text.secondary">{event.event_type}</Typography>
            {event.run_id && <Typography variant="caption" fontFamily="monospace" color="text.secondary">run:{event.run_id.slice(0, 12)}</Typography>}
            {event.node_id && <Typography variant="caption" fontFamily="monospace" color="text.secondary">node:{event.node_id}</Typography>}
            {event.input_tokens != null && <Typography variant="caption" color="text.secondary">{event.input_tokens}in · {event.output_tokens}out</Typography>}
            {event.duration_ms != null && <Typography variant="caption" color="text.secondary">{event.duration_ms}ms</Typography>}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexShrink: 0, mt: 0.25 }}>
          <HmacBadge hmac={hmac} />
          <Box sx={{ color: 'text.secondary' }}>
            {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
          </Box>
        </Box>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ pl: '104px', pr: 2, pb: 1.5 }}>
          {hmac && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, px: 1.5, py: 0.75, bgcolor: 'success.dark', borderRadius: 1 }}>
              <VerifiedIcon sx={{ fontSize: 13, color: 'white' }} />
              <Typography variant="caption" fontFamily="monospace" color="white" sx={{ wordBreak: 'break-all', fontSize: '0.62rem' }}>
                {hmac}
              </Typography>
            </Box>
          )}
          <Box component="pre" sx={{ fontSize: '0.65rem', fontFamily: 'monospace', color: 'text.secondary', bgcolor: 'background.default', border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, overflow: 'auto', maxHeight: 300, m: 0 }}>
            {JSON.stringify(event.raw, null, 2)}
          </Box>
        </Box>
      </Collapse>
      <Divider />
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AuditEvents() {
  const [actorFilter, setActorFilter] = useState('')
  const [runFilter, setRunFilter] = useState('')

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['audit', actorFilter, runFilter],
    queryFn: () => workflowApi.listAuditEvents({ actor_type: actorFilter || undefined, run_id: runFilter || undefined, limit: 150 }),
    staleTime: 5000,
  })

  const events: AuditEvent[] = data?.events ?? []
  const signedCount = events.filter(e => {
    const hmac = e.hmac ?? (e.raw as Record<string, unknown>)?._hmac
    return !!hmac
  }).length

  return (
    <Box sx={{ p: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight={600}>Audit Events</Typography>
          <Typography variant="caption" color="text.secondary">
            All LLM calls, tool calls, agent invocations, and workflow-node events — one timeline.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {events.length > 0 && (
            <Tooltip title={`${signedCount} of ${events.length} events carry a valid HMAC-SHA256 signature. Run scripts/verify_audit_hmac.py to verify offline.`}>
              <Box sx={{
                display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, borderRadius: 1, cursor: 'default',
                bgcolor: signedCount === events.length ? 'success.main' : signedCount > 0 ? 'warning.main' : 'error.main',
              }}>
                <VerifiedIcon sx={{ fontSize: 14, color: 'white' }} />
                <Typography variant="caption" color="white" fontWeight={700}>
                  {signedCount}/{events.length} signed
                </Typography>
              </Box>
            </Tooltip>
          )}
          <Tooltip title="Refresh">
            <IconButton size="small" onClick={() => refetch()}><RefreshIcon fontSize="small" /></IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          {['', 'agent', 'human', 'system'].map((t) => {
            const ac = t ? ACTOR_COLORS[t] : null
            return (
              <Chip key={t} label={t || 'All actors'} size="small"
                variant={actorFilter === t ? 'filled' : 'outlined'}
                onClick={() => setActorFilter(t)}
                sx={{ cursor: 'pointer', fontSize: '0.7rem', fontFamily: 'monospace',
                  ...(actorFilter === t && ac ? { bgcolor: ac.bgcolor, color: ac.color, borderColor: 'transparent' } : {}),
                }}
              />
            )
          })}
        </Box>
        <Paper variant="outlined" sx={{ display: 'flex', alignItems: 'center', px: 1.5, py: 0.25, borderRadius: 1.5, height: 28 }}>
          <InputBase placeholder="Filter by run ID…" value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
            sx={{ fontSize: '0.75rem', fontFamily: 'monospace', width: 180 }}
          />
        </Paper>
        {(actorFilter || runFilter) && (
          <Chip label="Clear" size="small" variant="outlined"
            onClick={() => { setActorFilter(''); setRunFilter('') }}
            sx={{ cursor: 'pointer' }}
          />
        )}
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {data?.total ?? 0} events total
        </Typography>
      </Box>

      {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}

      <Paper elevation={0} variant="outlined" sx={{ borderRadius: 2, overflow: 'hidden' }}>
        {events.length === 0 && !isLoading && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No events yet. Create an agent, invoke it, or run a workflow to generate audit entries.
            </Typography>
          </Box>
        )}
        {events.map((e) => <EventRow key={e.id} event={e} />)}
      </Paper>
    </Box>
  )
}
