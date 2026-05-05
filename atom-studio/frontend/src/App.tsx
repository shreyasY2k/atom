import {
  createRouter,
  createRoute,
  createRootRoute,
  RouterProvider,
  Outlet,
  Navigate,
} from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/toaster'
import { RequireAuth } from '@/components/app/RequireAuth'
import { Layout } from '@/components/app/Layout'
import { Login } from '@/pages/Login'
import { Domains } from '@/pages/Domains'
import { Agents } from '@/pages/Agents'
import { AgentBuilderChat } from '@/pages/AgentBuilderChat'
import { AgentDetail } from '@/pages/AgentDetail'
import { AgentConversations } from '@/pages/AgentConversations'
import { AgentLogs } from '@/pages/AgentLogs'
import { Audit } from '@/pages/Audit'
import { HitlQueue } from '@/pages/HitlQueue'
import { ToolsSkills } from '@/pages/ToolsSkills'
import { AgentBuilder } from '@/pages/AgentBuilder'

const queryClient = new QueryClient()

const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  ),
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <Navigate to="/domains" />,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
})

const domainsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains',
  component: () => (
    <RequireAuth>
      <Layout>
        <Domains />
      </Layout>
    </RequireAuth>
  ),
})

const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: () => (
    <RequireAuth>
      <Layout>
        <Agents />
      </Layout>
    </RequireAuth>
  ),
})

const agentNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/new',
  component: () => (
    <RequireAuth>
      <Layout>
        <AgentBuilderChat />
      </Layout>
    </RequireAuth>
  ),
})

const agentBuildRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/build',
  component: () => (
    <RequireAuth>
      <Layout>
        <AgentBuilder />
      </Layout>
    </RequireAuth>
  ),
})

const toolsSkillsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tools-skills',
  component: () => (
    <RequireAuth>
      <Layout>
        <ToolsSkills />
      </Layout>
    </RequireAuth>
  ),
})

const agentDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains/$domainId/agents/$agentId',
  component: function AgentDetailPage() {
    const { domainId, agentId } = agentDetailRoute.useParams()
    return (
      <RequireAuth>
        <Layout>
          <AgentDetail domainId={domainId} agentId={agentId} />
        </Layout>
      </RequireAuth>
    )
  },
})

const hitlRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/hitl',
  component: () => (
    <RequireAuth>
      <Layout>
        <HitlQueue />
      </Layout>
    </RequireAuth>
  ),
})

const agentLogsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains/$domainId/agents/$agentId/logs',
  component: function AgentLogsPage() {
    const { domainId, agentId } = agentLogsRoute.useParams()
    return (
      <RequireAuth>
        <Layout>
          <AgentLogs domainId={domainId} agentId={agentId} />
        </Layout>
      </RequireAuth>
    )
  },
})

const agentConversationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/domains/$domainId/agents/$agentId/conversations',
  component: function AgentConversationsPage() {
    const { domainId, agentId } = agentConversationsRoute.useParams()
    return (
      <RequireAuth>
        <Layout>
          <AgentConversations domainId={domainId} agentId={agentId} />
        </Layout>
      </RequireAuth>
    )
  },
})

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: () => (
    <RequireAuth>
      <Layout>
        <Audit />
      </Layout>
    </RequireAuth>
  ),
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  domainsRoute,
  agentsRoute,
  agentNewRoute,
  agentBuildRoute,
  toolsSkillsRoute,
  agentDetailRoute,
  agentLogsRoute,
  agentConversationsRoute,
  auditRoute,
  hitlRoute,
])

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

export default function App() {
  return <RouterProvider router={router} />
}
