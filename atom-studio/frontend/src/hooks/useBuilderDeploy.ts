import { useState, useCallback, useRef } from 'react'
import { useAuthStore } from '@/lib/auth'

export interface DeployStep {
  step: string
  message: string
  url?: string
  status?: string
}

export function useBuilderDeploy() {
  const [steps, setSteps] = useState<DeployStep[]>([])
  const [deploying, setDeploying] = useState(false)
  const [chatUrl, setChatUrl] = useState<string | null>(null)
  const [agentPy, setAgentPy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const accessToken = useAuthStore(s => s.accessToken)
  const abortRef = useRef<AbortController | null>(null)

  const deploy = useCallback(async (sessionId: string) => {
    setDeploying(true)
    setSteps([])
    setChatUrl(null)
    setError(null)

    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const resp = await fetch('/api/builder/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
        signal: abortRef.current.signal,
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail ?? `HTTP ${resp.status}`)
      }
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
            if (evt.type === 'progress' || evt.type === 'pipeline_poll') {
              setSteps(prev => [...prev, { step: evt.step, message: evt.message, url: evt.url, status: evt.status }])
            }
            if (evt.type === 'error') {
              setError(evt.message)
              setSteps(prev => [...prev, { step: evt.step, message: `✗ ${evt.message}` }])
            }
            if (evt.type === 'done') {
              setChatUrl(evt.chat_url ?? null)
              if (evt.agent_py) setAgentPy(evt.agent_py as string)
            }
          } catch { /* ignore */ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
      }
    } finally {
      setDeploying(false)
    }
  }, [accessToken])

  return { steps, deploying, chatUrl, agentPy, error, deploy }
}
