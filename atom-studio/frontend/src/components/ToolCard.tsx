import { useState } from 'react'
import { Code, X } from 'lucide-react'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Button from '@mui/material/Button'

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
    <Box sx={{ position: 'fixed', inset: '0 0 0 auto', width: 520, bgcolor: 'background.paper', borderLeft: 1, borderColor: 'divider', boxShadow: 8, zIndex: 1400, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', p: 2, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{tool.name} — Input Schema</Typography>
        <IconButton size="small" onClick={onClose}>
          <X size={12} />
        </IconButton>
      </Box>
      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', fontFamily: 'monospace', margin: 0 }}>
          {JSON.stringify(schema, null, 2)}
        </pre>
      </Box>
    </Box>
  )
}

export function ToolCard({ tool, selected, onToggle }: ToolCardProps) {
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
        onClick={() => onToggle?.(tool.name)}
      >
        <CardContent sx={{ pb: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{tool.name}</Typography>
            {selected !== undefined && (
              <Chip
                label={selected ? 'selected' : 'add'}
                size="small"
                color={selected ? 'primary' : 'default'}
                variant={selected ? 'filled' : 'outlined'}
                sx={{ fontSize: 10, height: 18, flexShrink: 0 }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {tool.description ?? 'No description'}
          </Typography>
          <Button
            size="small"
            variant="text"
            startIcon={<Code size={12} />}
            sx={{ mt: 0.5, px: 0.5, fontSize: 11 }}
            onClick={e => { e.stopPropagation(); setDrawerOpen(true) }}
          >
            View schema
          </Button>
        </CardContent>
      </Card>

      {drawerOpen && (
        <>
          <Box
            sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.3)', zIndex: 1300 }}
            onClick={() => setDrawerOpen(false)}
          />
          <SchemaDrawer tool={tool} onClose={() => setDrawerOpen(false)} />
        </>
      )}
    </>
  )
}
