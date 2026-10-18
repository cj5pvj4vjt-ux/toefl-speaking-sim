import { z } from 'zod'
import { parseLooseJson } from '@shared/parsing/json'
import { ExamSummarySchema, QuestionScoreSchema } from '@shared/schemas'
import { estimateLevel, taskIndex } from '@shared/scoring/convert'
import {
  EXAM_SUMMARY_SYSTEM_PROMPT,
  TOEFL_SCORING_SYSTEM_PROMPT,
  buildExamSummaryUserPrompt,
  buildRepairUserPrompt,
  buildScoringUserPrompt,
  type ScoringPromptInput
} from '@shared/scoring/prompts'
import type { ExamSummary, QuestionScore, ScoreQuestionResult } from '@shared/types'
import { chatCompletion, type ChatOptions, type ChatResult } from '../llm/openaiCompatible'
import { logger } from '../logger'

/**
 * Scoring Engine
 *
 *   Audio → STT → Transcript → Prompt → Cloud LLM → Strict JSON → Zod → Score
 *
 * 设计要点：
 *  1. Prompt 完全由 App 内部生成，用户不可见、不可编辑。
 *  2. temperature 尽可能低（默认 0.1）。
 *  3. 优先使用 response_format: json_schema，不支持时降级为 json_object，
 *     再降级为纯 Prompt 约束。
 *  4. 返回内容一律先做宽松 JSON 抽取，再交给 Zod 严格校验。
 *  5. 校验失败会发起一次「修复」请求；仍失败则返回结构化错误，绝不让 App 崩溃。
 */

export interface ScoringEngineConfig {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  useJsonSchema?: boolean
  /** 自定义评分配置的额外 system 提示（默认不使用） */
  maxRepairAttempts?: number
}

export type ChatFn = (opts: ChatOptions) => Promise<ChatResult>

const defaultChat: ChatFn = chatCompletion

/** 从 Zod schema 生成 JSON Schema（用于 response_format: json_schema） */
function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> | null {
  try {
    const toJSON = (z as unknown as { toJSONSchema?: (s: unknown, o?: unknown) => unknown }).toJSONSchema
    if (typeof toJSON === 'function') {
      const out = toJSON(schema, { target: 'draft-07', io: 'input' })
      if (out && typeof out === 'object') return out as Record<string, unknown>
    }
  } catch (e) {
    logger.debug('无法生成 JSON Schema，忽略', e)
  }
  return null
}

const QUESTION_SCORE_JSON_SCHEMA = jsonSchemaFor(QuestionScoreSchema)
const EXAM_SUMMARY_JSON_SCHEMA = jsonSchemaFor(ExamSummarySchema)

export function validateQuestionScore(value: unknown): {
  ok: boolean
  data?: QuestionScore
  error?: string
} {
  const parsed = QuestionScoreSchema.safeParse(value)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    return { ok: false, error: issues }
  }
  return { ok: true, data: parsed.data as QuestionScore }
}

export function validateExamSummary(value: unknown): {
  ok: boolean
  data?: ExamSummary
  error?: string
} {
  const parsed = ExamSummarySchema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  }
  return { ok: true, data: parsed.data as ExamSummary }
}

/* ------------------------------------------------------------------ */
/*                            逐题评分                                 */
/* ------------------------------------------------------------------ */

