import { create } from 'zustand'
import type { SafeAppSettings } from '@shared/types'
import type { SettingsPatch } from '@shared/types/ipc'
import { api, errorMessage } from '../lib/api'

interface SettingsState {
  settings: SafeAppSettings | null
  loading: boolean
  saving: boolean
  error: string | null
  load: () => Promise<void>
  save: (patch: SettingsPatch) => Promise<boolean>
  setApiKey: (which: 'llm' | 'stt' | 'tts', key: string) => Promise<boolean>
  clearApiKey: (which: 'llm' | 'stt' | 'tts') => Promise<boolean>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: null,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    set({ loading: true })
    try {
      const s = await api.settings.get()
      set({ settings: s, error: null })
    } catch (e) {
      set({ error: errorMessage(e) })
    } finally {
      set({ loading: false })
    }
  },

  save: async (patch) => {
    set({ saving: true })
    try {
      const s = await api.settings.save(patch)
      set({ settings: s, error: null })
      return true
    } catch (e) {
      set({ error: errorMessage(e) })
      return false
    } finally {
      set({ saving: false })
    }
  },

  setApiKey: async (which, key) => {
    set({ saving: true })
    try {
      const s = await api.settings.setApiKey(which, key)
      set({ settings: s, error: null })
      return true
    } catch (e) {
      set({ error: errorMessage(e) })
      return false
    } finally {
      set({ saving: false })
    }
  },

  clearApiKey: async (which) => {
    set({ saving: true })
    try {
      const s = await api.settings.clearApiKey(which)
      set({ settings: s, error: null })
      return true
    } catch (e) {
      set({ error: errorMessage(e) })
      return false
    } finally {
      set({ saving: false })
    }
  }
}))

export function isConfigured(s: SafeAppSettings | null): {
  llmReady: boolean
  sttReady: boolean
  detail: string
} {
  if (!s) return { llmReady: false, sttReady: false, detail: '正在读取设置…' }
  const llmReady = !!s.llm.apiKeySet && !!s.llm.model && !!s.llm.baseUrl
  const sttReady = s.stt.provider === 'local-whisper' ? true : !!s.stt.apiKeySet
  const missing: string[] = []
  if (!s.llm.apiKeySet) missing.push('AI 评分 API Key')
  if (!s.llm.model) missing.push('评分模型')
  if (!sttReady) missing.push('语音转文字（STT）')
  return {
    llmReady,
    sttReady,
    detail: missing.length ? `尚未配置：${missing.join('、')}` : '已就绪'
  }
}
