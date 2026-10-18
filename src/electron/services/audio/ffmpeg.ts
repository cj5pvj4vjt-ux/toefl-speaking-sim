import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { logger } from '../logger'

const execFileAsync = promisify(execFile)

/** 在常见位置查找可执行文件 */
export function which(bin: string): string | null {
  const candidates = [
    bin,
    `/opt/homebrew/bin/${bin}`,
    `/usr/local/bin/${bin}`,
    `/usr/bin/${bin}`,
    path.join(os.homedir(), '.local/bin', bin)
  ]
  for (const c of candidates) {
    try {
      if (path.isAbsolute(c)) {
        if (fs.existsSync(c)) return c
      } else {
        const dirs = (process.env.PATH ?? '').split(':').filter(Boolean)
        for (const d of dirs) {
          const full = path.join(d, c)
          if (fs.existsSync(full)) return full
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

export function findFfmpeg(): string | null {
  return which('ffmpeg')
}

/** 把任意音频转成 whisper 需要的 16kHz 单声道 WAV */
export async function toWhisperWav(input: string, outDir: string): Promise<string> {
  const ffmpeg = findFfmpeg()
  if (!ffmpeg) {
    throw new Error('未找到 ffmpeg，本地转写需要它来转换音频格式（brew install ffmpeg）')
  }
  const out = path.join(outDir, `${path.basename(input).replace(/\.[^.]+$/, '')}-16k.wav`)
  await execFileAsync(ffmpeg, ['-y', '-i', input, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out], {
    timeout: 120000,
    maxBuffer: 1024 * 1024 * 16
  })
  if (!fs.existsSync(out)) throw new Error('音频转换失败')
  return out
}

export interface LocalWhisperProbe {
  available: boolean
  kind: 'whisper.cpp' | 'openai-whisper' | null
  binary: string | null
  ffmpeg: string | null
  detail: string
}

/** 探测本地 whisper 环境（设置页「本地引擎」诊断用） */
export function probeLocalWhisper(binaryPath?: string, modelPath?: string): LocalWhisperProbe {
  const ffmpeg = findFfmpeg()
  const explicit = binaryPath && binaryPath.trim() ? binaryPath.trim() : null
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      return { available: false, kind: null, binary: null, ffmpeg, detail: `指定的可执行文件不存在：${explicit}` }
    }
    return {
      available: true,
      kind: /whisper-cli|main|whisper-cpp/.test(path.basename(explicit)) ? 'whisper.cpp' : 'openai-whisper',
      binary: explicit,
      ffmpeg,
      detail: modelPath && fs.existsSync(modelPath) ? '就绪' : '已找到可执行文件，但未设置有效的模型文件'
    }
  }
  const cpp = which('whisper-cli') ?? which('whisper-cpp') ?? which('whisper-cpp-cli')
  if (cpp) {
    return {
      available: true,
      kind: 'whisper.cpp',
      binary: cpp,
      ffmpeg,
      detail: modelPath && fs.existsSync(modelPath) ? '就绪' : '已找到 whisper.cpp，但需要指定 ggml 模型文件'
    }
  }
  const py = which('whisper')
  if (py) {
    return { available: true, kind: 'openai-whisper', binary: py, ffmpeg, detail: '使用 openai-whisper CLI' }
  }
  return {
    available: false,
    kind: null,
    binary: null,
    ffmpeg,
    detail: '未检测到本地 whisper。可执行 brew install whisper-cpp 并下载 ggml 模型，或指定可执行文件路径。'
  }
}

export interface LocalTranscribeResult {
  ok: boolean
  text: string
  error?: string
  engine?: string
}

/** 调用本地 whisper 转写 */
export async function localTranscribe(opts: {
  audioPath: string
  binaryPath?: string
  modelPath?: string
  language?: string
}): Promise<LocalTranscribeResult> {
  const probe = probeLocalWhisper(opts.binaryPath, opts.modelPath)
  if (!probe.available || !probe.binary) {
    return { ok: false, text: '', error: probe.detail }
  }
  if (!probe.ffmpeg) {
    return { ok: false, text: '', error: '未找到 ffmpeg，本地转写需要它（brew install ffmpeg）' }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toefl-stt-'))
  try {
    const wav = await toWhisperWav(opts.audioPath, tmp)
    const lang = opts.language || 'en'

    if (probe.kind === 'whisper.cpp') {
      if (!opts.modelPath || !fs.existsSync(opts.modelPath)) {
        return {
          ok: false,
          text: '',
          error: 'whisper.cpp 需要 ggml 模型文件，请在「设置 → 语音转文字」中指定（例如 ggml-base.en.bin）'
        }
      }
      const { stdout } = await execFileAsync(
        probe.binary,
        ['-m', opts.modelPath, '-f', wav, '-l', lang, '-nt', '-otxt', '-of', path.join(tmp, 'out')],
        { timeout: 600000, maxBuffer: 1024 * 1024 * 32 }
      )
      const txtFile = path.join(tmp, 'out.txt')
      if (fs.existsSync(txtFile)) {
        return { ok: true, text: fs.readFileSync(txtFile, 'utf8').trim(), engine: 'whisper.cpp' }
      }
      return { ok: true, text: cleanCppStdout(stdout), engine: 'whisper.cpp' }
    }

    // openai-whisper CLI
    const model = (opts.modelPath && opts.modelPath.trim()) || 'base'
    await execFileAsync(
      probe.binary,
      [wav, '--model', model, '--language', lang, '--output_format', 'txt', '--output_dir', tmp, '--fp16', 'False'],
      { timeout: 900000, maxBuffer: 1024 * 1024 * 32 }
    )
    const out = path.join(tmp, `${path.basename(wav, '.wav')}.txt`)
    if (fs.existsSync(out)) return { ok: true, text: fs.readFileSync(out, 'utf8').trim(), engine: 'openai-whisper' }
    return { ok: false, text: '', error: '本地 whisper 未生成转写文件' }
  } catch (e) {
    logger.warn('本地转写失败', e)
    return { ok: false, text: '', error: `本地转写失败：${(e as Error).message}` }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

function cleanCppStdout(stdout: string): string {
  return stdout
    .split('\n')
    .filter((l) => !/^\s*\[[\d:.]+\]/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
