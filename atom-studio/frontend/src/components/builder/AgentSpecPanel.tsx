import { Shield, ClipboardList, Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { AgentSpec } from '@/hooks/useBuilderChat'

interface Props {
  spec: AgentSpec
  stage: string
  ciTarget: 'gitlab' | 'local'
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-2 py-1.5 border-b last:border-0">
      <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
      <span className="text-xs text-right flex-1 break-words">{value ?? <span className="text-muted-foreground/50">—</span>}</span>
    </div>
  )
}

export function AgentSpecPanel({ spec, stage, ciTarget }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Agent Spec</h3>
        <div className="bg-muted/40 rounded-md px-3 py-1">
          <Row label="Name" value={spec.agentName} />
          <Row label="Model" value={spec.model} />
          <Row label="Tools" value={
            spec.tools.length
              ? <div className="flex flex-wrap gap-1 justify-end">{spec.tools.map(t => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}</div>
              : null
          } />
          <Row label="Skills" value={
            spec.skills.length
              ? <div className="flex flex-wrap gap-1 justify-end">{spec.skills.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)}</div>
              : null
          } />
          <Row label="HITL" value={spec.hitlConfig ? (spec.hitlConfig.enabled ? 'enabled' : 'disabled') : null} />
          <Row label="A2A" value={spec.a2aTargets.length ? spec.a2aTargets.join(', ') : 'none'} />
          <Row label="Build" value={ciTarget === 'gitlab' ? 'GitLab (private)' : 'Local Docker'} />
        </div>
      </div>

      <div className="border rounded-md p-3 bg-background space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3.5 w-3.5 text-primary" />
          <span>Guardrails always active</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <ClipboardList className="h-3.5 w-3.5 text-primary" />
          <span>Audit always on</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3.5 w-3.5 text-primary" />
          <span>Agent ID + JWT auto-provisioned</span>
        </div>
      </div>

      {stage !== 'greeting' && (
        <div className="text-xs text-muted-foreground text-center">
          Stage: <span className="font-medium text-foreground">{stage}</span>
        </div>
      )}
    </div>
  )
}
