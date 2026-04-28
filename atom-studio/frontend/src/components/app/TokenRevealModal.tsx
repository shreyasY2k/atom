import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Copy, Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { toast } from '@/hooks/use-toast'

interface TokenRevealModalProps {
  open: boolean
  token: string
  agentId: string
  domainId: string
}

export function TokenRevealModal({ open, token, agentId, domainId }: TokenRevealModalProps) {
  const navigate = useNavigate()
  const [confirmed, setConfirmed] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: 'Copy failed', description: 'Select and copy manually.', variant: 'destructive' })
    }
  }

  const handleClose = () => {
    navigate({ to: '/domains/$domainId/agents/$agentId', params: { domainId, agentId } })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        /* blocked — must use checkbox + Close button */
      }}
    >
      <DialogContent
        onInteractOutside={e => e.preventDefault()}
        onEscapeKeyDown={e => e.preventDefault()}
        className="max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-5 w-5" />
            Copy your agent token now
          </DialogTitle>
          <DialogDescription>
            This token is shown exactly once and cannot be recovered. It is your agent&apos;s
            credential for prod mode — set it as <code className="font-mono text-xs">ATOM_AGENT_JWT</code>{' '}
            in your agent project&apos;s <code className="font-mono text-xs">.env</code> file.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Token field */}
          <div className="flex gap-2">
            <input
              readOnly
              value={token}
              className="flex-1 font-mono text-xs rounded-md border border-input bg-muted px-3 py-2 truncate select-all"
              onClick={e => (e.target as HTMLInputElement).select()}
            />
            <Button variant="outline" size="icon" onClick={handleCopy} title="Copy token">
              {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          {/* Env var instructions */}
          <div className="rounded-md bg-muted p-3 space-y-1">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              To use in your agent project&apos;s .env file:
            </p>
            {[
              'ATOM_MODE=prod',
              `ATOM_AGENT_JWT=${token.slice(0, 20)}…`,
              'ATOM_GATE_URL=http://<your-gate>:8080',
            ].map(line => (
              <code key={line} className="block font-mono text-xs text-foreground">
                {line}
              </code>
            ))}
          </div>

          {/* Confirmation checkbox */}
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={e => setConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
            />
            <span className="text-sm">I have copied the token and stored it securely</span>
          </label>

          {/* Close button — disabled until confirmed */}
          <Button className="w-full" disabled={!confirmed} onClick={handleClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
