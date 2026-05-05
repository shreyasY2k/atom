import { useEffect, useRef, useState } from 'react'
import { Send, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { BuilderMessage } from '@/hooks/useBuilderChat'

interface Props {
  messages: BuilderMessage[]
  loading: boolean
  onSend: (text: string) => void
}

export function ConversationPanel({ messages, loading, onSend }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    onSend(text)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground italic pt-2">
            Describe what you want to build and I'll guide you through the setup.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground shrink-0 mt-0.5">
                AI
              </div>
            )}
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-foreground'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 justify-start">
            <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground shrink-0">
              AI
            </div>
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-3 flex gap-2">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          rows={2}
          className="resize-none text-sm"
          disabled={loading}
        />
        <Button onClick={handleSend} disabled={!input.trim() || loading} size="icon" className="shrink-0 h-full">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
