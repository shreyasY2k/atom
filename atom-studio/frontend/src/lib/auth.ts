import { create } from 'zustand'
import api from './api'

interface User {
  id: string
  email: string
  full_name: string | null
  role: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  login: (email: string, password: string) => Promise<void>
  refresh: () => Promise<void>
  logout: () => void
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  accessToken: localStorage.getItem('access_token'),

  login: async (email, password) => {
    const { data } = await api.post('/api/auth/login', { email, password })
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('refresh_token', data.refresh_token)
    set({ accessToken: data.access_token })
    const me = await api.get('/api/auth/me')
    set({ user: me.data })
  },

  refresh: async () => {
    const rt = localStorage.getItem('refresh_token')
    if (!rt) throw new Error('no refresh token')
    const { data } = await api.post('/api/auth/refresh', { refresh_token: rt })
    localStorage.setItem('access_token', data.access_token)
    set({ accessToken: data.access_token })
  },

  logout: () => {
    localStorage.clear()
    set({ user: null, accessToken: null })
  },
}))
