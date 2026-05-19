/**
 * Compliance Report tab — generates and displays a per-agent compliance report
 * from all available audit logs, guardrail events, and activity data.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  Box, Button, Typography, Paper, CircularProgress, Alert,
  Stack, Chip, LinearProgress, Divider, TextField, MenuItem,
  IconButton, Tooltip,
} from '@mui/material'
import ArticleIcon from '@mui/icons-material/Article'
import DownloadIcon from '@mui/icons-material/Download'
import RefreshIcon from '@mui/icons-material/Refresh'
import { builderApi } from '../../api/builder'

interface Props { agentName: string }

interface ReportRecord {
  report_id: string
  status: 'generating' | 'complete' | 'failed'
  created_at?: string
  period_start?: string
  period_end?: string
  report_md?: string
}

function MarkdownView({ md }: { md: string }) {
  // Simple markdown renderer — headings, bold, bullets, tables
  const lines = md.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('# ')) {
      elements.push(<Typography key={i} variant="h5" fontWeight={700} sx={{ mt: 3, mb: 1 }}>{line.slice(2)}</Typography>)
    } else if (line.startsWith('## ')) {
      elements.push(<Typography key={i} variant="h6" fontWeight={700} sx={{ mt: 2.5, mb: 0.75, color: 'primary.main' }}>{line.slice(3)}</Typography>)
    } else if (line.startsWith('### ')) {
      elements.push(<Typography key={i} variant="subtitle1" fontWeight={700} sx={{ mt: 2, mb: 0.5 }}>{line.slice(4)}</Typography>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      const items = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(<li key={i}><Typography variant="body2">{lines[i].slice(2).replace(/\*\*(.*?)\*\*/g, '$1')}</Typography></li>)
        i++
      }
      elements.push(<Box key={`ul-${i}`} component="ul" sx={{ pl: 3, my: 0.5 }}>{items}</Box>)
      continue
    } else if (line.startsWith('| ')) {
      // Table
      const tableLines = []
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!lines[i].match(/^[|\s:-]+$/)) tableLines.push(lines[i])
        i++
      }
      if (tableLines.length > 0) {
        const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim())
        const rows = tableLines.slice(1).map(row => row.split('|').filter(c => c.trim()).map(c => c.trim()))
        elements.push(
          <Box key={`table-${i}`} sx={{ overflowX: 'auto', my: 1.5 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '0.82rem' }}>
              <thead>
                <tr>{headers.map((h, hi) => <th key={hi} style={{ border: '1px solid #ddd', padding: '6px 10px', background: '#f5f5f5', textAlign: 'left', fontWeight: 700 }}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ border: '1px solid #ddd', padding: '6px 10px' }}>{cell}</td>)}</tr>)}
              </tbody>
            </table>
          </Box>
        )
        continue
      }
    } else if (line.trim() === '') {
      // Skip blank lines
    } else if (line.startsWith('**') && line.endsWith('**') && line.length > 4) {
      elements.push(<Typography key={i} variant="body2" fontWeight={700} sx={{ mt: 1 }}>{line.slice(2, -2)}</Typography>)
    } else if (line.trim()) {
      const richText = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/`(.*?)`/g, '<code style="background:#f5f5f5;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.82em">$1</code>')
      elements.push(<Typography key={i} variant="body2" sx={{ lineHeight: 1.7 }} dangerouslySetInnerHTML={{ __html: richText }} />)
    }
    i++
  }

  return <Box>{elements}</Box>
}

