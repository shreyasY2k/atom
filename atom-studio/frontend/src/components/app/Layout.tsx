import { Link, useRouterState } from '@tanstack/react-router'
import { Globe, Bot, UserCheck, BookOpen, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/lib/auth'
import { usePendingCount } from '@/lib/hitlStore'

const navItems = [
  { label: 'Domains', href: '/domains', icon: Globe, enabled: true },
  { label: 'Agents', href: '/agents', icon: Bot, enabled: true },
  { label: 'HITL Queue', href: '/hitl', icon: UserCheck, enabled: true },
  { label: 'Audit Log', href: '/audit', icon: BookOpen, enabled: false },
]

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuthStore()
  const router = useRouterState()
  const currentPath = router.location.pathname
  const pendingCount = usePendingCount()

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-56 border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-bold tracking-tight">ATOM Studio</h1>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map(item => {
            const Icon = item.icon
            const active = currentPath.startsWith(item.href)
            const isHitl = item.href === '/hitl'
            return (
              <div key={item.href}>
                {item.enabled ? (
                  <Link
                    to={item.href}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                    {isHitl && pendingCount > 0 && (
                      <Badge className="ml-auto h-5 min-w-5 flex items-center justify-center p-0 text-xs">
                        {pendingCount}
                      </Badge>
                    )}
                  </Link>
                ) : (
                  <span className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40 cursor-not-allowed select-none">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b flex items-center justify-between px-6">
          <div />
          <div className="flex items-center gap-3">
            {user && (
              <>
                <span className="text-sm font-medium">{user.full_name ?? user.email}</span>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {user.role}
                </Badge>
              </>
            )}
            <Button variant="ghost" size="icon" onClick={logout} title="Logout">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  )
}
