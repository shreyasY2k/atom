import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import CircularProgress from '@mui/material/CircularProgress'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import type { BuilderMessage, BuilderOption } from '@/hooks/useBuilderChat'

interface Props {
  messages: BuilderMessage[]
  loading: boolean
  onSend: (text: string) => void
}

function OptionChips({ options, onSelect }: { options: BuilderOption[]; onSelect: (v: string) => void }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
      {options.map(opt => (
        <Tooltip key={opt.value} title={opt.description ?? ''} placement="top">
          <Chip
            label={opt.label}
            size="small"
            variant="outlined"
            clickable
            onClick={() => onSelect(opt.value)}
            sx={{
              fontSize: 12,
              cursor: 'pointer',
              borderColor: 'primary.main',
              color: 'primary.main',
              '&:hover': { bgcolor: 'primary.50', borderColor: 'primary.dark' },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  )
}

export function ConversationPanel({ messages, loading, onSend }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const handleSend = (text?: string) => {
    const t = (text ?? input).trim()
    if (!t || loading) return
    setInput('')
    onSend(t)
  }

  const handleKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Message list */}
      <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {messages.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', pt: 1 }}>
            Describe what you want to build and I'll guide you through the setup.
          </Typography>
        )}
        {messages.map((msg, i) => (
          <Box key={i}>
            <Box sx={{
              display: 'flex',
              gap: 1,
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            }}>
              {msg.role === 'assistant' && (
                <Box sx={{
                  width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, mt: 0.5,
                }}>
                  <Typography variant="caption" sx={{ color: 'primary.contrastText', fontSize: 11, fontWeight: 700 }}>
                    AI
                  </Typography>
                </Box>
              )}
              <Box sx={{
                maxWidth: '80%', borderRadius: 2, px: 1.5, py: 1,
                bgcolor: msg.role === 'user' ? 'primary.main' : 'grey.100',
                color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                whiteSpace: 'pre-wrap',
              }}>
                <Typography variant="body2" sx={{ color: 'inherit' }}>{msg.content}</Typography>
              </Box>
            </Box>

            {/* Selectable option chips — only on last assistant message when not loading */}
            {msg.role === 'assistant' && msg.options && msg.options.length > 0 && i === messages.length - 1 && !loading && (
              <Box sx={{ pl: 5 }}>
                <OptionChips options={msg.options} onSelect={v => handleSend(v)} />
              </Box>
            )}
          </Box>
        ))}

        {loading && (
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-start', alignItems: 'center' }}>
            <Box sx={{
              width: 28, height: 28, borderRadius: '50%', bgcolor: 'primary.main',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Typography variant="caption" sx={{ color: 'primary.contrastText', fontSize: 11, fontWeight: 700 }}>AI</Typography>
            </Box>
            <Box sx={{ bgcolor: 'grey.100', borderRadius: 2, px: 1.5, py: 1 }}>
              <CircularProgress size={16} />
            </Box>
          </Box>
        )}
        <div ref={bottomRef} />
      </Box>

      {/* Input row */}
      <Box sx={{ borderTop: 1, borderColor: 'divider', p: 1.5, display: 'flex', gap: 1 }}>
        <TextField
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Type a message or pick an option above… (Enter to send)"
          multiline
          maxRows={3}
          size="small"
          fullWidth
          disabled={loading}
          sx={{ '& .MuiInputBase-input': { fontSize: 14 } }}
        />
        <IconButton
          onClick={() => handleSend()}
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
