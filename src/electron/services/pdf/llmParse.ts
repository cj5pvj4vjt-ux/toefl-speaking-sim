import { TASK_META } from '@shared/constants'
import { PDF_PARSE_SYSTEM_PROMPT, buildPdfParseUserPrompt } from '@shared/pdf/llmPrompt'
import { newId, normalizePageText, type PageText } from '@shared/pdf/parseQuestions'
import type { Question, TaskType } from '@shared/types'
import { chatCompletion } from '../llm/openaiCompatible'
import { logger } from '../logger'

/**
 * 用云端大模型解析真题 PDF。
 *
 * 为什么需要它：真实题库的排版千奇百怪——参考答案与题目混排、
 * 同一行里挤着好几套题、文字被逐字拆开、甚至整页是图片。
 * 规则解析只能覆盖规整的那一部分，其余交给模型语义理解。
 *
 * 工程上的要点：
 *  - 按页分块，块之间并发，单块失败不影响其他块
 *  - 每块最多重试一次；首轮用 json_schema 约束，重试轮改走提示词
 *    （部分厂商的约束解码会把长输出截断）
 *  - 合并结果时按 (题组, 题型, 正文前若干字符) 去重，处理跨页重复
 */

export interface LlmParseOptions {
  baseUrl: string
  apiKey: string
  model: string
  temperature?: number
  useJsonSchema?: boolean
  /** 并发请求数，默认 3 */
  concurrency?: number
  /** 每块最多多少字符，默认 12000 */
  chunkChars?: number
  /** 每块最多多少页，默认 8 */
  chunkPages?: number
  signal?: AbortSignal
  onProgress?: (done: number, total: number, message: string) => void
}

export interface LlmParseOutcome {
  questions: Question[]
  warnings: string[]
  chunks: number
  failedChunks: number
  usage: { promptTokens: number; completionTokens: number }
}

const VALID_TASK_TYPES: TaskType[] = ['LISTEN_REPEAT', 'INTERVIEW']

interface RawLlmQuestion {
  group?: unknown
  task_type?: unknown
  number?: unknown
  /** 屏幕上显示的场景/指令 */
  context?: unknown
  text?: unknown
  source_page?: unknown
}

/** 把模型输出里的代码围栏、前后废话剥掉，取第一个平衡的 JSON 对象 */
export function extractJsonObject(raw: string): unknown {
  const s = (raw ?? '').trim()
  if (!s) return null
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1].trim() : s

  try {
    return JSON.parse(body)
  } catch {
    /* 继续尝试截取 */
  }

  const start = body.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < body.length; i++) {
    const c = body[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1))
        } catch {
          // 常见毛病：尾随逗号
          try {
            return JSON.parse(body.slice(start, i + 1).replace(/,\s*([}\]])/g, '$1'))
          } catch {
            return null
          }
        }
      }
    }
  }
  return null
}

/**
 * 从模型输出里取出题目数组。
 *
 * 实测云端模型在 json_object 模式下有两种返回形状：
 *   1. {"questions": [ ... ]}   —— 提示词要求的形状
 *   2. [ { ... }, { ... } ]     —— 直接吐一个裸数组
 * 两种都必须认，否则会出现「明明解析成功却报没有 questions 数组」。
 */
