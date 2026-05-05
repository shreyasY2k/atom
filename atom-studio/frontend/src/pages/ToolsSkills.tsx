import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Alert from '@mui/material/Alert'
import InputAdornment from '@mui/material/InputAdornment'
import SearchIcon from '@mui/icons-material/Search'
import api from '@/lib/api'
import { SkillCard } from '@/components/SkillCard'
import { ToolCard } from '@/components/ToolCard'

type Tab = 'skills' | 'tools'

interface Skill {
  id: string
  name: string
  description: string | null
  dir: string | null
  builtin: boolean
  is_active: boolean
}

interface Tool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  input_schema?: Record<string, unknown>
}

export function ToolsSkills() {
  const [tab, setTab] = useState<Tab>('skills')
  const [search, setSearch] = useState('')

  const { data: skills = [], isLoading: skillsLoading } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: async () => (await api.get('/api/skills/')).data,
  })

  const { data: tools = [], isLoading: toolsLoading, error: toolsError } = useQuery<Tool[]>({
    queryKey: ['tools'],
    queryFn: async () => {
      const resp = await api.get('/api/tools/')
      return Array.isArray(resp.data) ? resp.data : []
    },
  })

  const toolsUnavailable = !toolsLoading && (toolsError || tools.length === 0)

  const q = search.toLowerCase()
  const filteredSkills = skills.filter(s =>
    s.name.toLowerCase().includes(q) || (s.description ?? '').toLowerCase().includes(q)
  )
  const filteredTools = tools.filter(t =>
    t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q)
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>Tools & Skills</Typography>

      {/* Tabs */}
      <Box sx={{ display: 'flex', gap: 0, borderBottom: 1, borderColor: 'divider' }}>
        {(['skills', 'tools'] as Tab[]).map(t => (
          <Button
            key={t}
            onClick={() => setTab(t)}
            sx={{
              borderRadius: 0,
              borderBottom: 2,
              borderColor: tab === t ? 'primary.main' : 'transparent',
              color: tab === t ? 'primary.main' : 'text.secondary',
              fontWeight: tab === t ? 600 : 400,
              px: 2,
              py: 1,
            }}
          >
            {t === 'skills' ? 'Skills' : 'Tools'}
          </Button>
        ))}
      </Box>

      {/* Search */}
      <TextField
        placeholder={`Search ${tab}…`}
        value={search}
        onChange={e => setSearch(e.target.value)}
        size="small"
        sx={{ maxWidth: 360 }}
        slotProps={{ input: {
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        } }}
      />

      {/* Skills tab */}
      {tab === 'skills' && (
        <>
          {skillsLoading ? (
            <Typography variant="body2" color="text.secondary">Loading skills…</Typography>
          ) : filteredSkills.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No skills found.</Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
              {filteredSkills.map(s => <SkillCard key={s.id} skill={s} />)}
            </Box>
          )}
        </>
      )}

      {/* Tools tab */}
      {tab === 'tools' && (
        <>
          {toolsLoading ? (
            <Typography variant="body2" color="text.secondary">Loading tools…</Typography>
          ) : toolsUnavailable ? (
            <Alert severity="warning">
              Tools unavailable — atom-llm is not reachable. Check that the LLM service is running.
            </Alert>
          ) : filteredTools.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No tools registered in atom-llm.</Typography>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 2 }}>
              {filteredTools.map(t => <ToolCard key={t.name} tool={t} />)}
            </Box>
          )}
        </>
      )}
    </Box>
  )
}
