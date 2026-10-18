import { create } from 'zustand'
import type { AppInfo, PipelineProgressEvent } from '@shared/types/ipc'
import { api, errorMessage } from '../lib/api'

export type Route =
  | { name: 'dashboard' }
  | { name: 'library' }
  | { name: 'library-detail'; setId: string }
  | { name: 'import' }
  | { name: 'setup' }
  | { name: 'exam' }
  | { name: 'processing'; examId: string }
  | { name: 'report'; examId: string }
  | { name: 'history' }
  | { name: 'settings' }

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info' | 'warn'
  title: string
  detail?: string
  ttl?: number
}

interface AppState {
  route: Route
  routeHistory: Route[]
  appInfo: AppInfo | null
  toasts: Toast[]
  bootError: string | null
  pipeline: PipelineProgressEvent | null
  navigate: (r: Route) => void
  back: () => void
  loadAppInfo: () => Promise<void>
  toast: (t: Omit<Toast, 'id'>) => string
  dismiss: (id: string) => void
  setPipeline: (p: PipelineProgressEvent | null) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  route: { name: 'dashboard' },
  routeHistory: [],
  appInfo: null,
  toasts: [],
  bootError: null,
  pipeline: null,

  navigate: (r) => {
    const cur = get().route
    set({ route: r, routeHistory: [...get().routeHistory, cur].slice(-20) })
  },

  back: () => {
    const hist = get().routeHistory
    if (hist.length === 0) return
    const prev = hist[hist.length - 1]
    set({ route: prev, routeHistory: hist.slice(0, -1) })
  },

  loadAppInfo: async () => {
    try {
      const info = await api.getAppInfo()
      set({ appInfo: info, bootError: null })
    } catch (e) {
      set({ bootError: errorMessage(e) })
    }
  },

  toast: (t) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const toast: Toast = { ttl: 5200, ...t, id }
    set({ toasts: [...get().toasts, toast] })
    if (toast.kind !== 'error') {
      window.setTimeout(() => get().dismiss(id), toast.ttl)
    }
    return id
  },

  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  setPipeline: (p) => set({ pipeline: p })
}))