export function extractQuestionsArray(content: string): unknown[] | null {
  const obj = extractJsonObject(content)
  if (obj && typeof obj === 'object') {
    const q = (obj as { questions?: unknown }).questions
    if (Array.isArray(q)) return q
    // 单个题目对象也接受
    if ('text' in (obj as Record<string, unknown>)) return [obj]
  }

  // 回退：扫出第一个配平的 JSON 数组
  const s = (content ?? '').trim()
  for (let start = s.indexOf('['); start >= 0; start = s.indexOf('[', start + 1)) {
    let depth = 0
    let inStr = false
    let esc = false
    for (let i = start; i < s.length; i++) {
      const ch = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (ch === '\\') esc = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === '[') depth += 1
      else if (ch === ']') {
        depth -= 1
        if (depth === 0) {
          try {
            const arr = JSON.parse(s.slice(start, i + 1))
            if (Array.isArray(arr)) return arr
          } catch {
            /* 继续找下一个 [ */
          }
          break
        }
      }
    }
  }
  return null
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function asNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** 把模型返回的一条原始记录转成 Question；不合法则返回 null */
export function toQuestion(raw: RawLlmQuestion, fallbackPage: number | null, groupFallback: string): Question | null {
  const text = asString(raw.text)
  if (text.length < 2) return null
  const tt = asString(raw.task_type).toUpperCase() as TaskType
  const taskType: TaskType = VALID_TASK_TYPES.includes(tt) ? tt : 'LISTEN_REPEAT'
  const meta = TASK_META[taskType]
  const group = asString(raw.group) || groupFallback
  // 参考答案一律不录入；context 是屏幕上显示的场景，必须与题干分开存
  const context = asString(raw.context)
  const no = asNumber(raw.number)
  const page = asNumber(raw.source_page) ?? fallbackPage
  const words = text.split(/\s+/).length

  return {
    id: newId('q'),
    taskType,
    questionText: text,
    contextText: context || null,
    readingText: null,
    listeningText: text,
    referenceAnswer: null,
    preparationTime: meta.prepTime,
    responseTime:
      taskType === 'LISTEN_REPEAT'
        ? // 官方：跟读作答时间 8 秒起，随句子变长递增到 12 秒
          words <= 8
          ? 8
          : words <= 12
            ? 10
            : 12
        : meta.responseTime,
    sourcePage: page,
    tags: [
      `group:${group}`,
      taskType === 'INTERVIEW' ? 'interview' : 'listen-repeat',
      ...(no != null ? [`no:${no}`] : []),
      'ai-parsed'
    ],
    parseWarnings: [],
    needsReview: text.length < 12,
    rawText: text
  }
}

/** 去重键：同一题组 + 同题型 + 正文前 80 个字符（只保留字母数字） */
function dedupeKey(q: Question): string {
  const group = q.tags.find((t) => t.startsWith('group:')) ?? ''
  const norm = q.questionText.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, '').slice(0, 80)
  return `${group}||${q.taskType}||${norm}`
}

/** 把页面切成多个块：同时受页数与字符数约束 */
export function chunkPages(
  pages: PageText[],
  maxChars: number,
  maxPages: number
): { pages: PageText[]; from: number; to: number }[] {
  const chunks: { pages: PageText[]; from: number; to: number }[] = []
  let buf: PageText[] = []
  let chars = 0

  const flush = (): void => {
    if (buf.length === 0) return
    chunks.push({
      pages: buf,
      from: buf[0].page,
      to: buf[buf.length - 1].page
    })
    buf = []
    chars = 0
  }

  for (const p of pages) {
    const text = normalizePageText(p.text ?? '')
    const len = text.length
    if (buf.length > 0 && (chars + len > maxChars || buf.length >= maxPages)) flush()
    buf.push({ page: p.page, text })
    chars += len
  }
  flush()
  return chunks
}

