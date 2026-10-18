import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  audioExists,
  deleteExamDir,
  deleteRecording,
  readRecording,
  saveRecording
} from '@main/services/audioStorage'
import { getExamDir, getRecordingsDir, isInside, setDataRoot } from '@main/services/paths'
import { makeWavBuffer, tempDir } from './helpers'

let dir: string
let cleanup: () => void

beforeAll(() => {
  const t = tempDir('toefl-audio-')
  dir = t.dir
  cleanup = t.cleanup
  setDataRoot(dir)
})

afterAll(() => {
  cleanup()
})

describe('录音文件存储', () => {
  const wav = makeWavBuffer(1)

  it('保存 WebM 录音并生成同名元数据', () => {
    const res = saveRecording({
      examId: 'exam-1',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array(wav),
      mimeType: 'audio/webm;codecs=opus',
      durationMs: 41000,
      occurrence: 0
    })
    expect(res.ok).toBe(true)
    expect(res.audioPath).toBe(path.join(getExamDir('exam-1'), 'task1.webm'))
    expect(fs.existsSync(res.audioPath!)).toBe(true)
    expect(fs.statSync(res.audioPath!).size).toBe(wav.byteLength)

    const meta = JSON.parse(fs.readFileSync(res.metaPath!, 'utf8'))
    expect(meta.examId).toBe('exam-1')
    expect(meta.taskType).toBe('LISTEN_REPEAT')
    expect(meta.durationMs).toBe(41000)
    expect(meta.bytes).toBe(wav.byteLength)
  })

  it('支持 ArrayBuffer 入参（与 IPC 传输格式一致）', () => {
    const buf = new Uint8Array(wav)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    const res = saveRecording({
      examId: 'exam-ab',
      order: 1,
      taskType: 'INTERVIEW',
      data: ab,
      mimeType: 'audio/webm',
      durationMs: 60000,
      occurrence: 0
    })
    expect(res.ok).toBe(true)
    expect(fs.statSync(res.audioPath!).size).toBe(wav.byteLength)
  })

  it('按 MIME 决定扩展名，未知 MIME 回退 webm', () => {
    const cases: [string, string][] = [
      ['audio/wav', 'wav'],
      ['audio/mpeg', 'mp3'],
      ['audio/ogg', 'ogg'],
      ['audio/mp4', 'm4a'],
      ['application/octet-stream', 'webm']
    ]
    for (const [mime, ext] of cases) {
      const res = saveRecording({
        examId: `exam-mime-${ext}`,
        order: 0,
        taskType: 'LISTEN_REPEAT',
        data: new Uint8Array([1, 2, 3]),
        mimeType: mime,
        durationMs: 1000,
        occurrence: 0
      })
      expect(res.audioPath!.endsWith(`.${ext}`)).toBe(true)
    }
  })

  it('同一 Task 出现多次时用 -2 / -3 后缀去重，不覆盖第一段', () => {
    const a = saveRecording({
      examId: 'exam-dup',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array([1]),
      mimeType: 'audio/webm',
      durationMs: 1000,
      occurrence: 0
    })
    const b = saveRecording({
      examId: 'exam-dup',
      order: 1,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array([2]),
      mimeType: 'audio/webm',
      durationMs: 1000,
      occurrence: 1
    })
    expect(path.basename(a.audioPath!)).toBe('task1.webm')
    expect(path.basename(b.audioPath!)).toBe('task1-2.webm')
    expect(fs.readFileSync(a.audioPath!)[0]).toBe(1)
    expect(fs.readFileSync(b.audioPath!)[0]).toBe(2)
  })

  it('audioExists 对不存在的路径与空值返回 false', () => {
    expect(audioExists(null)).toBe(false)
    expect(audioExists('')).toBe(false)
    expect(audioExists('/nope/missing.webm')).toBe(false)
    expect(audioExists(path.join(getExamDir('exam-1'), 'task1.webm'))).toBe(true)
  })

  it('空文件视为不存在（防止「有路径但没录上」被当成有效作答）', () => {
    const p = path.join(getExamDir('exam-empty'), 'task1.webm')
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, Buffer.alloc(0))
    expect(audioExists(p)).toBe(false)
  })

  it('readRecording 返回可用的字节与 MIME', () => {
    const res = saveRecording({
      examId: 'exam-read',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array(wav),
      mimeType: 'audio/webm',
      durationMs: 30000,
      occurrence: 0
    })
    const read = readRecording(res.audioPath!)
    expect(read.ok).toBe(true)
    expect(read.data!.byteLength).toBe(wav.byteLength)
  })

  it('读取不存在的录音返回错误而不抛异常', () => {
    const read = readRecording('/definitely/not/here.webm')
    expect(read.ok).toBe(false)
    expect(read.error).toBeTruthy()
  })

  it('deleteRecording 只删文件，不越界删除其他内容', () => {
    const res = saveRecording({
      examId: 'exam-del',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array([1]),
      mimeType: 'audio/webm',
      durationMs: 1000,
      occurrence: 0
    })
    deleteRecording(res.audioPath)
    expect(fs.existsSync(res.audioPath!)).toBe(false)
    // 传 null / 无关路径不应出错
    expect(() => deleteRecording(null)).not.toThrow()
    expect(() => deleteRecording('/etc/hosts-not-real')).not.toThrow()
  })

  it('deleteExamDir 删除整场录音目录', () => {
    saveRecording({
      examId: 'exam-dir',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: new Uint8Array([1]),
      mimeType: 'audio/webm',
      durationMs: 1000,
      occurrence: 0
    })
    const dirPath = path.join(getRecordingsDir(), 'exam-dir')
    expect(fs.existsSync(dirPath)).toBe(true)
    deleteExamDir('exam-dir')
    // 注意：getExamDir() 会顺带创建目录，所以这里必须用纯路径断言
    expect(fs.existsSync(dirPath)).toBe(false)
  })

  it('音频数据损坏（非法入参）时返回错误而不崩溃', () => {
    const res = saveRecording({
      examId: 'exam-bad',
      order: 0,
      taskType: 'LISTEN_REPEAT',
      data: undefined as never,
      mimeType: 'audio/webm',
      durationMs: 0,
      occurrence: 0
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/保存录音失败/)
  })
})

describe('路径安全（防目录穿越）', () => {
  it('isInside 正确判断父子关系', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(true)
    expect(isInside('/a/b', '/a/c')).toBe(false)
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a/b/../c')).toBe(false)
  })
})
