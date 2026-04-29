import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { ChevronLeft, ChevronRight, ExternalLink, Wrench, Brain } from 'lucide-react'
import api from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

interface Step {
  type: 'thinking' | 'tool_use' | 'tool_result'
  text?: string
  name?: string
  input?: Record<string, unknown>
  content?: string
}

interface Run {
  id: string
  run_id: string
  trace_id: string | null
  user_msg: string
  reply: string
  steps: Step[] | null | undefined
  latency_ms: number | null
  created_at: string
}

interface RunPage {
  total: number
  page: number
  page_size: number
  items: Run[]
}

const TEMPO_BASE = 'http://localhost:3005/explore?orgId=1&left={"datasource":"tempo","queries":[{"refId":"A","queryType":"traceql","query":"{trace_id=\\"$ID\\"}"}],"range":{"from":"now-1h","to":"now"}}'

function traceLink(traceId: string) {
  return TEMPO_BASE.replace('$ID', traceId)
}

interface AgentConversationsProps {
  agentId: string
}

export function AgentConversations({ agentId }: AgentConversationsProps) {
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const pageSize = 20

  const { data, isLoading } = useQuery<RunPage>({
    queryKey: ['runs', agentId, page],
    queryFn: async () =>
      (await api.get(`/api/agents/${agentId}/runs/?page=${page}&page_size=${pageSize}`)).data,
    refetchInterval: 5000,
  })

  const totalPages = data ? Math.ceil(data.total / pageSize) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link to="/agents" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Agents
        </Link>
        <h2 className="text-xl font-bold">Conversations</h2>
        <span className="text-sm text-muted-foreground">{data?.total ?? '…'} total</span>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-3">
        {(data?.items ?? []).map(run => (
          <Card key={run.id} className="overflow-hidden">
            <CardHeader
              className="py-3 px-4 cursor-pointer hover:bg-muted/40 transition-colors"
              onClick={() => setExpanded(expanded === run.id ? null : run.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{run.user_msg}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{run.reply}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {run.latency_ms != null && (
                    <span className="text-xs text-muted-foreground">{run.latency_ms}ms</span>
                  )}
                  {(run.steps ?? []).length > 0 && (
                    <Badge variant="secondary" className="text-xs">{(run.steps ?? []).length} steps</Badge>
                  )}
                  {run.trace_id && (
                    <a
                      href={traceLink(run.trace_id)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-blue-500 hover:text-blue-400"
                      title="View trace in Grafana Tempo"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(run.created_at), 'MMM d HH:mm:ss')}
                  </span>
                </div>
              </div>
            </CardHeader>

            {expanded === run.id && (
              <CardContent className="px-4 pb-4 pt-0 space-y-3 border-t">
                {/* User message */}
                <div className="flex justify-end">
                  <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-2 max-w-[80%] text-sm">
                    {run.user_msg}
                  </div>
                </div>

                {/* Thinking / tool steps */}
                {(run.steps ?? []).map((step, i) => (
                  <StepBlock key={i} step={step} />
                ))}

                {/* Agent reply */}
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-2 max-w-[80%] text-sm whitespace-pre-wrap">
                    {run.reply}
                  </div>
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span>run_id: <code className="font-mono">{run.run_id.slice(0, 8)}…</code></span>
                  {run.trace_id && (
                    <a href={traceLink(run.trace_id)} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1 text-blue-500 hover:text-blue-400">
                      <ExternalLink className="h-3 w-3" /> trace
                    </a>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        ))}

        {data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            No conversations yet. Send a request to the agent to see it here.
          </p>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted-foreground">Page {page} of {totalPages}</span>
          <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function StepBlock({ step }: { step: Step }) {
  if (step.type === 'thinking') {
    return (
      <div className="flex items-start gap-2 text-xs text-muted-foreground italic border-l-2 border-muted pl-3 py-1">
        <Brain className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap">{step.text}</span>
      </div>
    )
  }
  if (step.type === 'tool_use') {
    return (
      <div className="flex items-start gap-2 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded px-3 py-2">
        <Wrench className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-600" />
        <div>
          <span className="font-medium text-yellow-700 dark:text-yellow-400">{step.name}</span>
          {step.input && Object.keys(step.input).length > 0 && (
            <pre className="mt-1 text-muted-foreground font-mono text-xs whitespace-pre-wrap">
              {JSON.stringify(step.input, null, 2)}
            </pre>
          )}
        </div>
      </div>
    )
  }
  if (step.type === 'tool_result') {
    return (
      <div className="text-xs text-muted-foreground bg-muted/50 rounded px-3 py-2 font-mono whitespace-pre-wrap">
        {step.content}
      </div>
    )
  }
  return null
}
