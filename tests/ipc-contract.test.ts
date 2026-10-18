import { beforeAll, describe, expect, it } from 'vitest'
import { invokeIpc, registeredChannels } from './stubs/electron'
import { IPC } from '@main/ipc/channels'
import { registerIpc } from '@main/ipc/index'
import { closeDatabase, openDatabase } from '@database/db'
import { saveQuestionSet } from '@database/repositories'
import { makeQuestionSet, tempDir } from './helpers'
import path from 'node:path'
import type { ExamAttempt } from '@shared/types'

/**
 * IPC 返回结构契约测试。
 *
 * `ipcRenderer.invoke` 的返回类型是 any，TypeScript 无法校验主进程 handler 的
 * 返回结构与 `TofeApi` 声明是否一致。因此这里从「渲染进程视角」直接调用已注册
 * 的 handler，断言返回结构确实是 `TofeApi` 声明的形状。
 */

let tmp: { dir: string; cleanup: () => void }

beforeAll(() => {
  tmp = tempDir('toefl-ipc-')
  openDatabase(path.join(tmp.dir, 'ipc-contract.db'))
  registerIpc()
})

describe('IPC 通道注册', () => {
  it('所有关键通道都已注册', () => {
    const ch = registeredChannels()
    for (const c of [
      IPC.appInfo,
      IPC.settingsGet,
      IPC.settingsSetApiKey,
      IPC.qsList,
      IPC.examCreate,
      IPC.examSaveRecording,
      IPC.examFinish,
      IPC.examGet,
      IPC.reportExport
    ]) {
      expect(ch).toContain(c)
    }
  })
})

describe('考试相关 IPC 的返回契约（必须是 {ok, attempt}，不能是 {ok, data}）', () => {
  let setId = ''

  beforeAll(() => {
    const set = makeQuestionSet({ title: 'IPC 契约测试题库' })
    saveQuestionSet(set)
    setId = set.id
  })

  it('exams.create 成功时返回 attempt 字段本身', async () => {
    const res = await invokeIpc(IPC.examCreate, { questionSetId: setId, mode: 'FULL' })

    expect(res.ok).toBe(true)
    // 回归点：以前这里是 {ok:true, data:{...}}，导致 res.attempt === undefined
    expect(res.data).toBeUndefined()
    expect(res.attempt).toBeTruthy()

    const attempt = res.attempt as ExamAttempt
    expect(attempt.id).toMatch(/^exam_/)
    expect(attempt.mode).toBe('FULL')
    expect(attempt.attempts.length).toBeGreaterThan(0)
    expect(attempt.status).toBe('DRAFT')
    // 每题都要带上题目快照，考试页完全依赖它渲染
    for (const item of attempt.attempts) {
      expect(item.questionSnapshot).toBeTruthy()
      expect(item.questionSnapshot.questionText.length).toBeGreaterThan(0)
      expect(item.questionSnapshot.responseTime).toBeGreaterThan(0)
    }
  })

  it('exams.create 失败时返回 {ok:false, error} 而不是抛异常', async () => {
    const res = await invokeIpc(IPC.examCreate, { questionSetId: '不存在的题库', mode: 'FULL' })
    expect(res.ok).toBe(false)
    expect(typeof res.error).toBe('string')
    expect(res.error.length).toBeGreaterThan(0)
  })

  it('exams.get 能读回刚创建的考试', async () => {
    const created = await invokeIpc(IPC.examCreate, { questionSetId: setId, mode: 'LISTEN_REPEAT' })
    expect(created.ok).toBe(true)
    const back = await invokeIpc(IPC.examGet, created.attempt.id)
    expect(back).toBeTruthy()
    expect(back.id).toBe(created.attempt.id)
  })

  it('exams.saveRecording 空音频时返回 {ok:false, error}（不能静默成功）', async () => {
    const created = await invokeIpc(IPC.examCreate, { questionSetId: setId, mode: 'LISTEN_REPEAT' })
    const attempt = created.attempt as ExamAttempt
    const first = attempt.attempts[0]

    const res = await invokeIpc(IPC.examSaveRecording, {
      examId: attempt.id,
      order: first.order,
      taskType: first.taskType,
      occurrence: 0,
      mimeType: 'audio/webm',
      durationMs: 1000,
      data: new ArrayBuffer(0)
    })

    expect(res.ok).toBe(false)
    expect(res.data).toBeUndefined()
    expect(typeof res.error).toBe('string')
  })

  it('exams.finish 对不存在的考试返回 {ok:false, error}', async () => {
    const res = await invokeIpc(IPC.examFinish, 'exam_不存在')
    expect(res.ok).toBe(false)
    expect(typeof res.error).toBe('string')
  })
})

describe('设置相关 IPC 不泄漏密钥', () => {
  it('settings.get 永远不返回明文 apiKey', async () => {
    const res = await invokeIpc(IPC.settingsGet)
    expect(res).toBeTruthy()
    expect(JSON.stringify(res)).not.toContain('"apiKey"')
    expect(res.llm.apiKeySet).toBeTypeOf('boolean')
    // 预览里必须是掩码
    if (res.llm.apiKeySet) {
      expect(res.llm.apiKeyPreview).toMatch(/••/)
    }
  })

  it('写入密钥后返回的仍是掩码预览', async () => {
    const saved = await invokeIpc(IPC.settingsSetApiKey, 'llm', 'sk-test-1234567890abcdef')
    const preview = JSON.stringify(saved)
    expect(preview).not.toContain('1234567890abcdef')
    expect(preview).toContain('••')
  })
})


