import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import CircularProgress from '@mui/material/CircularProgress'
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch'
import api from '@/lib/api'
import { ConversationPanel } from '@/components/builder/ConversationPanel'
import { AgentSpecPanel } from '@/components/builder/AgentSpecPanel'
import { DeployProgressFeed } from '@/components/builder/DeployProgressFeed'
import { AgentReadyCard } from '@/components/builder/AgentReadyCard'
import { useBuilderChat } from '@/hooks/useBuilderChat'
import { useBuilderDeploy } from '@/hooks/useBuilderDeploy'

interface Domain { id: string; name: string }

export function AgentBuilderChat() {
  const [ciTarget, setCiTarget] = useState<'gitlab' | 'local'>('local')
  const [selectedDomainId, setSelectedDomainId] = useState<string>('')

  const { data: domains = [] } = useQuery<Domain[]>({
    queryKey: ['domains'],
    queryFn: async () => (await api.get('/api/domains/')).data,
  })

  useEffect(() => {
    if (domains.length && !selectedDomainId) setSelectedDomainId(domains[0].id)
  }, [domains, selectedDomainId])

  const { messages, spec, stage, sessionId, loading, sendMessage } =
    useBuilderChat(selectedDomainId, ciTarget)

  const { steps, deploying, chatUrl, agentPy, error, deploy } = useBuilderDeploy()

  const canDeploy = ['confirming', 'confirmed'].includes(stage) && !!sessionId && !deploying && !chatUrl

  const handleDeploy = () => {
    if (sessionId) deploy(sessionId)
  }

  const deployPanelVisible = steps.length > 0 || deploying || !!chatUrl || !!agentPy

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Agent Builder</Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {domains.length > 1 && (
            <Select
              size="small"
              value={selectedDomainId}
              onChange={e => setSelectedDomainId(e.target.value)}
              sx={{ fontSize: 13 }}
            >
              {domains.map(d => (
                <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
              ))}
            </Select>
          )}

          <ToggleButtonGroup
            size="small"
            value={ciTarget}
            exclusive
            onChange={(_, v) => v && setCiTarget(v)}
          >
            <ToggleButton value="local" sx={{ fontSize: 12, px: 1.5, py: 0.5 }}>Local</ToggleButton>
            <ToggleButton value="gitlab" sx={{ fontSize: 12, px: 1.5, py: 0.5 }}>GitLab CI</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* Split panel */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 300px', gap: 2 }}>

        {/* Left — conversation + deploy progress */}
        <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              💬 Builder
            </Typography>
          </Box>

          {/* Chat */}
          <Box sx={{ flex: 1, minHeight: 0 }}>
            <ConversationPanel messages={messages} loading={loading} onSend={sendMessage} />
          </Box>

          {/* Deploy progress feed */}
          {deployPanelVisible && (
            <Box sx={{ borderTop: 1, borderColor: 'divider', px: 2, py: 1.5, bgcolor: 'grey.50' }}>
              <DeployProgressFeed steps={steps} deploying={deploying} error={error} />
              {chatUrl && (
                <Box sx={{ mt: 1.5 }}>
                  <AgentReadyCard agentName={spec.agentName} chatUrl={chatUrl} />
                </Box>
              )}
              {agentPy && !chatUrl && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    Generated <code>agent.py</code> — run <code>atom deploy</code> from your project directory to build and deploy.
                  </Typography>
                  <Box
                    component="pre"
                    sx={{
                      mt: 0.5, p: 1, bgcolor: '#1e1e1e', color: '#d4d4d4',
                      borderRadius: 1, fontSize: 11, fontFamily: 'monospace',
                      overflow: 'auto', maxHeight: 160, whiteSpace: 'pre-wrap',
                    }}
                  >
                    {agentPy}
                  </Box>
                </Box>
              )}
            </Box>
          )}

          {/* Deploy CTA */}
          {canDeploy && (
            <Box sx={{
              borderTop: 1, borderColor: 'divider', px: 2, py: 1.5,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              bgcolor: 'grey.50',
            }}>
              <Typography variant="caption" color="text.secondary">
                Spec looks good — ready to build and deploy?
              </Typography>
              <Button
                size="small"
                variant="contained"
                onClick={handleDeploy}
                disabled={deploying}
                startIcon={deploying ? <CircularProgress size={14} color="inherit" /> : <RocketLaunchIcon />}
              >
                {deploying ? 'Deploying…' : 'Build & Deploy'}
              </Button>
            </Box>
          )}
        </Paper>

        {/* Right — spec panel */}
        <Paper variant="outlined" sx={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: 'grey.50' }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              📋 Agent Spec
            </Typography>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
            <AgentSpecPanel spec={spec} stage={stage} ciTarget={ciTarget} />
            {chatUrl && (
              <Box sx={{ mt: 2 }}>
                <AgentReadyCard agentName={spec.agentName} chatUrl={chatUrl} />
              </Box>
            )}
          </Box>
        </Paper>
      </Box>
    </Box>
  )
}
