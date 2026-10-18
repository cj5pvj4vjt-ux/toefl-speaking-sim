import fs from 'node:fs'
import path from 'node:path'
import { TASK_META } from '@shared/constants'
import type { TaskType } from '@shared/types'
import { getExamDir, isInside, getRecordingsDir } from './paths'
import { logger } from './logger'

/**
 * 录音文件存储。
 * 目录结构：<dataRoot>/recordings/<examId>/task1.webm + task1.json
 */

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3'
}

export interface SaveResult {
  ok: boolean
  audioPath?: string
  metaPath?: string
  error?: string
}

export function saveRecording(params: {
  examId: string
  order: number
  taskType: TaskType
  data: ArrayBuffer | Uint8Array
  mimeType: string
  durationMs: number
  /** 该 task 在本次考试中是第几次出现，用于命名去重 */
  occurrence: number
}): SaveResult {
  try {
    if (!params.data) {
      return { ok: false, error: '保存录音失败：没有收到音频数据' }
    }
    const dir = getExamDir(params.examId)
    const ext = EXT_BY_MIME[params.mimeType] ?? 'webm'
    const taskIndex = TASK_META[params.taskType]?.index ?? params.order + 1
    const base = params.occurrence > 0 ? `task${taskIndex}-${params.occurrence + 1}` : `task${taskIndex}`
    const audioPath = path.join(dir, `${base}.${ext}`)
    const buf =
      params.data instanceof Uint8Array
        ? Buffer.from(params.data)
        : Buffer.from(new Uint8Array(params.data as ArrayBuffer))
    if (buf.byteLength === 0) {
      return { ok: false, error: '保存录音失败：音频数据为空' }
    }
    fs.writeFileSync(audioPath, buf)

    const metaPath = path.join(dir, `${base}.json`)
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          examId: params.examId,
          order: params.order,
          taskType: params.taskType,
          taskIndex,
          mimeType: params.mimeType,
          bytes: buf.byteLength,
          durationMs: params.durationMs,
          recordedAt: Date.now()
        },
        null,
        2
      ),
      'utf8'
    )
    logger.info(`录音已保存 ${path.basename(audioPath)} (${buf.byteLength} bytes)`)
    return { ok: true, audioPath, metaPath }
  } catch (e) {
    logger.error('保存录音失败', e)
    return { ok: false, error: `保存录音失败：${(e as Error).message}` }
  }
}

export function audioExists(p: string | null | undefined): boolean {
  if (!p) return false
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0
  } catch {
    return false
  }
}

export function readRecording(p: string): { ok: boolean; data?: Buffer; error?: string } {
  try {
    const root = getRecordingsDir()
    if (!isInside(root, p)) {
      return { ok: false, error: '拒绝访问录音目录之外的文件' }
    }
    return { ok: true, data: fs.readFileSync(p) }
  } catch (e) {
    return { ok: false, error: `读取录音失败：${(e as Error).message}` }
  }
}

export function deleteRecording(p: string | null | undefined): void {
  if (!p) return
  try {
    const root = getRecordingsDir()
    if (isInside(root, p) && fs.existsSync(p)) fs.unlinkSync(p)
  } catch (e) {
    logger.warn('删除录音失败', e)
  }
}

export function deleteExamDir(examId: string): void {
  try {
    const dir = path.join(getRecordingsDir(), examId)
    if (isInside(getRecordingsDir(), dir) && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch (e) {
    logger.warn('删除考试录音目录失败', e)
  }
}
