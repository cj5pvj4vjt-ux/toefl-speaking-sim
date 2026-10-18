import { z } from 'zod'

/* ------------------------------------------------------------------ */
/*                       数值清洗小工具（模型很脏）                     */
/* ------------------------------------------------------------------ */

function firstNumber(raw: unknown): unknown {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    const m = raw.match(/-?\d+(\.\d+)?/)
    if (m) return Number(m[0])
    return raw
  }
  return raw
}

/** 把任意输入变成 0-6 的 ETS 分值（2026 新版托福），并以 0.5 为步长取整 */
export function normalizeRubricScore(raw: unknown): number {
  const n = Number(firstNumber(raw))
  if (!Number.isFinite(n)) return NaN
  const clamped = Math.min(6, Math.max(0, n))
  return Math.round(clamped * 2) / 2
}

/** 0-6 的单题分（2026 新版托福） */
export const rubricScoreSchema = z.preprocess(
  (v) => normalizeRubricScore(v),
  z
    .number({ error: '分值必须是数字' })
    .refine((n) => Number.isFinite(n), { message: '分值无法解析为数字' })
    .refine((n) => n >= 0 && n <= 6, { message: '分值必须位于 0-6 之间' })
)

/** 0-1 的置信度 */
export const confidenceSchema = z.preprocess((v) => {
  const n = Number(firstNumber(v))
  if (!Number.isFinite(n)) return 0.5
  if (n > 1 && n <= 100) return Math.min(1, n / 100)
  return Math.min(1, Math.max(0, n))
}, z.number())

export function toStringArray(raw: unknown): string[] {
  if (raw == null) return []
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x ? JSON.stringify(x) : String(x)))
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (!t) return []
    return t
      .split(/\r?\n|(?<=[。．.!?！？;；])\s*|(?:^|\s)[-*•]\s*/)
      .map((s) => s.replace(/^[-*•\d.)\s]+/, '').trim())
      .filter((s) => s.length > 1)
  }
  return [String(raw)]
}

export const stringArraySchema = z.preprocess(toStringArray, z.array(z.string()))

const trimmedString = (min = 0) =>
  z.preprocess((v) => {
    if (v == null) return ''
    if (typeof v === 'string') return v.trim()
    if (Array.isArray(v)) return v.map(String).join('\n').trim()
    if (typeof v === 'object') return JSON.stringify(v)
    return String(v).trim()
  }, z.string().min(min))

/* ------------------------------------------------------------------ */
/*                     ★ 逐题评分 Schema（严格）                       */
/* ------------------------------------------------------------------ */

/**
 * 大模型被强制要求返回的固定结构。
 * 七个必需字段完全对应产品要求的 JSON 格式；
 * strengths / weaknesses / suggestions 为可选扩展（用于逐题分析 UI）。
 */
export const QuestionScoreSchema = z.preprocess((raw) => {
  // 2026 版 prompt 用的是 content，老 schema 用 topic_development，两者等价
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    if (o.topic_development == null && o.content != null) {
      return { ...o, topic_development: o.content }
    }
  }
  return raw
}, z.object({
  task: z.preprocess((v) => {
    const n = Number(firstNumber(v))
    if (!Number.isFinite(n)) return NaN
    return Math.round(n)
  }, z.number().int().min(1).max(2)),
  score: rubricScoreSchema,
  delivery: rubricScoreSchema,
  language_use: rubricScoreSchema,
  topic_development: rubricScoreSchema,
  feedback: trimmedString(1),
  confidence: confidenceSchema,
  strengths: stringArraySchema.optional().default([]),
  weaknesses: stringArraySchema.optional().default([]),
  suggestions: stringArraySchema.optional().default([]),
  /* AI 改写后的回答：保留考生原意与个人细节，只修语言与结构。
     历史数据没有这个字段，因此给默认空串，保证旧记录仍能反序列化。 */
  revised_response: trimmedString().optional().default('')
}).superRefine((v, ctx) => {
  // 只要这道题有可评估的语音（score > 0），就必须给出一份改写回答，
  // 否则报告里会出现「有分数、却没有改写回答」的空档。
  // 校验失败会走 scoreQuestion 里已有的修复重试，让模型补全。
  if (v.score > 0 && !String(v.revised_response ?? '').trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['revised_response'],
      message: '该题有有效得分，必须给出 revised_response（AI 改写后的英文回答）'
    })
  }
}))

export type QuestionScoreInput = z.input<typeof QuestionScoreSchema>
export type QuestionScoreParsed = z.output<typeof QuestionScoreSchema>

/* ------------------------------------------------------------------ */
/*                     ★ 整场考试总结 Schema（严格）                   */
/* ------------------------------------------------------------------ */