export default function ComplianceReport({ agentName }: Props) {
  const [reports, setReports] = useState<ReportRecord[]>([])
  const [activeReport, setActiveReport] = useState<ReportRecord | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [periodDays, setPeriodDays] = useState(30)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadReports = async () => {
    try {
      const { reports } = await builderApi.listComplianceReports(agentName)
      setReports(reports as ReportRecord[])
      if (reports.length > 0 && !activeReport) {
        setActiveReport(reports[0] as ReportRecord)
      }
    } catch { /* non-fatal */ }
  }

  useEffect(() => {
    loadReports()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [agentName])

  // Poll while generating
  useEffect(() => {
    if (activeReport?.status === 'generating') {
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        try {
          const updated = await builderApi.getComplianceReport(agentName, activeReport.report_id)
          setActiveReport(updated as ReportRecord)
          if (updated.status !== 'generating') {
            if (pollRef.current) clearInterval(pollRef.current)
            await loadReports()
          }
        } catch { if (pollRef.current) clearInterval(pollRef.current) }
      }, 3000)
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeReport?.report_id, activeReport?.status])

  const handleGenerate = async () => {
    setGenerating(true); setError('')
    try {
      const r = await builderApi.generateComplianceReport(agentName, periodDays)
      const newReport: ReportRecord = { report_id: r.report_id, status: 'generating' }
      setActiveReport(newReport)
      setReports(prev => [newReport, ...prev])
    } catch (e: unknown) {
      setError((e as { detail?: string })?.detail ?? 'Report generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const downloadReport = () => {
    if (!activeReport?.report_md) return
    const blob = new Blob([activeReport.report_md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url
    a.download = `compliance-report-${agentName}-${activeReport.created_at?.slice(0, 10) ?? 'latest'}.md`
    a.click(); URL.revokeObjectURL(url)
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mb: 2.5, flexWrap: 'wrap', gap: 1.5 }}>
        <Box>
          <Typography variant="subtitle1" fontWeight={700}>Compliance Report</Typography>
          <Typography variant="caption" color="text.secondary">
            AI-generated from audit logs, guardrail events, and activity data. Uses Gemini 3.1 Pro.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            select size="small" label="Period" value={periodDays}
            onChange={e => setPeriodDays(Number(e.target.value))} sx={{ width: 120 }}>
            <MenuItem value={7}>Last 7 days</MenuItem>
            <MenuItem value={30}>Last 30 days</MenuItem>
            <MenuItem value={90}>Last 90 days</MenuItem>
          </TextField>
          <Button variant="contained" startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <ArticleIcon />}
            onClick={handleGenerate} disabled={generating}>
            {generating ? 'Generating…' : 'Generate Report'}
          </Button>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2, fontSize: '0.75rem' }}>{error}</Alert>}

      {/* Report selector */}
      {reports.length > 1 && (
        <Box sx={{ display: 'flex', gap: 0.75, mb: 2, flexWrap: 'wrap' }}>
          {reports.map(r => (
            <Chip key={r.report_id} size="small"
              label={r.created_at?.slice(0, 16).replace('T', ' ') ?? r.report_id.slice(0, 12)}
              variant={activeReport?.report_id === r.report_id ? 'filled' : 'outlined'}
              color={r.status === 'complete' ? 'success' : r.status === 'failed' ? 'error' : 'default'}
              onClick={() => setActiveReport(r)}
            />
          ))}
        </Box>
      )}

      {/* Report content */}
      {activeReport?.status === 'generating' && (
        <Box sx={{ py: 4, textAlign: 'center' }}>
          <CircularProgress size={28} sx={{ mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Analyzing audit logs and generating report…
          </Typography>
          <LinearProgress sx={{ maxWidth: 300, mx: 'auto' }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            This takes 15–30 seconds
          </Typography>
        </Box>
      )}

      {activeReport?.status === 'complete' && activeReport.report_md && (
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip label="Complete" size="small" color="success" />
              {activeReport.period_start && (
                <Chip label={`${activeReport.period_start?.slice(0, 10)} → ${activeReport.period_end?.slice(0, 10)}`} size="small" variant="outlined" />
              )}
            </Box>
            <Tooltip title="Download as Markdown">
              <IconButton size="small" onClick={downloadReport}><DownloadIcon fontSize="small" /></IconButton>
            </Tooltip>
          </Box>
          <Divider sx={{ mb: 2 }} />
          <MarkdownView md={activeReport.report_md} />
        </Paper>
      )}

      {activeReport?.status === 'failed' && (
        <Alert severity="error">Report generation failed. Try again.</Alert>
      )}

      {!activeReport && reports.length === 0 && !generating && (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <ArticleIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No compliance reports generated yet.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Generate a report to get a formal compliance assessment based on this agent's audit trail.
          </Typography>
        </Box>
      )}
    </Box>
  )
}
