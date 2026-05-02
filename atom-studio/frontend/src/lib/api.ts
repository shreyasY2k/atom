import axios from 'axios'
import { useAuthStore } from './auth'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? '',
})

api.interceptors.request.use(config => {
  const token = useAuthStore.getState().accessToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Queue of callers waiting for a token refresh to complete.
let isRefreshing = false
let pendingQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

function flushQueue(err: unknown, token: string | null) {
  pendingQueue.forEach(p => (err ? p.reject(err) : p.resolve(token!)))
  pendingQueue = []
}

api.interceptors.response.use(
  r => r,
  async error => {
    const original = error.config

    // Only intercept 401s that haven't been retried, and never retry the
    // refresh endpoint itself (that would loop forever).
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/api/auth/refresh')
    ) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      // Another request already started a refresh — wait for it to finish.
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve: resolve as (t: string) => void, reject })
      }).then(token => {
        original.headers.Authorization = `Bearer ${token}`
        return api(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      await useAuthStore.getState().refresh()
      const newToken = useAuthStore.getState().accessToken!
      flushQueue(null, newToken)
      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch (refreshErr) {
      flushQueue(refreshErr, null)
      useAuthStore.getState().logout()
      window.location.href = '/login'
      return Promise.reject(refreshErr)
    } finally {
      isRefreshing = false
    }
  },
)

export default api
