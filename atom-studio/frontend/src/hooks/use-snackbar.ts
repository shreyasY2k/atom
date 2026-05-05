import { useState, useCallback } from 'react'

export interface SnackbarState {
  open: boolean
  message: string
  severity: 'success' | 'error' | 'info' | 'warning'
}

export function useSnackbar() {
  const [state, setState] = useState<SnackbarState>({ open: false, message: '', severity: 'info' })
  const show = useCallback((message: string, severity: SnackbarState['severity'] = 'info') => {
    setState({ open: true, message, severity })
  }, [])
  const hide = useCallback(() => setState(s => ({ ...s, open: false })), [])
  return { state, show, hide }
}
