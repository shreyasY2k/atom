import { useState, useCallback, useRef } from 'react'
import api from '@/lib/api'
import { useAuthStore } from '@/lib/auth'

export interface BuilderOption {
  label: string
  value: string
  description?: string
}

export interface BuilderMessage {
  role: 'user' | 'assistant'
  content: string
  options?: BuilderOption[]
}

export interface AgentSpec {
  agentName: string | null
  model: string | null
  tools: string[]
  skills: string[]
  a2aTargets: string[]
  hitlConfig: Record<string, unknown> | null
  intent: string | null
}

const EMPTY_SPEC: AgentSpec = {
  agentName: null,
  model: null,
  tools: [],
  skills: [],
  a2aTargets: [],
  hitlConfig: null,
  intent: null,
}

export function useBuilderChat(domainId: string, ciTarget: 'gitlab' | 'local') {
  const [messages, setMessages] = useState<BuilderMessage[]>([])
  const [spec, setSpec] = useState<AgentSpec>(EMPTY_SPEC)
  const [stage, setStage] = useState<string>('greeting')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const accessToken = useAuthStore(s => s.accessToken)
  const abortRef = useRef<AbortController | null>(null)

  const applyUpdates = useCallback((updates: Record<string, unknown>) => {
    setSpec(prev => {
      const next = { ...prev }
      if (updates.intent) next.intent = updates.intent as string
      if (updates.agent_name) next.agentName = updates.agent_name as string
      if (updates.model) next.model = updates.model as string
      if (Array.isArray(updates.tools)) next.tools = updates.tools as string[]
      if (Array.isArray(updates.skills)) next.skills = updates.skills as string[]
      if (Array.isArray(updates.a2a_targets)) next.a2aTargets = updates.a2a_targets as string[]
      if ('hitl_config' in updates) next.hitlConfig = updates.hitl_config as Record<string, unknown> | null
      return next
    })
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setLoading(true)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    let assistantContent = ''
    let assistantOptions: BuilderOption[] = []

    try {
      const resp = await fetch('/api/builder/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          message: text,
          domain_id: domainId,
          ci_target: ciTarget,
        }),
        signal: abortRef.current.signal,
      })

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      if (!resp.body) throw new Error('No response body')

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (!raw) continue
          try {
            const evt = JSON.parse(raw)
            if (evt.type === 'session_id') setSessionId(evt.session_id)
            if (evt.type === 'token') {
              assistantContent = evt.content
              assistantOptions = (evt.options as BuilderOption[]) ?? []
            }
            if (evt.type === 'spec_update') applyUpdates(evt.updates)
            if (evt.type === 'stage_change') setStage(evt.stage)
          } catch { /* ignore parse errors */ }
        }
      }

      if (assistantContent) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: assistantContent,
          options: assistantOptions.length > 0 ? assistantOptions : undefined,
        }])
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Sorry, something went wrong. Please try again.',
        }])
      }
    } finally {
      setLoading(false)
    }
  }, [loading, sessionId, domainId, ciTarget, accessToken, applyUpdates])

  const restoreSession = useCallback(async (sid: string) => {
    try {
      const { data } = await api.get(`/api/builder/session/${sid}`)
      setSessionId(sid)
      setStage(data.stage)
      setSpec({
        agentName: data.agent_name,
        model: data.model,
        tools: data.tools ?? [],
        skills: data.skills ?? [],
        a2aTargets: data.a2a_targets ?? [],
        hitlConfig: data.hitl_config,
        intent: data.intent,
      })
      const msgs: BuilderMessage[] = (data.messages ?? []).map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))
      setMessages(msgs)
    } catch { /* start fresh */ }
  }, [])

  return { messages, spec, stage, sessionId, loading, sendMessage, restoreSession, setSpec }
}
