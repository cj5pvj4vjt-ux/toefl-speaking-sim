import { create } from 'zustand'
import type { DashboardStats, ExamAttempt } from '@shared/types'
import { api, errorMessage } from '../lib/api'

interface HistoryState {
  attempts: ExamAttempt[]
  dashboard: DashboardStats | null
  loading: boolean
  error: string | null
  load: (limit?: number) => Promise<void>
  loadDashboard: () => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  exportReport: (id: string) => Promise<{ ok: boolean; filePath?: string; error?: string }>
  get: (id: string) => Promise<ExamAttempt | null>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  attempts: [],
  dashboard: null,
  loading: false,
  error: null,

  load: async (limit = 200) => {
    set({ loading: true })
    try {
      const attempts = await api.exams.list(limit)
      set({ attempts, error: null })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ loading: false })
    }
  },

  loadDashboard: async () => {
    try {
      const dashboard = await api.exams.dashboard()
      set({ dashboard, error: null })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  remove: async (id) => {
    await api.exams.delete(id)
    set({ attempts: get().attempts.filter((a) => a.id !== id) })
    await get().loadDashboard()
  },

  clearAll: async () => {
    await api.exams.clearAll()
    set({ attempts: [] })
    await get().loadDashboard()
  },

  exportReport: async (id) => {
    try {
      return await api.report.export(id)
    } catch (e) {
      return { ok: false, error: errorMessage(e) }
    }
  },

  get: async (id) => {
    try {
      return await api.exams.get(id)
    } catch (e) {
      set({ error: errorMessage(e) })
      return null
    }
  }
}))
