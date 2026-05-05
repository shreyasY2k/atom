import { CheckCircle } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  agentName: string | null
  chatUrl: string
}

export function AgentReadyCard({ agentName, chatUrl }: Props) {
  return (
    <Card className="border-green-500 bg-green-50 dark:bg-green-950/20">
      <CardContent className="pt-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p className="font-semibold text-sm">{agentName ?? 'Agent'} is live</p>
            <p className="text-xs text-muted-foreground">Deployed and ready to chat</p>
          </div>
        </div>
        <Button asChild size="sm">
          <Link to={chatUrl as never}>Chat now →</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
