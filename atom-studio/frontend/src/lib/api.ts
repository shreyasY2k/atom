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

api.interceptors.response.use(
  r => r,
  async error => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true
      try {
        await useAuthStore.getState().refresh()
        return api.request(error.config)
      } catch {
        useAuthStore.getState().logout()
      }
    }
    return Promise.reject(error)
  },
)

export default api
