import { useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'
import api from '@/lib/api'

interface Skill {
  id: string
  name: string
  description: string | null
  dir: string | null
  builtin: boolean
  is_active: boolean
}

interface SkillCardProps {
  skill: Skill
  selected?: boolean
  onToggle?: (name: string) => void
}

function SkillDrawer({ skillName, onClose }: { skillName: string; onClose: () => void }) {
  const { data: content, isLoading } = useQuery({
    queryKey: ['skill-content', skillName],
    queryFn: async () => (await api.get(`/api/skills/${skillName}/content`)).data,
  })

  return (
    <Box sx={{ position: 'fixed', inset: '0 0 0 auto', width: 520, bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', boxShadow: 8, zIndex: 1400, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{skillName}</Typography>
        <IconButton size="small" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {isLoading ? (
          <Typography variant="body2" color="text.secondary">Loading…</Typography>
        ) : (
          <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>{content}</pre>
        )}
      </Box>
    </Box>
  )
}

export function SkillCard({ skill, selected, onToggle }: SkillCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <Card
        variant="outlined"
        sx={{
          cursor: onToggle ? 'pointer' : 'default',
          transition: 'border-color 0.2s',
          borderColor: selected ? 'primary.main' : undefined,
          bgcolor: selected ? 'primary.50' : undefined,
        }}
        onClick={() => onToggle?.(skill.name)}
      >
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{skill.name}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              {skill.builtin && <Chip label="built-in" size="small" sx={{ fontSize: 10, height: 18 }} />}
              {selected !== undefined && (
                <Chip
                  label={selected ? 'selected' : 'add'}
                  size="small"
                  color={selected ? 'primary' : 'default'}
                  variant={selected ? 'filled' : 'outlined'}
                  sx={{ fontSize: 10, height: 18 }}
                />
              )}
            </Box>
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {skill.description ?? 'No description'}
          </Typography>
          <Button
            size="small"
            variant="text"
            startIcon={<BookOpen size={12} />}
            sx={{ mt: 0.5, px: 0.5, fontSize: 11 }}
            onClick={e => { e.stopPropagation(); setDrawerOpen(true) }}
          >
            View SKILL.md
          </Button>
        </CardContent>
      </Card>

      {drawerOpen && (
        <>
          <Box
            sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.3)', zIndex: 1300 }}
            onClick={() => setDrawerOpen(false)}
          />
          <SkillDrawer skillName={skill.name} onClose={() => setDrawerOpen(false)} />
        </>
      )}
    </>
  )
}
