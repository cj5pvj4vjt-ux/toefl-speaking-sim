import { createWorker } from 'tesseract.js'
import { logger } from '../logger'

/**
 * OCR：用于扫描版 PDF。
 * 渲染进程负责把 PDF 页面画成 PNG（完全离线），
 * 主进程只在需要时调用本模块（会从 CDN 下载语言包，仅此一步需要联网）。
 */

let workerPromise: Promise<import('tesseract.js').Worker> | null = null
let workerLang = ''

async function getWorker(lang: string) {
  if (workerPromise && workerLang === lang) return workerPromise
  workerLang = lang
  workerPromise = (async () => {
    const w = await createWorker(lang, 1, {
      logger: () => undefined,
      cachePath: undefined
    })
    return w
  })()
  return workerPromise
}

export async function disposeOcr(): Promise<void> {
  try {
    const w = await workerPromise
    await w?.terminate()
  } catch {
    /* ignore */
  }
  workerPromise = null
  workerLang = ''
}

export async function recognizeImage(
  image: Buffer | Uint8Array,
  lang = 'eng'
): Promise<{ ok: boolean; text: string; error?: string; confidence?: number }> {
  try {
    const worker = await getWorker(lang)
    const buf = image instanceof Uint8Array ? Buffer.from(image) : image
    const res = await worker.recognize(buf)
    return { ok: true, text: res.data.text ?? '', confidence: res.data.confidence }
  } catch (e) {
    logger.warn('OCR 失败', e)
    const msg = (e as Error).message ?? String(e)
    if (/ENOTFOUND|fetch failed|network|ETIMEDOUT/i.test(msg)) {
      return {
        ok: false,
        text: '',
        error: 'OCR 语言包下载失败（需要联网下载一次）。请检查网络后重试，或手动录入题目。'
      }
    }
    return { ok: false, text: '', error: `OCR 识别失败：${msg}` }
  }
}
