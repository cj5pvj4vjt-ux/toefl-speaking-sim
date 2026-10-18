import { TASK_META } from '@shared/constants'
import { buildTaskScoreEntries, computeOverall } from '@shared/scoring/convert'
import type { ExamAttempt, QuestionAttempt } from '@shared/types'
import { getAttempt, saveAttempt } from '@database/repositories'
import { logger } from '../logger'
import { getRawSettings } from '../settingsStore'
import { audioExists } from '../audioStorage'
import { transcribeWithSettings } from '../stt'
import { buildLocalFallbackSummary, scoreExamSummary, scoreQuestion } from '../scoring/engine'

/**
 * 考试后处理流水线：
 *   Audio → STT → Transcript → Scoring Prompt → Cloud LLM → Strict JSON → Zod → Score → 汇总
 *
 * 任何一步失败都不会中断整场处理：错误被记录在对应题目上，用户可稍后「重新分析」。
 */

export type PipelineStage = 'idle' | 'stt' | 'scoring' | 'summary' | 'done'

export interface PipelineProgress {
  examId: string
  stage: PipelineStage
  itemIndex: number
  itemTotal: number
  message: string
  attempt?: ExamAttempt
  error?: string
}

export type ProgressEmitter = (p: PipelineProgress) => void

export interface RunOptions {
  /** 仅补做转写，不调用 LLM 评分 */
  transcribeOnly?: boolean
  /** 强制重做已有结果 */
  force?: boolean
  /** 强制重新生成总结 */
  regenerateSummary?: boolean
}

