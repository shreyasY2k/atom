import { useEffect, useRef } from 'react'
import { useAuthStore } from '@/lib/auth'
import { useHitlStore, HitlItem } from '@/lib/hitlStore'

export function useHitlWebSocket() {
  const accessToken = useAuthStore(s => s.accessToken)
  const { addItem, resolveItem, expireItem } = useHitlStore()
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!accessToken) return

    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${protocol}//${window.location.host}/ws/hitl?token=${accessToken}`
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onmessage = e => {
        const msg = JSON.parse(e.data)
        if (msg.type === 'NEW_DECISION') {
          addItem({
            id: msg.hitl_id,
            agent_id: msg.agent_id ?? '',
            agent_name: msg.agent_name ?? '',
            workflow_type: msg.workflow_type,
            payload: msg.payload ?? {},
            status: 'pending',
            expires_at: msg.expires_at ?? null,
            created_at: new Date().toISOString(),
            decision_note: null,
            decided_by: null,
            decided_at: null,
          } as HitlItem)
        } else if (msg.type === 'DECISION_MADE') {
          resolveItem(msg.hitl_id, msg.approved, msg.note ?? null)
        } else if (msg.type === 'DECISION_TIMED_OUT') {
          expireItem(msg.hitl_id)
        }
      }

      ws.onclose = () => {
        reconnectTimer.current = setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [accessToken, addItem, resolveItem, expireItem])
}
