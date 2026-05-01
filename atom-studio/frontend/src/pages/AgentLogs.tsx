import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import { ChevronLeft, WifiOff, Wifi } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface LogLine {
  id: string
  timestamp: string
  message: string
  source: string
}

interface AgentLogsProps {
  domainId: string
  agentId: string
}

const WS_BASE =
  import.meta.env.VITE_WS_URL ??
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`

export function AgentLogs({ domainId, agentId }: AgentLogsProps) {
  const { accessToken } = useAuthStore()
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const lineIdRef = useRef(0)

  const connect = useCallback(() => {
    if (!accessToken) return
    const url = `${WS_BASE}/ws/agents/${agentId}/logs?token=${accessToken}`
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setConnected(true)

    ws.onmessage = evt => {
      try {
        const data = JSON.parse(evt.data) as {
          timestamp?: string
          message?: string
          source?: string
        }
        setLines(prev => [
          ...prev.slice(-4999), // cap at 5000 lines
          {
            id: String(++lineIdRef.current),
            timestamp: data.timestamp ?? new Date().toISOString(),
            message: data.message ?? evt.data,
            source: data.source ?? '',
          },
        ])
      } catch {
        setLines(prev => [
          ...prev.slice(-4999),
          {
            id: String(++lineIdRef.current),
            timestamp: new Date().toISOString(),
            message: evt.data,
            source: '',
          },
        ])
      }
    }

    ws.onerror = () => setConnected(false)
    ws.onclose = () => {
      setConnected(false)
      // Reconnect after 3s
      setTimeout(connect, 3000)
    }
  }, [agentId, accessToken])

  useEffect(() => {
    connect()
    return () => {
      wsRef.current?.close()
    }
  }, [connect])

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    setAutoScroll(atBottom)
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to="/domains/$domainId/agents/$agentId"
            params={{ domainId, agentId }}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Agent
          </Link>
          <h2 className="text-lg font-semibold">Live Logs</h2>
          <Badge variant={connected ? 'default' : 'secondary'} className="gap-1 text-xs">
            {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {connected ? 'Connected' : 'Connecting…'}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{lines.length} lines</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLines([])}
          >
            Clear
          </Button>
          <Button
            variant={autoScroll ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            Auto-scroll
          </Button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto bg-black rounded-lg font-mono text-xs text-green-400 p-3 min-h-0"
        style={{ height: 'calc(100vh - 200px)' }}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <span className="text-muted-foreground">
            {connected
              ? 'Waiting for log output…'
              : 'Connecting to log stream…'}
          </span>
        ) : (
          lines.map(line => (
            <div key={line.id} className={cn('flex gap-2 leading-5', line.source === 'stderr' && 'text-red-400')}>
              <span className="text-gray-500 select-none shrink-0">
                {format(new Date(line.timestamp), 'HH:mm:ss.SSS')}
              </span>
              <span className="break-all whitespace-pre-wrap">{line.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
