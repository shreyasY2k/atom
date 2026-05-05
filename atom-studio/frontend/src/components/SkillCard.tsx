import { useState } from 'react'
import { BookOpen, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

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
    <div className="fixed inset-y-0 right-0 w-[520px] bg-background border-l shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">{skillName}</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <pre className="text-xs whitespace-pre-wrap font-mono">{content}</pre>
        )}
      </div>
    </div>
  )
}

export function SkillCard({ skill, selected, onToggle }: SkillCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <Card
        className={`cursor-default transition-colors ${selected !== undefined ? 'cursor-pointer' : ''} ${selected ? 'border-primary bg-primary/5' : ''}`}
        onClick={() => onToggle?.(skill.name)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium">{skill.name}</CardTitle>
            <div className="flex gap-1 shrink-0">
              {skill.builtin && <Badge variant="secondary" className="text-xs">built-in</Badge>}
              {selected !== undefined && (
                <Badge variant={selected ? 'default' : 'outline'} className="text-xs">
                  {selected ? 'selected' : 'add'}
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground line-clamp-2">{skill.description ?? 'No description'}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-xs"
            onClick={e => { e.stopPropagation(); setDrawerOpen(true) }}
          >
            <BookOpen className="h-3 w-3 mr-1" />
            View SKILL.md
          </Button>
        </CardContent>
      </Card>
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <SkillDrawer skillName={skill.name} onClose={() => setDrawerOpen(false)} />
        </>
      )}
    </>
  )
}
