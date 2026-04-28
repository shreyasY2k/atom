import * as React from 'react'
import type * as ToastPrimitives from '@radix-ui/react-toast'

const TOAST_LIMIT = 5
const TOAST_REMOVE_DELAY = 4000

type ToastVariant = 'default' | 'destructive'

type ToasterToast = {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  open: boolean
}

let count = 0
function genId() {
  count = (count + 1) % Number.MAX_SAFE_INTEGER
  return count.toString()
}

type Action =
  | { type: 'ADD_TOAST'; toast: ToasterToast }
  | { type: 'UPDATE_TOAST'; toast: Partial<ToasterToast> & Pick<ToasterToast, 'id'> }
  | { type: 'DISMISS_TOAST'; toastId?: string }
  | { type: 'REMOVE_TOAST'; toastId?: string }

interface State {
  toasts: ToasterToast[]
}

const toastTimeouts = new Map<string, ReturnType<typeof setTimeout>>()

function addToRemoveQueue(toastId: string, dispatch: React.Dispatch<Action>) {
  if (toastTimeouts.has(toastId)) return
  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId)
    dispatch({ type: 'REMOVE_TOAST', toastId })
  }, TOAST_REMOVE_DELAY)
  toastTimeouts.set(toastId, timeout)
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_TOAST':
      return { toasts: [action.toast, ...state.toasts].slice(0, TOAST_LIMIT) }
    case 'UPDATE_TOAST':
      return {
        toasts: state.toasts.map(t => (t.id === action.toast.id ? { ...t, ...action.toast } : t)),
      }
    case 'DISMISS_TOAST': {
      const { toastId } = action
      return {
        toasts: state.toasts.map(t =>
          t.id === toastId || toastId === undefined ? { ...t, open: false } : t,
        ),
      }
    }
    case 'REMOVE_TOAST':
      return {
        toasts:
          action.toastId === undefined
            ? []
            : state.toasts.filter(t => t.id !== action.toastId),
      }
  }
}

const listeners: Array<React.Dispatch<Action>> = []
let memoryState: State = { toasts: [] }

function dispatch(action: Action) {
  memoryState = reducer(memoryState, action)
  listeners.forEach(l => l(action))
}

type Toast = Omit<ToasterToast, 'id' | 'open'>

function toast(props: Toast) {
  const id = genId()
  dispatch({ type: 'ADD_TOAST', toast: { ...props, id, open: true } })
  return id
}

function useToast() {
  const [state, setState] = React.useState<State>(memoryState)

  React.useEffect(() => {
    const listener: React.Dispatch<Action> = () => {
      setState({ ...memoryState })
    }
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index > -1) listeners.splice(index, 1)
    }
  }, [])

  return {
    toasts: state.toasts,
    toast,
    dismiss: (toastId?: string) => {
      dispatch({ type: 'DISMISS_TOAST', toastId })
      if (toastId) addToRemoveQueue(toastId, dispatch)
    },
  }
}

export { useToast, toast }
export type { ToasterToast, ToastPrimitives }
