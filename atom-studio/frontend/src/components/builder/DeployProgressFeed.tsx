import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import type { DeployStep } from '@/hooks/useBuilderDeploy'

interface Props {
  steps: DeployStep[]
  deploying: boolean
  error: string | null
}


export function DeployProgressFeed({ steps, deploying, error }: Props) {
  if (steps.length === 0 && !deploying) return null

  return (
    <div className="space-y-1.5 text-sm">
      {steps.map((s, i) => {
        const isError = s.message.startsWith('✗')
        return (
          <div key={i} className={`flex items-start gap-2 ${isError ? 'text-destructive' : 'text-foreground'}`}>
            {isError
              ? <XCircle className="h-4 w-4 shrink-0 mt-0.5 text-destructive" />
              : <CheckCircle className="h-4 w-4 shrink-0 mt-0.5 text-green-500" />}
            <span>{s.message}</span>
            {s.url && (
              <a href={s.url} target="_blank" rel="noreferrer" className="text-primary underline text-xs ml-1">
                view
              </a>
            )}
          </div>
        )
      })}
      {deploying && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>Working…</span>
        </div>
      )}
    </div>
  )
}
