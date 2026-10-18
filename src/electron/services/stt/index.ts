import fs from 'node:fs'
import path from 'node:path'
import type { SttResult, SttSettings } from '@shared/types'
import { logger } from '../logger'
import { transcribeAudio } from '../llm/openaiCompatible'
import { localTranscribe, probeLocalWhisper } from '../audio/ffmpeg'

/**
 * Speech-to-Text Provider 抽象层。
 * 新增引擎只需实现 SpeechProvider 并在此注册。
 */
export interface SpeechProvider {
  readonly id: string
  readonly label: string
  transcribe(audioPath: string, settings: SttSettings): Promise<SttResult>
}

const MIME_BY_EXT: Record<string, string> = {
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.flac': 'audio/flac'
}

export function mimeForFile(file: string): string {
  return MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'audio/webm'
}

/** OpenAI / Groq / 硅基流动 等所有兼容 /audio/transcriptions 的云端服务 */
export class OpenAiCompatibleSpeechProvider implements SpeechProvider {
  readonly id = 'openai-compatible'
  readonly label = '云端 OpenAI 兼容接口'

  async transcribe(audioPath: string, settings: SttSettings): Promise<SttResult> {
    if (!fs.existsSync(audioPath)) {
      return { ok: false, text: '', provider: this.id, error: '录音文件不存在' }
    }
    if (!settings.apiKey || !settings.apiKey.trim()) {
      return {
        ok: false,
        text: '',
        provider: this.id,
        error: '尚未配置语音转文字 API Key，请到「设置 → 语音转文字」填写。录音已安全保存，可稍后重新评分。'
      }
    }
    if (!settings.baseUrl || !settings.baseUrl.trim()) {
      return { ok: false, text: '', provider: this.id, error: '尚未配置 STT Base URL' }
    }
    const started = Date.now()
    const buf = fs.readFileSync(audioPath)
    const res = await transcribeAudio({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model || 'whisper-1',
      language: settings.language || undefined,
      audio: buf,
      fileName: path.basename(audioPath),
      mimeType: mimeForFile(audioPath)
    })
    if (!res.ok) {
      return { ok: false, text: '', provider: this.id, model: settings.model, error: res.error }
    }
    return {
      ok: true,
      text: res.text,
      provider: this.id,
      model: settings.model,
      durationMs: Date.now() - started
    }
  }
}

/** 本地 whisper.cpp / openai-whisper，完全离线 */
export class LocalWhisperSpeechProvider implements SpeechProvider {
  readonly id = 'local-whisper'
  readonly label = '本地 Whisper（离线）'

  async transcribe(audioPath: string, settings: SttSettings): Promise<SttResult> {
    if (!fs.existsSync(audioPath)) {
      return { ok: false, text: '', provider: this.id, error: '录音文件不存在' }
    }
    const res = await localTranscribe({
      audioPath,
      binaryPath: settings.localBinaryPath,
      modelPath: settings.localModelPath,
      language: settings.language || 'en'
    })
    if (!res.ok) return { ok: false, text: '', provider: this.id, error: res.error }
    return { ok: true, text: res.text, provider: this.id, model: res.engine }
  }
}

/** 用户选择「不转写」 */
export class NoopSpeechProvider implements SpeechProvider {
  readonly id = 'none'
  readonly label = '不进行语音转写'
  async transcribe(): Promise<SttResult> {
    return { ok: false, text: '', provider: 'none', error: '未启用语音转文字' }
  }
}

const providers: SpeechProvider[] = [
  new OpenAiCompatibleSpeechProvider(),
  new LocalWhisperSpeechProvider(),
  new NoopSpeechProvider()
]

export function getSpeechProvider(id: string): SpeechProvider {
  return providers.find((p) => p.id === id) ?? providers[0]
}

export function listSpeechProviders(): { id: string; label: string }[] {
  return providers.map((p) => ({ id: p.id, label: p.label }))
}

export async function transcribeWithSettings(
  audioPath: string,
  settings: SttSettings
): Promise<SttResult> {
  const provider = getSpeechProvider(settings.provider)
  logger.info(`STT 使用 Provider: ${provider.id}，文件: ${path.basename(audioPath)}`)
  try {
    return await provider.transcribe(audioPath, settings)
  } catch (e) {
    logger.error('STT 异常', e)
    return { ok: false, text: '', provider: provider.id, error: `语音转写异常：${(e as Error).message}` }
  }
}

/** 设置页诊断 */
export function diagnoseStt(settings: SttSettings): {
  ok: boolean
  message: string
  detail?: string
} {
  if (settings.provider === 'none') {
    return { ok: false, message: '当前已关闭语音转文字，考试结束后不会生成文字稿。' }
  }
  if (settings.provider === 'local-whisper') {
    const probe = probeLocalWhisper(settings.localBinaryPath, settings.localModelPath)
    return {
      ok: probe.available && !!probe.ffmpeg,
      message: probe.available
        ? probe.ffmpeg
          ? `本地引擎可用（${probe.kind}）：${probe.detail}`
          : '已找到 whisper，但缺少 ffmpeg'
        : probe.detail,
      detail: probe.binary ?? undefined
    }
  }
  if (!settings.apiKey?.trim()) {
    return { ok: false, message: '尚未配置云端 STT API Key。录音仍会保存，可稍后重新转写评分。' }
  }
  if (!settings.baseUrl?.trim()) {
    return { ok: false, message: '尚未配置 STT Base URL' }
  }
  return { ok: true, message: `已配置云端 STT：${settings.model || 'whisper-1'}` }
}
