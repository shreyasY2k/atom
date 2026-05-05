import { useState } from 'react'
import { Code, X } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface Tool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  input_schema?: Record<string, unknown>
}

interface ToolCardProps {
  tool: Tool
  selected?: boolean
  onToggle?: (name: string) => void
}

function SchemaDrawer({ tool, onClose }: { tool: Tool; onClose: () => void }) {
  const schema = tool.inputSchema ?? tool.input_schema ?? {}
  return (
    <div className="fixed inset-y-0 right-0 w-[520px] bg-background border-l shadow-xl z-50 flex flex-col">
      <div className="flex items-center justify-between p-4 border-b">
        <h3 className="font-semibold">{tool.name} — Input Schema</h3>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <pre className="text-xs whitespace-pre-wrap font-mono">{JSON.stringify(schema, null, 2)}</pre>
      </div>
    </div>
  )
}

export function ToolCard({ tool, selected, onToggle }: ToolCardProps) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <>
      <Card
        className={`cursor-default transition-colors ${selected !== undefined ? 'cursor-pointer' : ''} ${selected ? 'border-primary bg-primary/5' : ''}`}
        onClick={() => onToggle?.(tool.name)}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-medium">{tool.name}</CardTitle>
            {selected !== undefined && (
              <Badge variant={selected ? 'default' : 'outline'} className="text-xs">
                {selected ? 'selected' : 'add'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground line-clamp-2">{tool.description ?? 'No description'}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-7 px-2 text-xs"
            onClick={e => { e.stopPropagation(); setDrawerOpen(true) }}
          >
            <Code className="h-3 w-3 mr-1" />
            View schema
          </Button>
        </CardContent>
      </Card>
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setDrawerOpen(false)} />
          <SchemaDrawer tool={tool} onClose={() => setDrawerOpen(false)} />
        </>
      )}
    </>
  )
}
