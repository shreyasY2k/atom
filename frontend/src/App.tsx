import React, { createContext, useMemo, useState } from 'react'
import { BrowserRouter, Route, Routes, Navigate, useParams } from 'react-router-dom'
import { ThemeProvider, CssBaseline } from '@mui/material'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { getTheme } from './theme'
import Layout from './components/Layout'
import Home from './pages/Home'
import Builder from './pages/agents/Builder'
import AgentList from './pages/agents/List'
import Composer from './pages/workflows/Composer'
import ComposerLanding from './pages/workflows/ComposerLanding'
import WorkflowList from './pages/workflows/List'
import WorkflowRuns from './pages/workflows/Runs'
import Chat from './pages/chat/Chat'
import Tasks from './pages/tasks/Tasks'
import AuditEvents from './pages/audit/Events'
import Identities from './pages/audit/Identities'

export const ColorModeContext = createContext({ toggle: () => {} })

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
})

function ComposerParam() {
  const { name } = useParams<{ name: string }>()
  return <Composer workflowName={name ?? ''} />
}

export default function App() {
  const [mode, setMode] = useState<'light' | 'dark'>(() =>
    (localStorage.getItem('colorMode') as 'light' | 'dark') || 'light'
  )
  const colorMode = useMemo(() => ({
    toggle: () => setMode(m => {
      const next = m === 'light' ? 'dark' : 'light'
      localStorage.setItem('colorMode', next)
      return next
    }),
  }), [])
  const theme = useMemo(() => getTheme(mode), [mode])

  return (
    <ColorModeContext.Provider value={colorMode}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="agents/build" element={<Builder />} />
                <Route path="agents" element={<AgentList />} />
                <Route path="workflows/compose" element={<ComposerLanding />} />
                <Route path="workflows/compose/:name" element={<ComposerParam />} />
                <Route path="workflows/runs" element={<WorkflowRuns />} />
                <Route path="workflows" element={<WorkflowList />} />
                <Route path="chat" element={<Chat />} />
                <Route path="tasks" element={<Tasks />} />
                <Route path="audit" element={<AuditEvents />} />
                <Route path="audit/identities" element={<Identities />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </ColorModeContext.Provider>
  )
}
