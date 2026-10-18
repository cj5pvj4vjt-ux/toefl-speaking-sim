import { safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { AppSettingsSchema } from '@shared/schemas'
import type { AppSettings, SafeAppSettings } from '@shared/types'
import { getSettingsPath } from './paths'
import { logger } from './logger'

/**
 * 设置持久化。
 * API Key 使用 Electron safeStorage（macOS Keychain 支持）加密后落盘；
 * 渲染进程永远拿不到明文，只拿到 apiKeySet / 掩码预览。
 * 明文密钥绝不写入 localStorage / 源码 / 日志。
 */

interface PersistedSettings {
  version: number
  llm: Omit<AppSettings['llm'], 'apiKey'>
  stt: Omit<AppSettings['stt'], 'apiKey'>
  tts: Omit<AppSettings['tts'], 'apiKey'>
  microphone: AppSettings['microphone']
  exam: AppSettings['exam']
  llmApiKeyEnc?: string
  sttApiKeyEnc?: string
  ttsApiKeyEnc?: string
}

const VERSION = 1

let cache: AppSettings | null = null

function defaults(): AppSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings
}

function encryptSecret(plain: string): string | undefined {
  if (!plain) return undefined
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc1:' + safeStorage.encryptString(plain).toString('base64')
    }
  } catch (e) {
    logger.warn('safeStorage 加密失败，降级为本地混淆存储', e)
  }
  // 系统不支持时进行本地混淆（不是安全加密），仅作为兜底
  return 'obf1:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decryptSecret(stored: string | undefined): string {
  if (!stored) return ''
  try {
    if (stored.startsWith('enc1:')) {
      const buf = Buffer.from(stored.slice(5), 'base64')
      return safeStorage.decryptString(buf)
    }
    if (stored.startsWith('obf1:')) {
      return Buffer.from(stored.slice(5), 'base64').toString('utf8')
    }
  } catch (e) {
    logger.error('无法解密已保存的密钥（可能更换了系统钥匙串）', e)
    return ''
  }
  return ''
}

export function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  const base = defaults()
  const file = getSettingsPath()
  try {
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as PersistedSettings
      const parsed = AppSettingsSchema.partial().safeParse({
        llm: { ...base.llm, ...raw.llm, apiKey: decryptSecret(raw.llmApiKeyEnc) },
        stt: { ...base.stt, ...raw.stt, apiKey: decryptSecret(raw.sttApiKeyEnc) },
        tts: { ...base.tts, ...raw.tts, apiKey: decryptSecret(raw.ttsApiKeyEnc) },
        microphone: { ...base.microphone, ...raw.microphone },
        exam: { ...base.exam, ...raw.exam }
      })
      if (parsed.success) {
        cache = { ...base, ...parsed.data } as AppSettings
        return cache
      }
      logger.warn('settings.json 校验失败，使用默认设置', parsed.error.message)
    }
  } catch (e) {
    logger.error('读取设置失败，使用默认设置', e)
  }
  cache = base
  return cache
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const merged: AppSettings = {
    llm: { ...current.llm, ...(patch.llm ?? {}) },
    stt: { ...current.stt, ...(patch.stt ?? {}) },
    tts: { ...current.tts, ...(patch.tts ?? {}) },
    microphone: { ...current.microphone, ...(patch.microphone ?? {}) },
    exam: { ...current.exam, ...(patch.exam ?? {}) }
  }
  const validated = AppSettingsSchema.parse(merged)
  cache = validated

  const { apiKey: llmKey, ...llmRest } = validated.llm
  const { apiKey: sttKey, ...sttRest } = validated.stt
  const { apiKey: ttsKey, ...ttsRest } = validated.tts
  const persisted: PersistedSettings = {
    version: VERSION,
    llm: llmRest,
    stt: sttRest,
    tts: ttsRest,
    microphone: validated.microphone,
    exam: validated.exam,
    llmApiKeyEnc: encryptSecret(llmKey),
    sttApiKeyEnc: encryptSecret(sttKey),
    ttsApiKeyEnc: encryptSecret(ttsKey)
  }

  const file = getSettingsPath()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(persisted, null, 2), { encoding: 'utf8', mode: 0o600 })
  } catch (e) {
    logger.error('保存设置失败', e)
  }
  return validated
}

function mask(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}••••••${key.slice(-4)}`
}

export function getSafeSettings(): SafeAppSettings {
  const s = loadSettings()
  return {
    llm: {
      provider: s.llm.provider,
      baseUrl: s.llm.baseUrl,
      model: s.llm.model,
      temperature: s.llm.temperature,
      useJsonSchema: s.llm.useJsonSchema,
      apiKeySet: !!s.llm.apiKey,
      apiKeyPreview: mask(s.llm.apiKey)
    },
    stt: {
      provider: s.stt.provider,
      baseUrl: s.stt.baseUrl,
      model: s.stt.model,
      language: s.stt.language,
      localBinaryPath: s.stt.localBinaryPath,
      localModelPath: s.stt.localModelPath,
      apiKeySet: !!s.stt.apiKey,
      apiKeyPreview: mask(s.stt.apiKey)
    },
    tts: {
      provider: s.tts.provider,
      baseUrl: s.tts.baseUrl,
      model: s.tts.model,
      voice: s.tts.voice,
      systemVoice: s.tts.systemVoice,
      speed: s.tts.speed,
      apiKeySet: !!s.tts.apiKey,
      apiKeyPreview: mask(s.tts.apiKey)
    },
    microphone: s.microphone,
    exam: s.exam,
    dataDir: ''
  }
}

/** 仅主进程内部使用 */
export function getRawSettings(): AppSettings {
  return loadSettings()
}

export function clearCache(): void {
  cache = null
}
