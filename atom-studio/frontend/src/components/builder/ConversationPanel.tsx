import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
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
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', pt: 1 }}>
            Describe what you want to build and I'll guide you through the setup.
          </Typography>
        )}
        {messages.map((msg, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            {msg.role === 'assistant' && (
              <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.5 }}>
                <Typography variant="caption" sx={{ color: 'primary.contrastText', fontSize: 11, fontWeight: 700 }}>AI</Typography>
              </Box>
            )}
            <Box sx={{
              maxWidth: '80%', borderRadius: 2, px: 1.5, py: 1, fontSize: 14,
              bgcolor: msg.role === 'user' ? 'primary.main' : 'grey.100',
              color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
              whiteSpace: 'pre-wrap',
            }}>
              <Typography variant="body2" sx={{ color: 'inherit' }}>{msg.content}</Typography>
            </Box>
          </Box>
        ))}
        {loading && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start', alignItems: 'center' }}>
            <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography variant="caption" sx={{ color: 'primary.contrastText', fontSize: 11, fontWeight: 700 }}>AI</Typography>
            </Box>
            <Box sx={{ bgcolor: 'grey.100', borderRadius: 2, px: 1.5, py: 1 }}>
              <CircularProgress size={16} />
            </Box>
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      <Box sx={{ borderTop: 1, borderColor: 'divider', p: 1.5, display: 'flex', gap: 1 }}>
        <TextField
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message… (Enter to send)"
          multiline
          maxRows={3}
          size="small"
          fullWidth
          disabled={loading}
          sx={{ '& .MuiInputBase-input': { fontSize: 14 } }}
        />
        <IconButton
          onClick={handleSend}
          disabled={!input.trim() || loading}
          color="primary"
          sx={{ alignSelf: 'flex-end', border: 1, borderColor: 'divider', flexShrink: 0 }}
        >
          <Send size={16} />
        </IconButton>
      </Box>
    </Box>
  )
}