export async function runAnalysis(
  examId: string,
  emit: ProgressEmitter,
  opts: RunOptions = {}
): Promise<ExamAttempt | null> {
  const attempt = getAttempt(examId)
  if (!attempt) {
    emit({ examId, stage: 'done', itemIndex: 0, itemTotal: 0, message: '找不到该考试记录', error: '未找到记录' })
    return null
  }

  const settings = getRawSettings()
  const errors: string[] = []
  const total = attempt.attempts.length

  const base = (message: string, stage: PipelineStage, i: number): PipelineProgress => ({
    examId,
    stage,
    itemIndex: i,
    itemTotal: total,
    message,
    attempt
  })

  emit(base('开始处理录音与评分…', 'stt', 0))

  for (let i = 0; i < attempt.attempts.length; i++) {
    const item = attempt.attempts[i]
    const label = `${TASK_META[item.taskType].shortLabel}（第 ${i + 1}/${total} 题）`

    /* ------------------------- 1. STT ------------------------- */
    const needStt =
      (opts.force || !item.transcript || !item.transcript.trim()) &&
      !!item.audioPath &&
      audioExists(item.audioPath) &&
      settings.stt.provider !== 'none'

    if (needStt) {
      emit(base(`${label} 语音转文字中…`, 'stt', i))
      try {
        const res = await transcribeWithSettings(item.audioPath!, settings.stt)
        if (res.ok) {
          item.transcript = res.text
          item.sttError = null
        } else {
          item.sttError = res.error ?? '语音转写失败'
          errors.push(`${label} 转写失败：${item.sttError}`)
          logger.warn(`转写失败 ${label}: ${item.sttError}`)
        }
      } catch (e) {
        item.sttError = `语音转写异常：${(e as Error).message}`
        errors.push(`${label} ${item.sttError}`)
      }
    } else if (!item.audioPath || !audioExists(item.audioPath)) {
      item.sttError = item.sttError ?? '没有可用的录音文件'
    }

    /* ------------------------ 2. 评分 ------------------------ */
    if (!opts.transcribeOnly) {
      const needScore = (opts.force || !item.score) && !!item.transcript?.trim()
      if (needScore) {
        emit(base(`${label} AI 评分中…`, 'scoring', i))
        try {
          const result = await scoreQuestion(
            {
              taskType: item.taskType,
              questionText: item.questionSnapshot?.questionText ?? '',
              readingText: item.questionSnapshot?.readingText ?? null,
              listeningText: item.questionSnapshot?.listeningText ?? null,
              transcript: item.transcript ?? '',
              durationMs: item.durationMs,
              wordCount: (item.transcript ?? '').split(/\s+/).filter(Boolean).length
            },
            {
              baseUrl: settings.llm.baseUrl,
              apiKey: settings.llm.apiKey,
              model: settings.llm.model,
              temperature: settings.llm.temperature,
              useJsonSchema: settings.llm.useJsonSchema
            }
          )
          if (result.ok && result.score) {
            // 强制与题目实际 Task 编号一致，防止模型串号
            item.score = { ...result.score, task: TASK_META[item.taskType].index }
            item.scoreError = null
          } else {
            item.scoreError = result.error ?? 'AI 评分失败'
            errors.push(`${label} 评分失败：${item.scoreError}`)
          }
        } catch (e) {
          item.scoreError = `AI 评分异常：${(e as Error).message}`
          errors.push(`${label} ${item.scoreError}`)
        }
      } else if (!item.transcript?.trim()) {
        item.scoreError = item.sttError ? '因缺少文字稿未评分' : '没有文字稿，无法评分'
      }
    }

    saveAttempt(attempt)
    emit(base(`${label} 处理完成`, 'scoring', i))
  }

  /* ------------------------ 3. 汇总 ------------------------ */
  const entries = buildTaskScoreEntries(
    attempt.attempts.map((a) => ({ taskType: a.taskType, score: a.score }))
  )
  const { overall, rawAverage } = computeOverall(entries, attempt.mode)
  attempt.taskScores = entries
  attempt.overallScore = overall
  attempt.rawTotal = rawAverage

  const needSummary =
    !opts.transcribeOnly && (opts.force || opts.regenerateSummary || !attempt.summary) && attempt.attempts.some((a) => a.score)

  if (needSummary) {
    emit(base('生成整体 AI 总结…', 'summary', total))
    const payload = {
      estimatedScore: overall,
      rawAverage,
      mode: attempt.mode,
      items: attempt.attempts.map((a) => ({
        taskNumber: TASK_META[a.taskType].index,
        taskType: a.taskType,
        score: a.score?.score ?? null,
        delivery: a.score?.delivery ?? null,
        languageUse: a.score?.language_use ?? null,
        topicDevelopment: a.score?.topic_development ?? null,
        transcript: a.transcript ?? '',
        question: a.questionSnapshot?.questionText ?? ''
      }))
    }
    try {
      const res = await scoreExamSummary(payload, {
        baseUrl: settings.llm.baseUrl,
        apiKey: settings.llm.apiKey,
        model: settings.llm.model,
        temperature: settings.llm.temperature,
        useJsonSchema: settings.llm.useJsonSchema
      })
      if (res.ok && res.summary) {
        attempt.summary = res.summary
      } else {
        attempt.summary = buildLocalFallbackSummary(payload.items, overall)
        errors.push(`AI 总结失败，已使用本地规则生成：${res.error ?? ''}`)
      }
    } catch (e) {
      attempt.summary = buildLocalFallbackSummary(payload.items, overall)
      errors.push(`AI 总结异常，已使用本地规则生成：${(e as Error).message}`)
    }
  }

  attempt.pendingErrors = errors
  attempt.status = attempt.attempts.every((a) => a.score) ? 'COMPLETED' : attempt.attempts.some((a) => a.score) ? 'PARTIAL' : 'DRAFT'

  saveAttempt(attempt)
  emit({
    examId,
    stage: 'done',
    itemIndex: total,
    itemTotal: total,
    message: errors.length ? `处理完成，但有 ${errors.length} 个问题需要处理` : '处理完成',
    attempt
  })
  return attempt
}

/** 计算考试统计（供仪表盘使用） */
export function summarize(attempt: ExamAttempt): {
  scoredCount: number
  totalCount: number
} {
  const scored = attempt.attempts.filter((a: QuestionAttempt) => !!a.score).length
  return { scoredCount: scored, totalCount: attempt.attempts.length }
}
