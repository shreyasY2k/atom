import { CheckCircle, XCircle } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import type { DeployStep } from '@/hooks/useBuilderDeploy'

interface Props {
  steps: DeployStep[]
  deploying: boolean
  error: string | null
}

export function DeployProgressFeed({ steps, deploying, error }: Props) {
  if (steps.length === 0 && !deploying) return null

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {steps.map((s, i) => {
        const isError = s.message.startsWith('✗')
        return (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: isError ? 'error.main' : 'text.primary' }}>
            {isError
              ? <XCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: 'inherit' }} />
              : <CheckCircle size={16} style={{ flexShrink: 0, marginTop: 2, color: '#22c55e' }} />
            }
            <Typography variant="body2" sx={{ color: 'inherit' }}>{s.message}</Typography>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#1976d2', fontSize: 12, marginLeft: 4 }}>
                view
              </a>
            )}
          </Box>
        )
      })}
      {deploying && !error && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
          <CircularProgress size={16} />
          <Typography variant="body2" color="text.secondary">Working…</Typography>
        </Box>
      )}
    </Box>
  )
}
