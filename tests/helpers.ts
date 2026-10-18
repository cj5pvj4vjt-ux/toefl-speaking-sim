import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { TASK_META } from '@shared/constants'
import { buildTaskScoreEntries } from '@shared/scoring/convert'
import type {
  ExamAttempt,
  ExamMode,
  ExamSummary,
  Question,
  QuestionAttempt,
  QuestionScore,
  QuestionSet,
  TaskType
} from '@shared/types'

/**
 * 读取真实真题库 PDF 的页面文本。
 *
 * 必须把 pdf.js 的**原始 item** 交给 buildPageText（含 hasEOL）：
 * 手工映射成 {str,transform,width,height} 会丢掉 hasEOL，
 * 行切分结果会和 App 不一致。
 */
const pageCache = new Map<string, { page: number; text: string }[]>()
const parseCache = new Map<string, Question[]>()

export async function loadRealPdfPages(file?: string): Promise<{ page: number; text: string }[]> {
  const { buildPageText } = await import('@shared/pdf/pageText')
  const target = file ?? path.resolve(__dirname, '../samples/real-tpo-0826.pdf')
  if (!fs.existsSync(target)) return []
  // 164 页解析一次要 1 秒多，多个断言共用同一份结果
  const hit = pageCache.get(target)
  if (hit) return hit
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(target)), useSystemFonts: false })
  const doc = await task.promise
  const pages: { page: number; text: string }[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push({ page: i, text: buildPageText(content.items as never[]) })
    page.cleanup()
  }
  await task.destroy?.()
  pageCache.set(target, pages)
  return pages
}

/** 直接拿到真实真题库解析出来的题目（同样缓存） */
export async function parseRealPdf(file?: string): Promise<Question[]> {
  const key = file ?? 'default'
  const hit = parseCache.get(key)
  if (hit) return hit
  const { parseQuestionsFromPages } = await import('@shared/pdf/parseQuestions')
  const pages = await loadRealPdfPages(file)
  if (pages.length === 0) return []
  const questions = parseQuestionsFromPages(pages).questions
  parseCache.set(key, questions)
  return questions
}

/** 创建一个隔离的临时目录，测试结束后自动清理 */
export function tempDir(prefix = 'toefl-test-'): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

let seq = 0
export function makeQuestion(over: Partial<Question> & { taskType: TaskType }): Question {
  const meta = TASK_META[over.taskType]
  seq += 1
  return {
    id: over.id ?? `q-${seq}`,
    taskType: over.taskType,
    questionText: over.questionText ?? `Sample question text for ${over.taskType}?`,
    contextText: over.contextText ?? null,
    readingText: over.readingText ?? null,
    listeningText: over.listeningText ?? null,
    referenceAnswer: over.referenceAnswer ?? null,
    preparationTime: over.preparationTime ?? meta.prepTime,
    responseTime: over.responseTime ?? meta.responseTime,
    sourcePage: over.sourcePage ?? 1,
    tags: over.tags ?? ['group:Test 1'],
    parseWarnings: over.parseWarnings ?? [],
    needsReview: over.needsReview ?? false,
    rawText: over.rawText ?? ''
  }
}

/** 从 tags 中取出题组标记 */
export function groupOf(q: Question): string {
  return q.tags.find((t) => t.startsWith('group:')) ?? 'group:未分组'
}

export function makeQuestionSet(over: Partial<QuestionSet> = {}): QuestionSet {
  // 2026 新版托福口语一整套 = 7 题听后重复 + 4 题虚拟面试
  const defaultTypes: TaskType[] = [
    ...Array<TaskType>(7).fill('LISTEN_REPEAT'),
    ...Array<TaskType>(4).fill('INTERVIEW')
  ]
  const questions = over.questions ?? defaultTypes.map((t) => makeQuestion({ taskType: t }))
  return {
    id: over.id ?? `set-${crypto.randomUUID()}`,
    title: over.title ?? 'TPO 74 Speaking',
    sourcePdf: over.sourcePdf ?? '/tmp/tpo74.pdf',
    createdAt: over.createdAt ?? Date.now(),
    questions,
    importStats: over.importStats
  }
}

