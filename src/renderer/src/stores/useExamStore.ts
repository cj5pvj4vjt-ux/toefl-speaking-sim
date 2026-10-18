import { create } from 'zustand'
import { TASK_META } from '@shared/constants'
import type { ExamAttempt } from '@shared/types'
import { api, errorMessage } from '../lib/api'
import { describeMicError, startRecording, type RecordingHandle } from '../lib/recorder'
import { useSettingsStore } from './useSettingsStore'

/**
 * 考试会话状态机（完全模拟真实 TOEFL Speaking 流程）
 *
 *   brief（题目说明，手动开始）
 *     → prep（准备倒计时，无任何按钮）
 *     → response（自动开始录音 + 倒计时，无任何按钮）
 *     → saving → 下一题 brief …
 *     → processing（STT + AI 评分）
 *     → done
 *
 * 考试进行中不提供任何可以「暂停 / 回退 / 修改题目」的入口，
 * 避免误操作，贴近真实考场。
 */

export type ExamPhase = 'idle' | 'brief' | 'prep' | 'response' | 'saving' | 'processing' | 'done' | 'error'

interface ExamSessionState {
  attempt: ExamAttempt | null
  phase: ExamPhase
  index: number
  remaining: number
  totalForPhase: number
  micLevel: number
  elapsedMs: number
  error: string | null
  errorCode: string | null
  message: string
  savedPaths: Record<number, string>
  lastRecordingBytes: number

  begin: (attempt: ExamAttempt) => void
  startPrep: () => void
  startResponse: () => void
  stopResponse: () => Promise<void>
  skipQuestion: () => Promise<void>
  runPipeline: () => Promise<void>
  abort: (reason?: string) => void
  reset: () => void
}

let loopId: ReturnType<typeof setInterval> | null = null
let phaseStart = 0
let recorder: RecordingHandle | null = null
let stopping = false
let unsubscribe: (() => void) | null = null

function stopLoop(): void {
  if (loopId != null) {
    clearInterval(loopId)
    loopId = null
  }
}

/**
 * 考试计时循环。
 *
 * 刻意使用 setInterval + 墙钟时间（Date.now），而不是 requestAnimationFrame：
 * rAF 在窗口被遮挡、最小化或切到后台时会被 Chromium 完全暂停，
 * 一旦发生，倒计时会永久冻结、录音永不停止——对限时考试是致命的。
 * 配合 BrowserWindow 的 backgroundThrottling:false，窗口在后台也能正常计时。
 *
 * 用墙钟而不是「累加间隔」同样重要：系统睡眠或严重卡顿后，
 * 仍能算出正确的剩余时间，而不是慢慢补帧。
 */
function startLoop(): void {
  stopLoop()
  phaseStart = Date.now()
  const loop = (): void => {
    const st = useExamStore.getState()
    if (st.phase !== 'prep' && st.phase !== 'response') {
      stopLoop()
      return
    }
    const elapsed = (Date.now() - phaseStart) / 1000
    const remaining = Math.max(0, st.totalForPhase - elapsed)
    useExamStore.setState({
      remaining,
      micLevel: recorder ? recorder.level() : 0,
      elapsedMs: recorder ? recorder.elapsedMs() : 0
    })
    if (remaining <= 0) {
      stopLoop()
      if (st.phase === 'prep') void st.startResponse()
      else void st.stopResponse()
    }
  }
  loop()
  loopId = setInterval(loop, 80)
}