export async function scoreQuestion(
  input: ScoringPromptInput,
  cfg: ScoringEngineConfig,
  deps: { chat?: ChatFn } = {}
): Promise<ScoreQuestionResult> {
  const chat = deps.chat ?? defaultChat
  // 推理型模型偶尔会先输出一段说明文字，留 2 次修复机会显著提升成功率
  const maxRepair = cfg.maxRepairAttempts ?? 2

  if (!cfg.model) {
    return { ok: false, error: '尚未在「设置 → AI 评分」中选择模型，无法评分。录音与文字稿已保存。' }
  }

  const userPrompt = buildScoringUserPrompt(input)
  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: TOEFL_SCORING_SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ]

  let lastRaw = ''
  let lastError = ''

  for (let attempt = 0; attempt <= maxRepair; attempt++) {
    // 首轮使用 json_schema 强约束；修复轮改为纯 Prompt 约束。
    // 原因：部分厂商在 json_schema 模式下的约束解码会提前截断输出（只吐前几个字段），
    // 用同样的约束重试会复现同样的问题，放开约束才能真正补全。
    const useJson = cfg.useJsonSchema !== false && attempt === 0
    const res = await chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      temperature: cfg.temperature ?? 0.1,
      maxTokens: 2600,
      timeoutMs: 180000,
      jsonMode: useJson,
      jsonSchema:
        useJson && QUESTION_SCORE_JSON_SCHEMA
          ? { name: 'toefl_speaking_question_score', schema: QUESTION_SCORE_JSON_SCHEMA }
          : undefined
    })

    if (!res.ok) {
      // 网络 / 鉴权类错误直接返回，不做「修复」重试
      return { ok: false, error: res.error ?? 'AI 请求失败', raw: res.raw, attempts: attempt + 1 }
    }

    lastRaw = res.content
    const extracted = parseLooseJson(res.content)
    if (!extracted.ok) {
      lastError = `返回内容不是合法 JSON（${extracted.error}）`
    } else {
      // 题号以 App 侧题目为准，避免模型把 Task 2 写成 Task 1/9
      const payload = { ...(extracted.value as Record<string, unknown>) }
      payload.task = taskIndex(input.taskType)
      const validated = validateQuestionScore(payload)
      if (validated.ok) {
        return { ok: true, score: validated.data, attempts: attempt + 1 }
      }
      lastError = `返回 JSON 不符合评分结构（${validated.error}）`
    }

    logger.warn(`评分结果校验失败（第 ${attempt + 1} 次）：${lastError}`)

    if (attempt < maxRepair) {
      messages.push({ role: 'assistant', content: res.content.slice(0, 2000) })
      messages.push({ role: 'user', content: buildRepairUserPrompt(res.content, lastError) })
    }
  }

  return {
    ok: false,
    error: `AI 评分结果格式错误，请重试。（${lastError}）`,
    raw: lastRaw.slice(0, 600),
    attempts: maxRepair + 1
  }
}

/* ------------------------------------------------------------------ */
/*                          整场考试总结                               */
/* ------------------------------------------------------------------ */

export async function scoreExamSummary(
  payload: Parameters<typeof buildExamSummaryUserPrompt>[0],
  cfg: ScoringEngineConfig,
  deps: { chat?: ChatFn } = {}
): Promise<{ ok: boolean; summary?: ExamSummary; error?: string }> {
  const chat = deps.chat ?? defaultChat
  if (!cfg.model) return { ok: false, error: '尚未配置评分模型' }

  const baseMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: EXAM_SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: buildExamSummaryUserPrompt(payload) }
  ]

  let lastError = ''
  for (let attempt = 0; attempt <= 2; attempt++) {
    // 同 scoreQuestion：修复轮放开 json_schema 约束以避免厂商截断输出
    const useJson = cfg.useJsonSchema !== false && attempt === 0

    // 关键：重试时「重新完整提问」，而不是把上一次的残缺 JSON 塞回上下文。
    // 否则模型会锚定在自己那段不完整的输出上，每次都只补到同一个地方就停。
    const messages =
      attempt === 0
        ? baseMessages
        : [
            baseMessages[0],
            baseMessages[1],
            {
              role: 'user' as const,
              content:
                `上一次的回答不可用：${lastError}\n` +
                '请从头重新输出一个完整的 JSON 对象。必须包含 overall_feedback、strengths、weaknesses、' +
                'suggestions、recommended_practice、estimated_level 六个字段，' +
                '其中 strengths / weaknesses / suggestions / recommended_practice 四个数组各至少 1 条内容。'
            }
          ]

    const res = await chat({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      model: cfg.model,
      messages,
      temperature: Math.min(cfg.temperature ?? 0.1, 0.3),
      maxTokens: 2000,
      timeoutMs: 180000,
      jsonMode: useJson,
      jsonSchema:
        useJson && EXAM_SUMMARY_JSON_SCHEMA
          ? { name: 'toefl_speaking_exam_summary', schema: EXAM_SUMMARY_JSON_SCHEMA }
          : undefined
    })
    if (!res.ok) return { ok: false, error: res.error ?? 'AI 请求失败' }

    const extracted = parseLooseJson(res.content)
    if (extracted.ok) {
      const validated = validateExamSummary(extracted.value)
      if (validated.ok) {
        return { ok: true, summary: fillSummaryGaps(validated.data as ExamSummary, payload.estimatedScore) }
      }
      lastError = validated.error ?? ''
    } else {
      lastError = extracted.error ?? ''
    }
  }
  return { ok: false, error: `AI 总结结果格式错误：${lastError}` }
}

