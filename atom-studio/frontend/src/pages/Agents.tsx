import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import AddIcon from '@mui/icons-material/Add'
import api from '@/lib/api'

interface Agent {
  id: string
  name: string
  domain_id: string
  domain_name: string
  status: 'draft' | 'pending_approval' | 'deployed' | 'suspended'
  allowed_models: string[]
  tool_count: number
  skill_count: number
  created_at: string
}

const STATUS_COLOR: Record<Agent['status'], 'default' | 'primary' | 'warning' | 'error'> = {
  draft: 'default',
  pending_approval: 'warning',
  deployed: 'primary',
  suspended: 'error',
}

export function Agents() {
  const navigate = useNavigate()

  const { data: agents = [], isLoading } = useQuery<Agent[]>({
    queryKey: ['agents'],
    queryFn: async () => (await api.get('/api/agents/')).data,
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Agents</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate({ to: '/agents/new' })}>
          New Agent
        </Button>
      </Box>

      {isLoading ? (
        <CircularProgress size={24} />
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Domain</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Models</TableCell>
              <TableCell>Tools</TableCell>
              <TableCell>Created</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  <Typography variant="body2" color="text.secondary">
                    No agents yet. Create one to get started.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              agents.map(a => (
                <TableRow
                  key={a.id}
                  hover
                  sx={{ cursor: 'pointer' }}
                  onClick={() =>
                    navigate({
                      to: '/domains/$domainId/agents/$agentId',
                      params: { domainId: a.domain_id, agentId: a.id },
                    })
                  }
                >
                  <TableCell><strong>{a.name}</strong></TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 13 }}>{a.domain_name}</TableCell>
                  <TableCell>
                    <Chip
                      label={a.status.replace('_', ' ')}
                      size="small"
                      color={STATUS_COLOR[a.status]}
                      sx={{ textTransform: 'capitalize' }}
                    />
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(a.allowed_models ?? []).slice(0, 2).map(m => (
                        <Chip key={m} label={m} size="small" variant="outlined" sx={{ fontSize: 11 }} />
                      ))}
                      {(a.allowed_models ?? []).length > 2 && (
                        <Chip
                          label={`+${a.allowed_models.length - 2}`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: 11 }}
                        />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ fontSize: 13 }}>{a.tool_count}</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: 12 }}>
                    {format(new Date(a.created_at), 'MMM d, yyyy')}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}