export const ExamSummarySchema = z
  .object({
    overall_feedback: trimmedString(1),
    strengths: stringArraySchema.optional().default([]),
    weaknesses: stringArraySchema.optional().default([]),
    suggestions: stringArraySchema.optional().default([]),
    recommended_practice: stringArraySchema.optional().default([]),
    estimated_level: trimmedString().optional().default('')
  })
  .superRefine((v, ctx) => {
    // 三个清单是报告的核心内容，模型漏掉时视为校验失败，
    // 由上层的「修复重试」机制让它补全，而不是生成一份空洞的报告。
    const require = (list: string[], path: string): void => {
      if (!list || list.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [path],
          message: '该字段不能为空数组，请至少给出 1 条具体内容'
        })
      }
    }
    require(v.strengths, 'strengths')
    require(v.weaknesses, 'weaknesses')
    require(v.suggestions, 'suggestions')
  })

export type ExamSummaryParsed = z.output<typeof ExamSummarySchema>

/* ------------------------------------------------------------------ */
/*                          题库 Schema                                */
/* ------------------------------------------------------------------ */

export const TaskTypeSchema = z.enum(['LISTEN_REPEAT', 'INTERVIEW'])

export const QuestionSchema = z.object({
  id: z.string().min(1),
  taskType: TaskTypeSchema,
  questionText: z.string().default(''),
  readingText: z.string().nullable().default(null),
  listeningText: z.string().nullable().default(null),
  contextText: z.string().nullable().default(null),
  referenceAnswer: z.string().nullable().default(null),
  preparationTime: z.number().nonnegative().default(15),
  responseTime: z.number().positive().default(45),
  sourcePage: z.number().nullable().default(null),
  tags: z.array(z.string()).default([]),
  parseWarnings: z.array(z.string()).default([]),
  needsReview: z.boolean().default(false),
  rawText: z.string().default('')
})

export const QuestionSetSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  sourcePdf: z.string().default(''),
  createdAt: z.number(),
  questions: z.array(QuestionSchema).default([])
})

/* ------------------------------------------------------------------ */
/*                          设置 Schema                                */
/* ------------------------------------------------------------------ */

export const LlmSettingsSchema = z.object({
  provider: z.string().default('openai-compatible'),
  baseUrl: z.string().default('https://api.openai.com/v1'),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  temperature: z.number().min(0).max(2).default(0.1),
  useJsonSchema: z.boolean().default(true)
})

export const SttSettingsSchema = z.object({
  provider: z.enum(['openai-compatible', 'local-whisper', 'none']).default('openai-compatible'),
  baseUrl: z.string().default('https://api.openai.com/v1'),
  apiKey: z.string().default(''),
  model: z.string().default('whisper-1'),
  language: z.string().default('en'),
  localBinaryPath: z.string().default(''),
  localModelPath: z.string().default('')
})

export const MicrophoneSettingsSchema = z.object({
  deviceId: z.string().default('default'),
  deviceLabel: z.string().default(''),
  inputGain: z.number().min(0).max(4).default(1)
})

export const ExamSettingsSchema = z.object({
  defaultPreparationTime: z.number().min(0).max(300).default(0),
  defaultResponseTime: z.number().min(0).max(300).default(0),
  speakListening: z.boolean().default(false),
  listeningDisplay: z.enum(['text', 'hidden']).default('text'),
  autoAdvance: z.boolean().default(true)
})

export const TtsSettingsSchema = z.object({
  provider: z.enum(['system', 'cloud']).default('cloud'),
  baseUrl: z.string().default(''),
  apiKey: z.string().default(''),
  model: z.string().default('qwen3-tts-flash'),
  voice: z.string().default('Serena'),
  systemVoice: z.string().default('Samantha'),
  speed: z.number().min(0.5).max(2).default(1.15)
})

export const AppSettingsSchema = z.object({
  llm: LlmSettingsSchema,
  stt: SttSettingsSchema,
  tts: TtsSettingsSchema,
  microphone: MicrophoneSettingsSchema,
  exam: ExamSettingsSchema
})

/* ------------------------------------------------------------------ */
/*                      OpenAI /chat/completions 响应                  */
/* ------------------------------------------------------------------ */

export const ChatCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.union([z.string(), z.null(), z.array(z.any())]).optional(),
            reasoning_content: z.string().optional(),
            refusal: z.string().nullish()
          })
          .optional(),
        text: z.string().optional(),
        finish_reason: z.string().nullish()
      })
    )
    .min(1, { message: '模型未返回任何结果' })
})

export const ModelsListSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string(),
        owned_by: z.string().optional(),
        created: z.number().optional()
      })
    )
    .optional(),
  models: z.array(z.any()).optional()
})
