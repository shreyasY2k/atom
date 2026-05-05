import { useNavigate } from '@tanstack/react-router'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import TuneIcon from '@mui/icons-material/Tune'

export function AgentNewChoice() {
  const navigate = useNavigate()

  return (
    <Box sx={{ maxWidth: 640, mx: 'auto', mt: 4 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }} gutterBottom>
        Create a new agent
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        Choose how you want to set up your agent.
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
        {/* AI Builder */}
        <Card variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main' } }}>
          <CardActionArea onClick={() => navigate({ to: '/agents/build' })} sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <AutoAwesomeIcon sx={{ fontSize: 48, color: 'primary.main' }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }} align="center" gutterBottom>
                AI Builder
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Describe what you want, ATOM builds it
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>

        {/* Manual Setup */}
        <Card variant="outlined" sx={{ '&:hover': { borderColor: 'primary.main' } }}>
          <CardActionArea onClick={() => navigate({ to: '/agents/wizard' })} sx={{ height: '100%', p: 1 }}>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
                <TuneIcon sx={{ fontSize: 48, color: 'primary.main' }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }} align="center" gutterBottom>
                Manual Setup
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Full control: model, tools, skills, HITL
              </Typography>
            </CardContent>
          </CardActionArea>
        </Card>
      </Box>
    </Box>
  )
}
