import { Navigate } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth'

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.accessToken)
  if (!token) return <Navigate to="/login" />
  return <>{children}</>
}
