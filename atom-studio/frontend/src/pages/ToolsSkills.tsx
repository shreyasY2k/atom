import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, AlertCircle } from 'lucide-react'
import api from '@/lib/api'
import { Input } from '@/components/ui/input'
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Tools & Skills</h2>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        {(['skills', 'tools'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'skills' ? 'Skills' : 'Tools'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${tab}…`}
          className="pl-8"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Skills tab */}
      {tab === 'skills' && (
        <>
          {skillsLoading ? (
            <p className="text-sm text-muted-foreground">Loading skills…</p>
          ) : filteredSkills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No skills found.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredSkills.map(s => <SkillCard key={s.id} skill={s} />)}
            </div>
          )}
        </>
      )}

      {/* Tools tab */}
      {tab === 'tools' && (
        <>
          {toolsLoading ? (
            <p className="text-sm text-muted-foreground">Loading tools…</p>
          ) : toolsUnavailable ? (
            <div className="flex items-center gap-2 text-sm text-amber-600 border border-amber-200 bg-amber-50 rounded-md p-3">
              <AlertCircle className="h-4 w-4 shrink-0" />
              Tools unavailable — atom-llm is not reachable. Check that the LLM service is running.
            </div>
          ) : filteredTools.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tools registered in atom-llm.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTools.map(t => <ToolCard key={t.name} tool={t} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
