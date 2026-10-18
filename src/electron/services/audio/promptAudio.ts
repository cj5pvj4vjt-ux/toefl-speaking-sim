import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { logger } from '../logger'
import { getRawSettings } from '../settingsStore'
import { synthesizeCloudTts, writeAudioToCache } from './cloudTts'

/**
 * 题目音频合成（听后重复题必须让考生「听」到句子）。
 *
 * 两种音源，按设置里的 tts.provider 选择：
 *  - cloud ：云端 TTS，神经网络音色，最接近真人朗读（默认）。
 *  - system：macOS 自带 `say`，完全离线；作为云端不可用时的兜底。
 *
 * 结果按「音源 + 文本 + 音色 + 语速」的哈希缓存到 userData/prompt-audio，
 * 同一句只合成一次，第二次开始零延迟。
 * 任何一步失败都返回 ok:false，渲染层会退化成「显示文本」，不会把考试卡死。
 */

const CACHE_DIR_NAME = 'prompt-audio'

/** 官方音频只播一遍，语速贴近真实考试 */
const DEFAULT_VOICE = 'Samantha'
const DEFAULT_RATE = 165

export interface PromptAudioRequest {
  text: string
  voice?: string
  rate?: number
  /** 只播一遍的规则下，同一句不同题号也要各自缓存 —— 一般不需要传 */
  salt?: string
}

export interface PromptAudioResult {
  ok: boolean
  /** 合成后的 WAV 绝对路径（ok 为 true 时存在） */
  audioPath?: string
  durationMs?: number
  cached?: boolean
  error?: string
}

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), CACHE_DIR_NAME)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function keyOf(req: PromptAudioRequest, engine: string): string {
  const h = crypto.createHash('sha1')
  h.update(engine)
  h.update('|')
  h.update(req.text.trim())
  h.update('|')
  h.update(req.voice ?? DEFAULT_VOICE)
  h.update('|')
  h.update(String(req.rate ?? DEFAULT_RATE))
  h.update('|')
  h.update(req.salt ?? '')
  return h.digest('hex').slice(0, 32)
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`${cmd} 执行失败：${String(stderr || err.message).slice(0, 300)}`))
      else resolve()
    })
  })
}

/** 用 ffprobe/afinfo 读取时长；失败就返回 undefined，不影响播放 */
async function probeDurationMs(wavPath: string): Promise<number | undefined> {
  try {
    await run('/usr/bin/afinfo', [wavPath], 8000)
  } catch {
    /* 只用于日志 */
  }
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('/usr/bin/afinfo', [wavPath], { timeout: 8000 }, (err, stdout) => {
        if (err) reject(err)
        else resolve({ stdout })
      })
    })
    const m = stdout.match(/estimated duration:\s*([\d.]+)\s*sec/i)
    if (m) return Math.round(Number(m[1]) * 1000)
  } catch {
    /* ignore */
  }
  return undefined
}

/**
 * 合成（或命中缓存）一段题目音频。
 * 仅在 macOS 上可用；其他平台直接返回 ok:false 由渲染层降级。
 */
/** 系统语音（macOS say）合成路径，作为兜底 */
async function synthesizeWithSystem(
  text: string,
  voice: string,
  rate: number,
  dir: string,
  key: string
): Promise<PromptAudioResult> {
  const wavPath = path.join(dir, `${key}.wav`)
  const aiffPath = path.join(dir, `${key}.aiff`)
  try {
    // 1) say 合成 AIFF（默认就是未压缩 PCM；加 --data-format 反而会报 fmt? 错误）
    await run('/usr/bin/say', ['-v', voice, '-r', String(rate), '-o', aiffPath, text], 30_000)
    if (!fs.existsSync(aiffPath)) throw new Error('say 没有产出音频文件')

    // 2) 转成 Chromium 稳定支持的 16-bit WAV
    await run('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@22050', '-c', '1', aiffPath, wavPath], 30_000)
    if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size <= 44) {
      throw new Error('afconvert 没有产出有效的 WAV')
    }
    return { ok: true, audioPath: wavPath, durationMs: await probeDurationMs(wavPath), cached: false }
  } finally {
    try {
      if (fs.existsSync(aiffPath)) fs.unlinkSync(aiffPath)
    } catch {
      /* ignore */
    }
  }
}

