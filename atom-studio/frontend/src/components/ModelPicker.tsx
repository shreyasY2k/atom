import { useQuery } from '@tanstack/react-query'
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

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading models…</p>

  return (
    <div className="flex flex-wrap gap-2">
      {models.map(m => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          className={`px-3 py-1.5 rounded-md text-sm border transition-colors ${
            value === m.id
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border hover:border-primary/60 hover:bg-accent'
          }`}
        >
          {m.name}
        </button>
      ))}
    </div>
  )
}
