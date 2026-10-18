import { create } from 'zustand'
import type { Question, QuestionSet } from '@shared/types'
import { api, errorMessage } from '../lib/api'

interface LibraryState {
  sets: QuestionSet[]
  loading: boolean
  error: string | null
  load: () => Promise<void>
  get: (id: string) => Promise<QuestionSet | null>
  save: (set: QuestionSet) => Promise<QuestionSet | null>
  remove: (id: string) => Promise<void>
  updateQuestion: (setId: string, q: Question) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  sets: [],
  loading: false,
  error: null,

  load: async () => {
    set({ loading: true })
    try {
      const sets = await api.questionSets.list()
      set({ sets, error: null })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ loading: false })
    }
  },

  get: async (id) => {
    try {
      return await api.questionSets.get(id)
    } catch (e) {
      set({ error: errorMessage(e) })
      return null
    }
  },

  save: async (qs) => {
    try {
      const saved = await api.questionSets.save(qs)
      await get().load()
      return saved
    } catch (e) {
      set({ error: errorMessage(e) })
      return null
    }
  },

  remove: async (id) => {
    try {
      await api.questionSets.delete(id)
      set({ sets: get().sets.filter((s) => s.id !== id) })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  },

  updateQuestion: async (setId, q) => {
    try {
      const updated = await api.questionSets.updateQuestion(setId, q)
      if (updated) set({ sets: get().sets.map((s) => (s.id === updated.id ? { ...s, questions: updated.questions } : s)) })
    } catch (e) {
      set({ error: errorMessage(e) })
    }
  }
}))
