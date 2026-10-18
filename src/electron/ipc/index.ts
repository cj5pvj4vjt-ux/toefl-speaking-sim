import { BrowserWindow, dialog, ipcMain, shell, app, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from './channels'
import { getRawSettings, getSafeSettings, saveSettings, isEncryptionAvailable } from '../services/settingsStore'
import {
  getDataRoot,
  getDbPath,
  getRecordingsDir,
  getReportsDir,
  setDataRoot
} from '../services/paths'
import { logger } from '../services/logger'
import { listModels, testConnection, normalizeBaseUrl } from '../services/llm/openaiCompatible'
import { diagnoseStt, listSpeechProviders } from '../services/stt'
import { runAnalysis, type PipelineProgress } from '../services/exam/pipeline'
import { deleteExamDir, deleteRecording, readRecording, saveRecording } from '../services/audioStorage'
import { defaultReportPath, generateExamReport } from '../services/reports/pdfReport'
import {
  deleteAttempt,
  deleteQuestionSet,
  getAttempt,
  getQuestionSet,
  clearAllAttempts,
  listAttempts,
  listQuestionSets,
  saveAttempt,
  saveQuestionSet
} from '@database/repositories'
import { pickExamQuestions } from '@shared/pdf/parseQuestions'
import { parsePagesWithLlm } from '../services/pdf/llmParse'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import type { ExamAttempt, ExamMode, Question, QuestionAttempt, TaskType } from '@shared/types'
import type { ExamCreateResult, ExamSaveRecordingResult, ExamAnalyzeResult } from '@shared/types/ipc'
import type {
  AppInfo,
  CreateExamRequest,
  OpenedFile,
  PipelineProgressEvent,
  ReanalyzeRequest,
  SaveRecordingRequest,
  TestConnectionRequest
} from '@shared/types/ipc'

function ok<T>(data: T) {
  return { ok: true as const, data }
}

function fail(error: string, code?: string) {
  return { ok: false as const, error, code }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export function registerIpc(): void {
  /* ============================ 应用信息 ============================ */
  ipcMain.handle(IPC.appInfo, (): AppInfo => {
    return {
      version: app.getVersion(),
      name: app.getName(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      dataDir: getDataRoot(),
      recordingsDir: getRecordingsDir(),
      reportsDir: getReportsDir(),
      encryptionAvailable: isEncryptionAvailable(),
      sttProviders: listSpeechProviders()
    }
  })

  /* ============================== 设置 ============================== */
  ipcMain.handle(IPC.settingsGet, () => {
    try {
      const s = getSafeSettings()
      s.dataDir = getDataRoot()
      return s
    } catch (e) {
      throw new Error(`读取设置失败：${(e as Error).message}`)
    }
  })

  ipcMain.handle(IPC.settingsSave, (_e, patch: Record<string, unknown>) => {
    try {
      // 防御：Renderer 不允许直接写 apiKey（必须走 setApiKey）
      const clean = JSON.parse(JSON.stringify(patch ?? {})) as Record<string, Record<string, unknown>>
      if (clean.llm) delete clean.llm.apiKey
      if (clean.stt) delete clean.stt.apiKey
      if (clean.tts) delete clean.tts.apiKey
      const saved = saveSettings(clean as never)
      const safe = getSafeSettings()
      safe.dataDir = getDataRoot()
      logger.info('设置已更新', {
        llmModel: saved.llm.model,
        llmBaseUrl: saved.llm.baseUrl,
        sttProvider: saved.stt.provider
      })
      return safe
    } catch (e) {
      throw new Error(`保存设置失败：${(e as Error).message}`)
    }
  })

  ipcMain.handle(IPC.settingsSetApiKey, (_e, which: 'llm' | 'stt' | 'tts', apiKey: string) => {
    try {
      if (which !== 'llm' && which !== 'stt' && which !== 'tts') throw new Error('未知的密钥类型')
      const patch =
        which === 'llm'
          ? { llm: { apiKey: String(apiKey ?? '') } }
          : which === 'stt'
            ? { stt: { apiKey: String(apiKey ?? '') } }
            : { tts: { apiKey: String(apiKey ?? '') } }
      saveSettings(patch as never)
      const safe = getSafeSettings()
      safe.dataDir = getDataRoot()
      return safe
    } catch (e) {
      throw new Error(`保存密钥失败：${(e as Error).message}`)
    }
  })

  ipcMain.handle(IPC.settingsClearApiKey, (_e, which: 'llm' | 'stt' | 'tts') => {
    try {
      const patch =
        which === 'llm'
          ? { llm: { apiKey: '' } }
          : which === 'stt'
            ? { stt: { apiKey: '' } }
            : which === 'tts'
              ? { tts: { apiKey: '' } }
              : null
      if (!patch) throw new Error('未知的密钥类型')
      saveSettings(patch as never)
      const safe = getSafeSettings()
      safe.dataDir = getDataRoot()
      return safe
    } catch (e) {
      throw new Error(`清除密钥失败：${(e as Error).message}`)
    }
  })

  ipcMain.handle(IPC.settingsTestConnection, async (_e, req?: TestConnectionRequest) => {
    const s = getRawSettings()
    const baseUrl = normalizeBaseUrl(req?.baseUrl?.trim() || s.llm.baseUrl)
    const apiKey = req?.apiKey?.trim() || s.llm.apiKey
    const model = req?.model?.trim() || s.llm.model
    if (!baseUrl) return { ok: false, message: '请先填写 Base URL' }
    try {
      return await testConnection({ baseUrl, apiKey, model })
    } catch (e) {
      return { ok: false, message: `测试失败：${(e as Error).message}` }
    }
  })

  ipcMain.handle(IPC.settingsListModels, async (_e, req?: { baseUrl?: string; apiKey?: string }) => {
    const s = getRawSettings()
    const baseUrl = normalizeBaseUrl(req?.baseUrl?.trim() || s.llm.baseUrl)
    const apiKey = req?.apiKey?.trim() || s.llm.apiKey
    if (!baseUrl) return { ok: false, models: [], error: '请先填写 Base URL' }
    try {
      return await listModels({ baseUrl, apiKey })
    } catch (e) {
      return { ok: false, models: [], error: `获取模型列表失败：${(e as Error).message}` }
    }
  })

  ipcMain.handle(IPC.settingsDiagnoseStt, () => {
    try {
      return diagnoseStt(getRawSettings().stt)
    } catch (e) {
      return { ok: false, message: `诊断失败：${(e as Error).message}` }
    }
  })

  ipcMain.handle(IPC.settingsChooseDataDir, async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win!, {
      title: '选择数据存储目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDataRoot()
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    try {
      setDataRoot(res.filePaths[0])
      return { ok: true, path: res.filePaths[0] }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.settingsOpenDataDir, async () => {
    await shell.openPath(getDataRoot())
  })

  /* ============================== 文件 ============================== */
  ipcMain.handle(IPC.fileOpenPdfDialog, async (): Promise<OpenedFile> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showOpenDialog(win!, {
      title: '选择 TOEFL Speaking 真题 PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true }
    return readPdfFile(res.filePaths[0])
  })

  ipcMain.handle(IPC.fileReadPdf, async (_e, filePath: string): Promise<OpenedFile> => {
    return readPdfFile(filePath)
  })

  ipcMain.handle(IPC.fileReveal, async (_e, target: string) => {
    shell.showItemInFolder(target)
  })

  ipcMain.handle(IPC.fileOpenExternal, async (_e, target: string) => {
    await shell.openPath(target)
  })

  ipcMain.handle(IPC.fileSaveDialog, async (_e, defaultName: string, data: ArrayBuffer) => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const res = await dialog.showSaveDialog(win!, {
      title: '保存文件',
      defaultPath: path.join(app.getPath('downloads'), defaultName)
    })
    if (res.canceled || !res.filePath) return { ok: false }
    try {
      fs.writeFileSync(res.filePath, Buffer.from(new Uint8Array(data)))
      return { ok: true, path: res.filePath }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  /* ============================== 题库 ============================== */
  ipcMain.handle(IPC.qsList, () => {
    try {
      return listQuestionSets()
    } catch (e) {
      logger.error('读取题库失败', e)
      return []
    }
  })

  ipcMain.handle(IPC.qsGet, (_e, id: string) => {
    try {
      return getQuestionSet(id)
    } catch (e) {
      logger.error('读取题库失败', e)
      return null
    }
  })

  ipcMain.handle(IPC.qsSave, (_e, set) => {
    try {
      return saveQuestionSet(set)
    } catch (e) {
      logger.error('保存题库失败', e)
      throw new Error(`保存题库失败：${(e as Error).message}`)
    }
  })

  ipcMain.handle(IPC.qsDelete, (_e, id: string) => {
    try {
      deleteQuestionSet(id)
      return { ok: true }
    } catch (e) {
      logger.error('删除题库失败', e)
      return { ok: false }
    }
  })

  ipcMain.handle(IPC.qsUpdateQuestion, (_e, setId: string, question: Question) => {
    try {
      const set = getQuestionSet(setId)
      if (!set) return null
      const idx = set.questions.findIndex((q) => q.id === question.id)
      if (idx >= 0) set.questions[idx] = { ...question, needsReview: false }
      else set.questions.push({ ...question, needsReview: false })
      const saved = saveQuestionSet(set)
      return getQuestionSet(saved.id)
    } catch (e) {
      logger.error('更新题目失败', e)
      return null
    }
  })

  /* ============================== 考试 ============================== */
  ipcMain.handle(IPC.examCreate, (_e, req: CreateExamRequest) => {
    try {
      const set = getQuestionSet(req.questionSetId)
      if (!set) return fail('题库不存在，请先导入真题 PDF')
      if (set.questions.length === 0) return fail('该题库中没有题目')

      const settings = getRawSettings()
      const mode: ExamMode = req.mode ?? 'FULL'
      const pool = mode === 'FULL' ? set.questions : set.questions
      const picked = pickExamQuestions(pool, mode as never, req.customTaskTypes)
      if (picked.length === 0) {
        return fail(
          mode === 'FULL'
            ? '该题库无法组成完整考试（需要 Task 1-4 各至少一道）'
            : '该题库中没有对应 Task 的题目'
        )
      }

      const prepOverride = req.preparationTime && req.preparationTime > 0 ? req.preparationTime : settings.exam.defaultPreparationTime
      const respOverride = req.responseTime && req.responseTime > 0 ? req.responseTime : settings.exam.defaultResponseTime

      const occurrences = new Map<TaskType, number>()
      const items: QuestionAttempt[] = picked.map((q, i) => {
        const occ = occurrences.get(q.taskType) ?? 0
        occurrences.set(q.taskType, occ + 1)
        return {
          questionId: q.id,
          taskType: q.taskType,
          order: i,
          audioPath: null,
          audioMimeType: null,
          durationMs: 0,
          transcript: null,
          score: null,
          sttError: null,
          scoreError: null,
          questionSnapshot: {
            ...q,
            preparationTime: prepOverride > 0 ? prepOverride : q.preparationTime,
            responseTime: respOverride > 0 ? respOverride : q.responseTime
          }
        }
      })

      const totalSeconds = items.reduce((a, it) => a + it.questionSnapshot.preparationTime + it.questionSnapshot.responseTime, 0)
      const attempt: ExamAttempt = {
        id: newId('exam'),
        date: Date.now(),
        questionSetId: set.id,
        questionSetTitle: set.title,
        title: req.title || `${modeLabel(mode)} · ${new Date().toLocaleDateString('zh-CN')}`,
        mode,
        overallScore: null,
        rawTotal: null,
        taskScores: TASK_TYPES.map((t) => ({
          taskType: t,
          rawScore: null,
          band: null,
          responseCount: 0,
          delivery: null,
          languageUse: null,
          topicDevelopment: null
        })),
        summary: null,
        durationMs: totalSeconds * 1000,
        attempts: items,
        status: 'DRAFT',
        pendingErrors: []
      }
      saveAttempt(attempt)
      logger.info(`已创建考试 ${attempt.id}（${mode}，${items.length} 题）`)
      // 注意：返回结构必须与 TofeApi.exams.create 声明一致（{ok, attempt}），
      // 不能用通用的 ok() 信封（{ok, data}），否则渲染进程读 res.attempt 会拿到 undefined。
      const created: ExamCreateResult = { ok: true, attempt }
      return created
    } catch (e) {
      logger.error('创建考试失败', e)
      return { ok: false, error: `创建考试失败：${(e as Error).message}` } satisfies ExamCreateResult
    }
  })

  ipcMain.handle(IPC.examSaveRecording, (_e, req: SaveRecordingRequest) => {
    try {
      const attempt = getAttempt(req.examId)
      if (!attempt) return { ok: false, error: '考试记录不存在' } satisfies ExamSaveRecordingResult
      const res = saveRecording({
        examId: req.examId,
        order: req.order,
        taskType: req.taskType,
        occurrence: req.occurrence ?? 0,
        mimeType: req.mimeType,
        durationMs: req.durationMs,
        data: req.data
      })
      if (!res.ok) return { ok: false, error: res.error ?? '保存录音失败' } satisfies ExamSaveRecordingResult
      const item = attempt.attempts.find((a) => a.order === req.order)
      if (item) {
        item.audioPath = res.audioPath ?? null
        item.audioMimeType = req.mimeType
        item.durationMs = req.durationMs
        saveAttempt(attempt)
      }
      const saved: ExamSaveRecordingResult = { ok: true, audioPath: res.audioPath }
      return saved
    } catch (e) {
      logger.error('保存录音失败', e)
      return { ok: false, error: `保存录音失败：${(e as Error).message}` } satisfies ExamSaveRecordingResult
    }
  })

  ipcMain.handle(IPC.examFinish, async (_e, examId: string) => {
    try {
      const attempt = getAttempt(examId)
      if (!attempt) return { ok: false, error: '考试记录不存在' } satisfies ExamAnalyzeResult
      const win = BrowserWindow.getAllWindows()[0]
      const result = await runAnalysis(examId, (p) => emitProgress(win, p))
      return result ? { ok: true, attempt: result } : { ok: false, error: '处理失败' }
    } catch (e) {
      logger.error('结束考试处理失败', e)
      return { ok: false, error: `处理失败：${(e as Error).message}` } satisfies ExamAnalyzeResult
    }
  })

  ipcMain.handle(IPC.examReanalyze, async (event: IpcMainInvokeEvent, req: ReanalyzeRequest) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getAllWindows()[0]
      const result = await runAnalysis(
        req.examId,
        (p) => emitProgress(win, p),
        {
          transcribeOnly: req.transcribeOnly,
          force: req.force,
          regenerateSummary: req.regenerateSummary
        }
      )
      return result ? { ok: true, attempt: result } : { ok: false, error: '重新分析失败' }
    } catch (e) {
      logger.error('重新分析失败', e)
      return { ok: false, error: `重新分析失败：${(e as Error).message}` } satisfies ExamAnalyzeResult
    }
  })

  ipcMain.handle(IPC.examGet, (_e, id: string) => {
    try {
      return getAttempt(id)
    } catch (e) {
      logger.error('读取考试记录失败', e)
      return null
    }
  })

  ipcMain.handle(IPC.examList, (_e, limit = 100) => {
    try {
      return listAttempts(limit)
    } catch (e) {
      logger.error('读取考试列表失败', e)
      return []
    }
  })

  ipcMain.handle(IPC.examDelete, (_e, id: string) => {
    try {
      deleteExamDir(id)
      deleteAttempt(id)
      return { ok: true }
    } catch (e) {
      logger.error('删除考试失败', e)
      return { ok: false }
    }
  })

  ipcMain.handle(IPC.examDashboard, () => {
    try {
      return buildDashboard()
    } catch (e) {
      logger.error('读取仪表盘失败', e)
      return {
        latest: null,
        recent: [],
        averageScore: null,
        bestScore: null,
        totalExams: 0,
        taskAverages: { TASK_1: null, TASK_2: null, TASK_3: null, TASK_4: null },
        trend: [],
        streakDays: 0
      }
    }
  })

  ipcMain.handle(IPC.examClearAll, () => {
    try {
      clearAllAttempts()
      return { ok: true }
    } catch (e) {
      logger.error('清空历史失败', e)
      return { ok: false }
    }
  })

  /* ============================== 音频 ============================== */
  ipcMain.handle(IPC.audioRead, (_e, p: string) => {
    const res = readRecording(p)
    if (!res.ok || !res.data) return { ok: false, error: res.error ?? '读取失败' }
    const buf = res.data
    const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return { ok: true, data: out }
  })

  ipcMain.handle(IPC.audioDelete, (_e, p: string) => {
    deleteRecording(p)
    return { ok: true }
  })

  /**
   * 题目音频：听后重复题必须让考生「听」到句子。
   * 主进程用 macOS 自带 say 离线合成并缓存，渲染层通过 file:// 之外的自定义协议播放。
   */
  ipcMain.handle(IPC.audioPrompt, async (_e, req: { text: string; voice?: string; rate?: number }) => {
    const { synthesizePromptAudio } = await import('../services/audio/promptAudio')
    return synthesizePromptAudio(req ?? { text: '' })
  })

  ipcMain.handle(IPC.audioPromptVoices, async () => {
    const { listEnglishVoices } = await import('../services/audio/promptAudio')
    return { ok: true, voices: await listEnglishVoices() }
  })

  ipcMain.handle(IPC.audioPromptClearCache, async () => {
    const { clearPromptAudioCache } = await import('../services/audio/promptAudio')
    return clearPromptAudioCache()
  })

  /** 把合成好的题目音频读成字节流，渲染层用 blob 播放（避免开自定义协议） */
  ipcMain.handle(IPC.audioReadPrompt, async (_e, p: string) => {
    try {
      const fs = await import('node:fs')
      const buf = fs.readFileSync(p)
      const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      return { ok: true, data: out, mimeType: 'audio/wav' }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  /* ============================== 报告 ============================== */
  ipcMain.handle(IPC.ocrRecognize, async (_e, image: ArrayBuffer, lang = 'eng') => {
    try {
      const buf = Buffer.from(new Uint8Array(image))
      if (buf.byteLength > 40 * 1024 * 1024) return { ok: false, text: '', error: '页面图片过大' }
      const { recognizeImage } = await import('../services/ocr')
      return await recognizeImage(buf, lang)
    } catch (e) {
      logger.error('OCR 失败', e)
      return { ok: false, text: '', error: `OCR 失败：${(e as Error).message}` }
    }
  })

  /* ============================ LLM 解析 PDF ============================ */
  // 复杂排版 / 参考答案干扰 / 扫描件的题目提取全部交给云端模型，
  // API Key 只在主进程使用，渲染进程拿不到。
  ipcMain.handle(IPC.pdfParseLlm, async (event, req: {
    pages: { page: number; text: string }[]
    concurrency?: number
  }) => {
    try {
      const settings = getRawSettings()
      if (!settings.llm.apiKey) {
        return { ok: false, error: '还没有绑定云端模型：请到「设置 → AI 评分」填入 API Key 并选择模型。' }
      }
      if (!settings.llm.model) {
        return { ok: false, error: '还没有选择模型，请到「设置 → AI 评分」选择评分模型。' }
      }
      const pages = Array.isArray(req?.pages) ? req.pages : []
      if (pages.length === 0) return { ok: false, error: '没有可解析的页面内容' }

      const sender = event.sender
      const out = await parsePagesWithLlm(pages, {
        baseUrl: settings.llm.baseUrl,
        apiKey: settings.llm.apiKey,
        model: settings.llm.model,
        temperature: 0,
        useJsonSchema: settings.llm.useJsonSchema,
        concurrency: req.concurrency,
        onProgress: (done, total, message) => {
          if (sender.isDestroyed()) return
          sender.send(IPC.pdfParseProgress, { done, total, message })
        }
      })
      return { ok: true, questions: out.questions, warnings: out.warnings, chunks: out.chunks, failedChunks: out.failedChunks }
    } catch (e) {
      logger.error('LLM 解析 PDF 失败', e)
      return { ok: false, error: `AI 解析失败：${(e as Error).message}` }
    }
  })

  ipcMain.handle(IPC.reportExport, async (_e, examId: string, studentName?: string) => {
    try {
      const attempt = getAttempt(examId)
      if (!attempt) return { ok: false, error: '找不到考试记录' }
      const outPath = defaultReportPath(getReportsDir(), attempt)
      await generateExamReport(attempt, { outPath, studentName, appVersion: app.getVersion() })
      return { ok: true, filePath: outPath }
    } catch (e) {
      logger.error('导出报告失败', e)
      return { ok: false, error: `导出报告失败：${(e as Error).message}` }
    }
  })

  ipcMain.handle(IPC.reportExportTo, async (_e, examId: string, filePath: string, studentName?: string) => {
    try {
      const attempt = getAttempt(examId)
      if (!attempt) return { ok: false, error: '找不到考试记录' }
      await generateExamReport(attempt, { outPath: filePath, studentName, appVersion: app.getVersion() })
      return { ok: true, filePath }
    } catch (e) {
      logger.error('导出报告失败', e)
      return { ok: false, error: `导出报告失败：${(e as Error).message}` }
    }
  })

  logger.info('IPC 已注册')
}

/* ------------------------------------------------------------------ */

function emitProgress(win: BrowserWindow | undefined, p: PipelineProgress): void {
  const event: PipelineProgressEvent = {
    examId: p.examId,
    stage: p.stage,
    itemIndex: p.itemIndex,
    itemTotal: p.itemTotal,
    message: p.message,
    attempt: p.attempt,
    error: p.error
  }
  try {
    win?.webContents.send(IPC.examProgress, event)
  } catch (e) {
    logger.debug('发送进度事件失败', e)
  }
}

function readPdfFile(filePath: string): OpenedFile {
  try {
    const stat = fs.statSync(filePath)
    if (stat.size > 200 * 1024 * 1024) {
      return { ok: false, error: 'PDF 文件过大（超过 200MB），请拆分后再导入' }
    }
    const buf = fs.readFileSync(filePath)
    const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    return { ok: true, filePath, fileName: path.basename(filePath), size: stat.size, data: out }
  } catch (e) {
    logger.error('读取 PDF 失败', e)
    return { ok: false, error: `无法读取该 PDF：${(e as Error).message}` }
  }
}

function modeLabel(mode: ExamMode): string {
  if (mode === 'FULL') return '完整模拟考试'
  if (mode === 'CUSTOM') return '自定义考试'
  return `${TASK_META[mode as TaskType]?.shortLabel ?? mode} 专项`
}

function buildDashboard() {
  const all = listAttempts(200)
  const scored = all.filter((a) => a.overallScore != null)
  const recent = all.slice(0, 5)
  const latest = all[0] ?? null
  const averageScore = scored.length
    ? Math.round((scored.reduce((a, x) => a + (x.overallScore ?? 0), 0) / scored.length) * 10) / 10
    : null
  const bestScore = scored.length ? Math.max(...scored.map((a) => a.overallScore ?? 0)) : null

  const taskAverages = {} as Record<TaskType, number | null>
  for (const t of TASK_TYPES) {
    const nums = all
      .flatMap((a) => a.taskScores.filter((s) => s.taskType === t).map((s) => s.rawScore))
      .filter((n): n is number => n != null)
    taskAverages[t] = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
  }

  const trend = all
    .slice()
    .sort((a, b) => a.date - b.date)
    .slice(-20)
    .map((a) => ({ date: a.date, overallScore: a.overallScore }))

  const days = new Set(all.map((a) => new Date(a.date).toDateString()))
  let streak = 0
  const cursor = new Date()
  while (days.has(cursor.toDateString())) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return {
    latest,
    recent,
    averageScore,
    bestScore,
    totalExams: all.length,
    taskAverages,
    trend,
    streakDays: streak
  }
}