/** 云端 TTS 合成路径 */
async function synthesizeWithCloud(
  text: string,
  dir: string,
  key: string
): Promise<PromptAudioResult> {
  const s = getRawSettings()
  const tts = s.tts
  // 没单独配 key / 地址就沿用「AI 模型」那一套，用户少填一次
  const baseUrl = tts.baseUrl?.trim() || s.llm.baseUrl
  const apiKey = tts.apiKey?.trim() || s.llm.apiKey

  const res = await synthesizeCloudTts({
    text,
    baseUrl,
    apiKey,
    model: tts.model,
    voice: tts.voice,
    speed: tts.speed
  })
  if (!res.ok || !res.data) return { ok: false, error: res.error ?? '云端语音合成失败' }

  const file = writeAudioToCache(dir, key, res.data, res.mimeType ?? 'audio/wav')
  if (!fs.existsSync(file) || fs.statSync(file).size <= 44) {
    return { ok: false, error: '云端语音合成产出为空' }
  }
  return { ok: true, audioPath: file, durationMs: await probeDurationMs(file), cached: false }
}

/**
 * 合成（或命中缓存）一段题目音频。
 *
 * 优先用设置里的音源；云端失败时自动退回 macOS `say`，
 * 保证「听一遍 → 复述」的考试流程永远不会因为网络问题卡死。
 */
export async function synthesizePromptAudio(req: PromptAudioRequest): Promise<PromptAudioResult> {
  const text = (req.text ?? '').trim()
  if (!text) return { ok: false, error: '文本为空，无法合成音频' }
  if (text.length > 2000) return { ok: false, error: '文本过长（上限 2000 字符）' }

  const settings = getRawSettings()
  const tts = settings.tts
  const provider = tts.provider === 'system' ? 'system' : 'cloud'
  if (provider === 'system' && process.platform !== 'darwin') {
    return { ok: false, error: '当前系统不支持离线语音合成（仅 macOS 可用）' }
  }

  const dir = cacheDir()
  const key = keyOf(req, provider === 'cloud' ? `cloud:${tts.model}:${tts.voice}` : 'system')
  const cachedPath = [path.join(dir, `${key}.wav`), path.join(dir, `${key}.mp3`)].find(
    (f) => fs.existsSync(f) && fs.statSync(f).size > 44
  )
  if (cachedPath) {
    return { ok: true, audioPath: cachedPath, durationMs: await probeDurationMs(cachedPath), cached: true }
  }

  const systemVoice = req.voice ?? tts.systemVoice ?? DEFAULT_VOICE
  const systemRate = req.rate ?? Math.round(DEFAULT_RATE * (tts.speed || 1))

  if (provider === 'cloud') {
    try {
      const res = await synthesizeWithCloud(text, dir, key)
      if (res.ok) return res
      logger.warn('云端语音合成失败，退回系统语音：', res.error)
      if (process.platform !== 'darwin') return res
      const fallbackKey = keyOf(req, 'system')
      return await synthesizeWithSystem(text, systemVoice, systemRate, dir, fallbackKey)
    } catch (err) {
      logger.error('云端语音合成异常：', err)
      if (process.platform !== 'darwin') {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
      const fallbackKey = keyOf(req, 'system')
      return await synthesizeWithSystem(text, systemVoice, systemRate, dir, fallbackKey)
    }
  }

  try {
    return await synthesizeWithSystem(text, systemVoice, systemRate, dir, key)
  } catch (err) {
    logger.error('题目音频合成失败：', err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 清空题目音频缓存（设置页用） */
export function clearPromptAudioCache(): { ok: boolean; removed: number } {
  try {
    const dir = path.join(app.getPath('userData'), CACHE_DIR_NAME)
    if (!fs.existsSync(dir)) return { ok: true, removed: 0 }
    let removed = 0
    for (const f of fs.readdirSync(dir)) {
      try {
        fs.unlinkSync(path.join(dir, f))
        removed += 1
      } catch {
        /* ignore */
      }
    }
    return { ok: true, removed }
  } catch (err) {
    logger.error('清理题目音频缓存失败：', err)
    return { ok: false, removed: 0 }
  }
}

/** 查询可用的英文音色（say -v '?'），供设置页选择 */
export async function listEnglishVoices(): Promise<string[]> {
  if (process.platform !== 'darwin') return []
  try {
    const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
      execFile('/usr/bin/say', ['-v', '?'], { timeout: 8000, maxBuffer: 2 * 1024 * 1024 }, (err, out) => {
        if (err) reject(err)
        else resolve({ stdout: out })
      })
    })
    return stdout
      .split('\n')
      .filter((l) => /\ben_US\b|\ben_GB\b|\ben_AU\b/.test(l))
      .map((l) => l.trim().split(/\s{2,}/)[0])
      .filter(Boolean)
      .slice(0, 40)
  } catch {
    return []
  }
}