export function makeScore(over: Partial<QuestionScore> = {}): QuestionScore {
  const score = over.score ?? 3
  return {
    task: over.task ?? 1,
    score,
    delivery: over.delivery ?? score,
    language_use: over.language_use ?? score,
    topic_development: over.topic_development ?? score,
    feedback: over.feedback ?? '整体表达清晰，结构与内容基本完整。',
    confidence: over.confidence ?? 0.8,
    strengths: over.strengths ?? ['发音清楚'],
    weaknesses: over.weaknesses ?? ['停顿偏多'],
    suggestions: over.suggestions ?? ['减少填充词'],
    revised_response: over.revised_response ?? 'This is a polished version of the spoken answer.'
  }
}

export function makeQuestionAttempt(
  q: Question,
  over: Partial<Omit<QuestionAttempt, 'order'>> & { order?: number } = {}
): QuestionAttempt {
  return {
    questionId: q.id,
    taskType: q.taskType,
    order: over.order ?? 0,
    audioPath: over.audioPath ?? null,
    audioMimeType: over.audioMimeType ?? null,
    durationMs: over.durationMs ?? 40000,
    transcript: over.transcript ?? 'This is a sample transcript of the spoken response.',
    score: over.score ?? null,
    sttError: over.sttError ?? null,
    scoreError: over.scoreError ?? null,
    questionSnapshot: q
  }
}

export function makeSummary(over: Partial<ExamSummary> = {}): ExamSummary {
  return {
    overall_feedback:
      over.overall_feedback ?? '整体表现稳定，综合任务的信息整合能力较强，独立任务展开略显单薄。',
    strengths: over.strengths ?? ['语速自然', '发音清晰'],
    weaknesses: over.weaknesses ?? ['细节复述不完整', '填充词偏多'],
    suggestions: over.suggestions ?? ['加强笔记训练', '控制回答结构'],
    recommended_practice: over.recommended_practice ?? ['跟读长句复述', '面试话题展开'],
    estimated_level: over.estimated_level ?? 'Band 4 (约 B1+)'
  }
}

export function makeAttempt(over: Partial<ExamAttempt> = {}): ExamAttempt {
  const defaultTypes: TaskType[] = [
    ...Array<TaskType>(7).fill('LISTEN_REPEAT'),
    ...Array<TaskType>(4).fill('INTERVIEW')
  ]
  const items =
    over.attempts ??
    defaultTypes.map((t, i) =>
      makeQuestionAttempt(makeQuestion({ taskType: t }), {
        order: i,
        score: makeScore({ task: t === 'LISTEN_REPEAT' ? 1 : 2, score: 3 })
      })
    )
  const taskScores =
    over.taskScores ??
    buildTaskScoreEntries(items.map((it) => ({ taskType: it.taskType, score: it.score })))
  const rawTotal = over.rawTotal ?? taskScores.reduce((a, s) => a + (s.rawScore ?? 0), 0)
  return {
    id: over.id ?? `exam-${crypto.randomUUID()}`,
    date: over.date ?? Date.now(),
    questionSetId: over.questionSetId ?? 'set-1',
    questionSetTitle: over.questionSetTitle ?? 'TPO 74 Speaking',
    title: over.title ?? '完整模拟考试 · TPO 74',
    mode: (over.mode ?? 'FULL') as ExamMode,
    overallScore: over.overallScore ?? 4,
    rawTotal,
    taskScores,
    summary: over.summary ?? null,
    durationMs:
      over.durationMs ??
      items.reduce((a, i) => a + i.durationMs + i.questionSnapshot.preparationTime * 1000, 0),
    attempts: items,
    status: over.status ?? 'COMPLETED',
    pendingErrors: over.pendingErrors ?? []
  }
}

/**
 * 仿真的 TOEFL Essentials Speaking 真题文字稿。
 * 两套题分别覆盖两种参考答案版式（Question N 与【文】8-11），
 * 并刻意混入「逐字拆开」的文字噪声，与真实真题库 PDF 的抽取结果一致。
 */
export const SAMPLE_SCRIPT = fs.readFileSync(
  path.resolve(__dirname, '..', 'samples', 'essentials-sample-speaking.txt'),
  'utf8'
)

/** 生成一段可播放的最小合法 WAV 音频（含 440Hz 正弦波） */
export function makeWavBuffer(seconds = 1, sampleRate = 16000): Buffer {
  const samples = Math.floor(seconds * sampleRate)
  const dataSize = samples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 12000)
    buf.writeInt16LE(v, 44 + i * 2)
  }
  return buf
}
