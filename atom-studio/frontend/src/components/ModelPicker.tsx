import { useQuery } from '@tanstack/react-query'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import api from '@/lib/api'

interface Model {
  id: string
  name: string
}

interface ModelPickerProps {
  value: string
  onChange: (modelId: string) => void
}

export function ModelPicker({ value, onChange }: ModelPickerProps) {
  const { data: models = [], isLoading } = useQuery<Model[]>({
    queryKey: ['builder-models'],
    queryFn: async () => (await api.get('/api/builder/models')).data,
  })

  if (isLoading) return <Typography variant="body2" color="text.secondary">Loading models…</Typography>

  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {models.map(m => (
        <Button
          key={m.id}
          size="small"
          variant={value === m.id ? 'contained' : 'outlined'}
          onClick={() => onChange(m.id)}
        >
          {m.name}
        </Button>
      ))}
    </Box>
  )
}
