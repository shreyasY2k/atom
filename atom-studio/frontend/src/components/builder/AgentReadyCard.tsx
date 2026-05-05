import { CheckCircle } from 'lucide-react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import ForumIcon from "@mui/icons-material/Forum"

interface Props {
  agentName: string | null
  chatUrl: string
}

export function AgentReadyCard({ agentName, chatUrl }: Props) {
  return (
    <Card variant="outlined" sx={{ borderColor: 'success.main', bgcolor: '#f0fdf4' }}>
      <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: '12px !important' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CheckCircle size={20} style={{ color: '#22c55e', flexShrink: 0 }} />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {agentName ?? 'Agent'} is live
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Deployed and ready to chat
            </Typography>
          </Box>
        </Box>
        <Button
          size="small"
          variant="contained"
          color="success"
          startIcon={<ForumIcon />}
          href={chatUrl}
        >
          Chat now
        </Button>
      </CardContent>
    </Card>
  )
}