/**
 * 补齐模型偶尔漏掉的字段。
 * 只做「从已有内容派生」和「用本地算法兜底」，不凭空编造评价标准。
 */
function fillSummaryGaps(summary: ExamSummary, estimatedScore: number | null): ExamSummary {
  const out: ExamSummary = {
    overall_feedback: summary.overall_feedback,
    strengths: [...(summary.strengths ?? [])],
    weaknesses: [...(summary.weaknesses ?? [])],
    suggestions: [...(summary.suggestions ?? [])],
    recommended_practice: [...(summary.recommended_practice ?? [])],
    estimated_level: summary.estimated_level
  }
  // 推荐练习方向缺失时，由模型给出的改进建议派生
  if (out.recommended_practice.length === 0 && out.suggestions.length > 0) {
    out.recommended_practice = out.suggestions.slice(0, 4)
  }
  if (!out.estimated_level?.trim()) {
    out.estimated_level = estimateLevel(estimatedScore)
  }
  return out
}

/**
 * 当 AI 总结失败时的本地兜底：用逐题数据生成一份可靠的总结，
 * 保证用户无论如何都能拿到报告。
 */
export function buildLocalFallbackSummary(
  items: {
    taskNumber: number
    score: number | null
    delivery: number | null
    languageUse: number | null
    topicDevelopment: number | null
    transcript: string
  }[],
  estimatedScore: number | null
): ExamSummary {
  const dims = {
    表达与流利度: avg(items.map((i) => i.delivery)),
    语言运用: avg(items.map((i) => i.languageUse)),
    内容展开: avg(items.map((i) => i.topicDevelopment))
  }
  const entries = Object.entries(dims).sort((a, b) => a[1] - b[1])
  const weakest = entries[0]
  const strongest = entries[entries.length - 1]
  const wordCounts = items.map((i) => i.transcript.split(/\s+/).filter(Boolean).length)
  const avgWords = wordCounts.length ? Math.round(wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length) : 0

  const weaknesses: string[] = []
  const suggestions: string[] = []
  // 6 分制下的「偏弱 / 稳定」阈值：约为满分的 75%
  const WEAK = 4.5
  if (weakest[1] < WEAK) {
    weaknesses.push(`${weakest[0]}偏弱（平均 ${weakest[1].toFixed(1)}/6）`)
    suggestions.push(`针对${weakest[0]}做 3 次专项练习并回听录音`)
  }
  if (avgWords > 0 && avgWords < 100) {
    weaknesses.push(`每题平均仅 ${avgWords} 词，信息量不足`)
    suggestions.push('练习在 45 秒内稳定输出 110 词以上')
  }
  if (items.some((i) => i.taskNumber >= 2) && dims['内容展开'] < WEAK) {
    weaknesses.push('面试题的内容展开不充分，缺少具体细节与例证')
    suggestions.push('Take an Interview 按「直接回答 → 具体细节 → 收尾」三段结构练习')
  }
  if (weaknesses.length === 0) weaknesses.push('暂未发现明显短板，保持稳定即可')

  return {
    overall_feedback:
      `本次共完成 ${items.length} 道题，估算得分 ${estimatedScore ?? '--'}/6。` +
      `三项维度中「${strongest[0]}」表现最好（平均 ${strongest[1].toFixed(1)}/6），` +
      `「${weakest[0]}」相对薄弱（平均 ${weakest[1].toFixed(1)}/6）。` +
      `建议优先巩固薄弱维度，再进行整套限时模考。（本总结由本地规则生成，未调用 AI）`,
    strengths: strongest[1] >= WEAK ? [`${strongest[0]}表现稳定（${strongest[1].toFixed(1)}/6）`] : [],
    weaknesses,
    suggestions,
    recommended_practice: [
      'Daily: 1 组 Listen and Repeat（7 题连做，练准确复述）',
      'Daily: 1 组 Take an Interview（4 题，每题 45 秒，先列要点再展开）',
      'Weekly: 完整一套 11 题模考一次，并对比历史趋势'
    ],
    estimated_level: estimateLevel(estimatedScore)
  }
}

export { estimateLevel }

function avg(list: (number | null)[]): number {
  const v = list.filter((x): x is number => x != null && Number.isFinite(x))
  if (!v.length) return 0
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
}
