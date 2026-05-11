import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

type Role = 'builder' | 'approver' | 'platform_admin' | null

export interface AuthState {
  role: Role
  identity: string
  displayName: string
}

interface AuthContextType extends AuthState {
  login: (role: string) => Promise<void>
  logout: () => Promise<void>
  ready: boolean
}

const STORAGE_KEY = 'atom_auth'
const AUTH_BASE = 'http://localhost:8080'

const EMPTY: AuthState = { role: null, identity: '', displayName: '' }

export const AuthContext = createContext<AuthContextType>({
  ...EMPTY,
  login: async () => {},
  logout: async () => {},
  ready: false,
})

export function useAuth() {
  return useContext(AuthContext)
}

/** Read the current actor identity for X-Atom-Actor header without React context. */
export function getActorHeader(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const s = JSON.parse(raw) as AuthState
      if (s.identity) return s.identity
    }
  } catch {}
  return 'user:builder@atom.io'
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(EMPTY)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      try {
        const s = JSON.parse(raw) as AuthState
        if (s.role) { setAuth(s); setReady(true); return }
      } catch {}
    }
    // No credentials: 'include' — wildcard CORS and localStorage are primary auth store.
    fetch(`${AUTH_BASE}/auth/me`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.role) {
          const s: AuthState = { role: data.role, identity: data.identity, displayName: data.display_name }
          setAuth(s)
          localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
        }
      })
      .catch(() => {})
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (role: string) => {
    const r = await fetch(`${AUTH_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (!r.ok) throw new Error('Login failed')
    const data = await r.json()
    const s: AuthState = { role: data.role, identity: data.identity, displayName: data.display_name }
    setAuth(s)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  }, [])

  const logout = useCallback(async () => {
    await fetch(`${AUTH_BASE}/auth/logout`, { method: 'POST' }).catch(() => {})
    setAuth(EMPTY)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  return (
    <AuthContext.Provider value={{ ...auth, login, logout, ready }}>
      {children}
    </AuthContext.Provider>
  )
}