async function parseChunk(
  chunk: { pages: PageText[]; from: number; to: number },
  opts: LlmParseOptions
): Promise<{ questions: Question[]; warnings: string[]; ok: boolean }> {
  const messages = [
    { role: 'system' as const, content: PDF_PARSE_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildPdfParseUserPrompt(`第 ${chunk.from}-${chunk.to} 页`, chunk.pages) }
  ]

  const maxAttempts = 3
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    /*
     * 这里刻意只用 json_object，不发 json_schema。
     *
     * 实测：对这份题库，约束解码（json_schema）会让模型输出崩坏——
     * 要么把推理过程写进字段，要么只吐出残缺的一条记录；
     * 改成 json_object + 提示词里写死 JSON 契约后，稳定返回完整的 11 条。
     */
    const useJson = attempt === 0
    const res = await chatCompletion({
      baseUrl: opts.baseUrl,
      apiKey: opts.apiKey,
      model: opts.model,
      temperature: opts.temperature ?? 0,
      maxTokens: 8000,
      timeoutMs: 180_000,
      jsonMode: useJson,
      messages
    })

    if (!res.ok) {
      if (attempt === maxAttempts - 1) {
        return { questions: [], warnings: [`第 ${chunk.from}-${chunk.to} 页解析失败：${res.error ?? '未知错误'}`], ok: false }
      }
      continue
    }

    const list = extractQuestionsArray(res.content)
    if (!list) {
      if (attempt === maxAttempts - 1) {
        const snippet = (res.content ?? '').replace(/\s+/g, ' ').slice(0, 240)
        return {
          questions: [],
          warnings: [
            `第 ${chunk.from}-${chunk.to} 页：模型没有返回合法的 questions 数组。` +
              (snippet ? `返回片段：${snippet}` : '模型返回了空内容。')
          ],
          ok: false
        }
      }
      continue
    }

    const questions: Question[] = []
    for (const item of list) {
      const q = toQuestion((item ?? {}) as RawLlmQuestion, chunk.from, `第 ${chunk.from}-${chunk.to} 页`)
      if (q) questions.push(q)
    }

    const extra = (extractJsonObject(res.content) ?? {}) as { warnings?: unknown }
    const warnings = Array.isArray(extra.warnings)
      ? extra.warnings.filter((w): w is string => typeof w === 'string').slice(0, 5)
      : []
    return { questions, warnings, ok: true }
  }

  return { questions: [], warnings: [`第 ${chunk.from}-${chunk.to} 页解析失败`], ok: false }
}

export async function parsePagesWithLlm(
  pages: PageText[],
  opts: LlmParseOptions
): Promise<LlmParseOutcome> {
  const chunks = chunkPages(pages, opts.chunkChars ?? 12_000, opts.chunkPages ?? 8)
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 3))

  const collected: Question[] = []
  const warnings: string[] = []
  let failedChunks = 0
  let done = 0

  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      if (opts.signal?.aborted) return
      const idx = cursor++
      if (idx >= chunks.length) return
      const chunk = chunks[idx]
      try {
        const r = await parseChunk(chunk, opts)
        if (!r.ok) failedChunks++
        collected.push(...r.questions)
        warnings.push(...r.warnings)
      } catch (e) {
        failedChunks++
        warnings.push(`第 ${chunk.from}-${chunk.to} 页解析异常：${(e as Error).message}`)
        logger.warn('LLM PDF 解析块异常', e)
      }
      done++
      opts.onProgress?.(done, chunks.length, `已解析 ${done}/${chunks.length} 段（第 ${chunk.from}-${chunk.to} 页）`)
    }
  }

  opts.onProgress?.(0, chunks.length, `准备解析 ${chunks.length} 段…`)
  await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker()))

  // 跨块去重：同一题可能因为分块被解析两次
  const seen = new Map<string, Question>()
  for (const q of collected) {
    const key = dedupeKey(q)
    const prev = seen.get(key)
    if (!prev) {
      seen.set(key, q)
      continue
    }
    // 保留信息更全的那条
    const prevLen = (prev.referenceAnswer?.length ?? 0) + prev.questionText.length
    const nextLen = (q.referenceAnswer?.length ?? 0) + q.questionText.length
    if (nextLen > prevLen) seen.set(key, q)
  }

  const questions = [...seen.values()]
  const withRef = questions.filter((q) => q.referenceAnswer).length

  return {
    questions,
    warnings: [...new Set(warnings)],
    chunks: chunks.length,
    failedChunks,
    usage: { promptTokens: 0, completionTokens: 0 }
  }
}
