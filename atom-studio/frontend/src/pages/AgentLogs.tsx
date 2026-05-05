import { useEffect, useRef, useState, useCallback } from 'react'
import { Link } from '@tanstack/react-router'
import { format } from 'date-fns'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Chip from '@mui/material/Chip'
import WifiOffIcon from '@mui/icons-material/WifiOff'
import WifiIcon from '@mui/icons-material/Wifi'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import { useAuthStore } from '@/lib/auth'

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
          ...prev.slice(-4999),
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            component={Link}
            to="/domains/$domainId/agents/$agentId"
            params={{ domainId, agentId } as never}
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'text.secondary', textDecoration: 'none', fontSize: 14, '&:hover': { color: 'text.primary' } }}
          >
            <ChevronLeftIcon fontSize="small" /> Agent
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 600 }}>Live Logs</Typography>
          <Chip
            icon={connected ? <WifiIcon /> : <WifiOffIcon />}
            label={connected ? 'Connected' : 'Connecting…'}
            color={connected ? 'success' : 'default'}
            size="small"
          />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">{lines.length} lines</Typography>
          <Button variant="outlined" size="small" onClick={() => setLines([])}>Clear</Button>
          <Button
            variant={autoScroll ? 'contained' : 'outlined'}
            size="small"
            onClick={() => {
              setAutoScroll(true)
              bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
            }}
          >
            Auto-scroll
          </Button>
        </Box>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          bgcolor: '#000',
          borderRadius: 1,
          fontFamily: 'monospace',
          fontSize: 12,
          color: '#4ade80',
          p: 1.5,
          height: 'calc(100vh - 200px)',
        }}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <Typography sx={{ color: 'grey.600', fontSize: 12, fontFamily: 'monospace' }}>
            {connected ? 'Waiting for log output…' : 'Connecting to log stream…'}
          </Typography>
        ) : (
          lines.map(line => (
            <Box
              key={line.id}
              sx={{
                display: 'flex',
                gap: 1.5,
                lineHeight: 1.6,
                color: line.source === 'stderr' ? '#f87171' : undefined,
              }}
            >
              <Box component="span" sx={{ color: 'grey.600', userSelect: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {format(new Date(line.timestamp), 'HH:mm:ss.SSS')}
              </Box>
              <Box component="span" sx={{ wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
                {line.message}
              </Box>
            </Box>
          ))
        )}
        <div ref={bottomRef} />
      </Box>
    </Box>
  )
}
