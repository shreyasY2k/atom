import { useState } from 'react'
import { CheckCircle, XCircle, Loader2, Wrench, ChevronDown, ChevronUp } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Collapse from '@mui/material/Collapse'
import type { DeployStep } from '@/hooks/useBuilderDeploy'

interface Props {
  steps: DeployStep[]
  deploying: boolean
  error: string | null
}

function LogsBlock({ logs }: { logs: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Box sx={{ mt: 0.5 }}>
      <Box
        component="button"
        onClick={() => setOpen(o => !o)}
        sx={{
          display: 'flex', alignItems: 'center', gap: 0.5,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'text.secondary', fontSize: 11, p: 0,
          '&:hover': { color: 'text.primary' },
        }}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {open ? 'Hide logs' : 'Show container logs'}
      </Box>
      <Collapse in={open}>
        <Box
          component="pre"
          sx={{
            mt: 0.5, p: 1, borderRadius: 1, bgcolor: '#1e1e1e', color: '#d4d4d4',
            fontSize: 11, fontFamily: 'monospace', overflow: 'auto',
            maxHeight: 180, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}
        >
          {logs}
        </Box>
      </Collapse>
    </Box>
  )
}

export function DeployProgressFeed({ steps, deploying, error }: Props) {
  if (steps.length === 0 && !deploying) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {steps.map((s, i) => (
        <Box key={i}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            {s.isError ? (
              <XCircle size={15} style={{ color: '#ef4444', flexShrink: 0, marginTop: 2 }} />
            ) : s.isHealing ? (
              <Wrench size={15} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
            ) : (
              <CheckCircle size={15} style={{ color: '#22c55e', flexShrink: 0, marginTop: 2 }} />
            )}
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ color: s.isError ? 'error.main' : 'text.primary' }}>
                {s.message}
              </Typography>
              {s.url && (
                <Typography variant="caption">
                  {' '}
                  <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#1976d2' }}>
                    view
                  </a>
                </Typography>
              )}
              {s.logs && <LogsBlock logs={s.logs} />}
            </Box>
          </Box>
        </Box>
      ))}
      {deploying && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
          <Typography variant="caption">Working…</Typography>
        </Box>
      )}
    </Box>
  )
}
