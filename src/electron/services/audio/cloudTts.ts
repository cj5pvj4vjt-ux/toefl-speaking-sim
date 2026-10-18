import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../logger'

/**
 * 云端语音合成（OpenAI 兼容 /audio/speech）。
 *
 * 为什么要走云端：macOS 自带的 `say` 只有 Samantha 这类老式拼接音，
 * 用作托福听力材料太机械，会明显干扰「听 → 复述」的考查意图。
 * 换成云端 TTS 后是神经网络音色，接近真人朗读。
 *
 * 兼容两种返回：
 *  1. 直接返回音频字节（OpenAI 标准行为）
 *  2. 返回 JSON，里面带一个可下载的音频 URL（DashScope 系模型如 qwen3-tts-flash）
 */

export interface CloudTtsRequest {
  text: string
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  speed?: number
  timeoutMs?: number
}

export interface CloudTtsResult {
  ok: boolean
  /** 音频字节（WAV / MP3 原始数据） */
  data?: Buffer
  mimeType?: string
  error?: string
}

function joinUrl(baseUrl: string, suffix: string): string {
  const base = (baseUrl || '').trim().replace(/\/+$/, '')
  if (base.endsWith(suffix)) return base
  return `${base}${suffix}`
}

function looksLikeAudio(contentType: string, buf: Buffer): boolean {
  if (/audio|octet-stream|mpeg|wav|ogg/i.test(contentType)) return true
  // RIFF(WAV) / ID3、0xFFFB(MP3) / OggS / fLaC
  const head = buf.subarray(0, 4)
  if (head.toString('latin1') === 'RIFF') return true
  if (head.toString('latin1') === 'OggS') return true
  if (head.toString('latin1') === 'fLaC') return true
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true
  if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return true
  return false
}

/** 从 DashScope 风格的 JSON 里挖出音频 URL */
function findAudioUrl(value: unknown, depth = 0): string | null {
  if (depth > 5 || value == null) return null
  if (typeof value === 'string') {
    return /^https?:\/\//.test(value) && /\.(wav|mp3|ogg|m4a|aac)(\?|$)/i.test(value) ? value : null
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findAudioUrl(v, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // 优先找名字里带 audio / url 的字段，避免误抓无关链接
    for (const k of Object.keys(obj)) {
      if (/url|audio|file|link/i.test(k)) {
        const hit = findAudioUrl(obj[k], depth + 1)
        if (hit) return hit
      }
    }
    for (const k of Object.keys(obj)) {
      const hit = findAudioUrl(obj[k], depth + 1)
      if (hit) return hit
    }
  }
  return null
}

export async function synthesizeCloudTts(req: CloudTtsRequest): Promise<CloudTtsResult> {
  const text = (req.text ?? '').trim()
  if (!text) return { ok: false, error: '文本为空' }
  if (!req.baseUrl) return { ok: false, error: '云端语音合成缺少服务地址' }
  if (!req.apiKey) return { ok: false, error: '云端语音合成缺少 API Key' }
  if (!req.model) return { ok: false, error: '云端语音合成缺少模型名' }

  const endpoint = joinUrl(req.baseUrl, '/audio/speech')
  const timeout = req.timeoutMs ?? 60_000
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${req.apiKey}` },
      body: JSON.stringify({
        model: req.model,
        input: text,
        voice: req.voice,
        response_format: 'wav',
        speed: req.speed ?? 1
      }),
      signal: ctrl.signal
    })

    const contentType = res.headers.get('content-type') ?? ''
    const buf = Buffer.from(await res.arrayBuffer())

    if (!res.ok) {
      const msg = buf.toString('utf8').replace(/\s+/g, ' ').slice(0, 240)
      return { ok: false, error: `语音合成失败（HTTP ${res.status}）：${msg}` }
    }

    if (looksLikeAudio(contentType, buf)) {
      return { ok: true, data: buf, mimeType: contentType || 'audio/wav' }
    }

    // JSON 形态：再下载一次音频
    let json: unknown = null
    try {
      json = JSON.parse(buf.toString('utf8'))
    } catch {
      return { ok: false, error: `语音合成返回了无法识别的内容：${buf.toString('utf8').slice(0, 200)}` }
    }
    const url = findAudioUrl(json)
    if (!url) {
      return { ok: false, error: `语音合成没有返回音频：${JSON.stringify(json).slice(0, 200)}` }
    }

    const audioRes = await fetch(url, { signal: ctrl.signal })
    if (!audioRes.ok) return { ok: false, error: `下载合成音频失败（HTTP ${audioRes.status}）` }
    const audioBuf = Buffer.from(await audioRes.arrayBuffer())
    if (audioBuf.length <= 44) return { ok: false, error: '下载到的合成音频为空' }
    return {
      ok: true,
      data: audioBuf,
      mimeType: audioRes.headers.get('content-type') ?? 'audio/wav'
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    logger.error('云端语音合成失败：', msg)
    return { ok: false, error: msg.includes('abort') ? '语音合成超时' : msg }
  } finally {
    clearTimeout(timer)
  }
}

/** 把合成结果落到缓存目录，返回可播放的文件路径 */
export function writeAudioToCache(dir: string, key: string, data: Buffer, mimeType: string): string {
  fs.mkdirSync(dir, { recursive: true })
  const ext = /mpeg|mp3/i.test(mimeType)
    ? 'mp3'
    : data.subarray(0, 4).toString('latin1') === 'RIFF'
      ? 'wav'
      : 'wav'
  const file = path.join(dir, `${key}.${ext}`)
  fs.writeFileSync(file, data)
  return file
}