export const useExamStore = create<ExamSessionState>((set, get) => ({
  attempt: null,
  phase: 'idle',
  index: 0,
  remaining: 0,
  totalForPhase: 0,
  micLevel: 0,
  elapsedMs: 0,
  error: null,
  errorCode: null,
  message: '',
  savedPaths: {},
  lastRecordingBytes: 0,

  begin: (attempt) => {
    stopLoop()
    recorder?.abort()
    recorder = null
    set({
      attempt,
      phase: 'brief',
      index: 0,
      remaining: 0,
      totalForPhase: 0,
      error: null,
      errorCode: null,
      message: '',
      savedPaths: {},
      micLevel: 0,
      elapsedMs: 0
    })
  },

  startPrep: () => {
    const { attempt, index } = get()
    const item = attempt?.attempts[index]
    if (!item) return
    const prep = item.questionSnapshot.preparationTime || 0
    set({ phase: 'prep', totalForPhase: prep, remaining: prep, error: null, errorCode: null })
    if (prep <= 0) {
      void get().startResponse()
      return
    }
    startLoop()
  },

  startResponse: async () => {
    const { attempt, index } = get()
    const item = attempt?.attempts[index]
    if (!item) return
    const settings = useSettingsStore.getState().settings
    const total = item.questionSnapshot.responseTime || 45

    recorder?.abort()
    recorder = null
    stopping = false

    try {
      recorder = await startRecording({
        deviceId: settings?.microphone.deviceId,
        inputGain: settings?.microphone.inputGain ?? 1
      })
    } catch (e) {
      const micErr = e instanceof Error && 'code' in e ? (e as ReturnType<typeof describeMicError>) : null
      const code = micErr && 'code' in micErr ? String((micErr as { code: string }).code) : 'unknown'
      set({
        phase: 'error',
        error: describeMicError(e).message,
        errorCode: code
      })
      return
    }

    set({ phase: 'response', totalForPhase: total, remaining: total, micLevel: 0, elapsedMs: 0 })
    startLoop()
  },

  stopResponse: async () => {
    if (stopping) return
    stopping = true
    stopLoop()

    const { attempt, index, savedPaths } = get()
    const item = attempt?.attempts[index]
    if (!item) {
      stopping = false
      return
    }

    set({ phase: 'saving', message: '正在保存录音…', micLevel: 0 })

    const settings = useSettingsStore.getState().settings
    const occurrence = (attempt?.attempts ?? [])
      .slice(0, index)
      .filter((a) => a.taskType === item.taskType).length

    try {
      if (!recorder) throw new Error('录音未启动')
      const result = await recorder.stop()
      recorder = null

      if (result.byteLength < 800) {
        set({
          phase: 'error',
          error: '录音时间过短或没有采集到音频，本题将没有有效回答。',
          errorCode: 'too-short'
        })
        stopping = false
        return
      }

      const data = await result.blob.arrayBuffer()
      const saveRes = await api.exams.saveRecording({
        examId: attempt!.id,
        order: item.order,
        taskType: item.taskType,
        occurrence,
        mimeType: result.mimeType,
        durationMs: Math.round(result.durationMs),
        data
      })

      const nextPaths = { ...savedPaths }
      if (saveRes.ok && saveRes.audioPath) {
        nextPaths[item.order] = saveRes.audioPath
        set({ savedPaths: nextPaths, lastRecordingBytes: result.byteLength })
      } else {
        set({
          phase: 'error',
          error: `录音保存失败：${saveRes.ok ? '主进程未返回保存结果' : (saveRes.error ?? '未知错误')}。请重试，或跳过本题（不影响其他题目）。`,
          errorCode: 'save-failed'
        })
        stopping = false
        return
      }
    } catch (e) {
      recorder = null
      set({
        phase: 'error',
        error: `录音处理失败：${errorMessage(e)}`,
        errorCode: 'record-failed'
      })
      stopping = false
      return
    }

    stopping = false

    // 进入下一题或结束
    const nextIndex = get().index + 1
    if (attempt && nextIndex < attempt.attempts.length) {
      set({ index: nextIndex, phase: 'brief', remaining: 0, totalForPhase: 0, micLevel: 0, elapsedMs: 0 })
    } else {
      await get().runPipeline()
    }
  },

  skipQuestion: async () => {
    const { attempt, index } = get()
    if (!attempt) return
    recorder?.abort()
    recorder = null
    stopping = false
    const nextIndex = index + 1
    if (nextIndex < attempt.attempts.length) {
      set({ index: nextIndex, phase: 'brief', error: null, errorCode: null, micLevel: 0, elapsedMs: 0 })
    } else {
      await get().runPipeline()
    }
  },

  runPipeline: async () => {
    const attempt = get().attempt
    if (!attempt) return
    stopLoop()
    set({ phase: 'processing', message: '正在转写并评分…', micLevel: 0, error: null, errorCode: null })

    unsubscribe?.()
    unsubscribe = api.exams.onProgress((p) => {
      set({ message: p.message, attempt: p.attempt ?? get().attempt })
    })

    try {
      const res = await api.exams.finish(attempt.id)
      if (res.ok && res.attempt) {
        set({ attempt: res.attempt, phase: 'done', message: '处理完成' })
      } else {
        set({
          phase: 'error',
          error: res.ok ? '主进程未返回考试结果' : (res.error ?? '评分流程失败'),
          errorCode: 'pipeline',
          message: ''
        })
      }
    } catch (e) {
      set({ phase: 'error', error: errorMessage(e), errorCode: 'pipeline' })
    } finally {
      unsubscribe?.()
      unsubscribe = null
    }
  },

  abort: (reason?: string) => {
    stopLoop()
    recorder?.abort()
    recorder = null
    stopping = false
    unsubscribe?.()
    unsubscribe = null
    set({
      phase: reason ? 'error' : 'idle',
      error: reason ?? null,
      errorCode: reason ? 'aborted' : null,
      micLevel: 0
    })
  },

  reset: () => {
    stopLoop()
    recorder?.abort()
    recorder = null
    stopping = false
    unsubscribe?.()
    unsubscribe = null
    set({
      attempt: null,
      phase: 'idle',
      index: 0,
      remaining: 0,
      totalForPhase: 0,
      micLevel: 0,
      elapsedMs: 0,
      error: null,
      errorCode: null,
      message: '',
      savedPaths: {},
      lastRecordingBytes: 0
    })
  }
}))

export function currentItem(): {
  taskLabel: string
  taskIndex: number
  questionNumber: number
  total: number
} {
  const st = useExamStore.getState()
  const item = st.attempt?.attempts[st.index]
  if (!item) return { taskLabel: '--', taskIndex: 0, questionNumber: 0, total: 0 }
  return {
    taskLabel: TASK_META[item.taskType].shortLabel,
    taskIndex: TASK_META[item.taskType].index,
    questionNumber: st.index + 1,
    total: st.attempt?.attempts.length ?? 0
  }
}
