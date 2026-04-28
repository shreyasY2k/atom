import { create } from 'zustand'

export interface HitlItem {
  id: string
  agent_id: string
  agent_name: string
  workflow_type: 'BUSINESS_DECISION' | 'DEPLOYMENT_APPROVAL'
  payload: Record<string, unknown>
  status: 'pending' | 'approved' | 'rejected' | 'timed_out'
  expires_at: string | null
  created_at: string
  decision_note: string | null
  decided_by: string | null
  decided_at: string | null
}

interface HitlStore {
  items: HitlItem[]
  setItems: (items: HitlItem[]) => void
  addItem: (item: HitlItem) => void
  resolveItem: (hitl_id: string, approved: boolean, note: string | null) => void
  expireItem: (hitl_id: string) => void
}

export const useHitlStore = create<HitlStore>(set => ({
  items: [],
  setItems: items => set({ items }),
  addItem: item =>
    set(s => ({
      items: s.items.some(i => i.id === item.id) ? s.items : [item, ...s.items],
    })),
  resolveItem: (hitl_id, approved, note) =>
    set(s => ({
      items: s.items.map(i =>
        i.id === hitl_id
          ? { ...i, status: approved ? 'approved' : 'rejected', decision_note: note }
          : i,
      ),
    })),
  expireItem: hitl_id =>
    set(s => ({
      items: s.items.map(i =>
        i.id === hitl_id ? { ...i, status: 'timed_out' } : i,
      ),
    })),
}))

export const usePendingCount = () =>
  useHitlStore(s => s.items.filter(i => i.status === 'pending').length)
