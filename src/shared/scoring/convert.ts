import { BAND_MAX, BAND_MIN, BAND_STEP, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '../constants'
import type { ExamMode, QuestionScore, TaskScoreEntry, TaskType } from '../types'

/**
 * 所有回答的平均分（0-6）→ 2026 新版托福单项分（1-6，0.5 递增）。
 *
 * 官方把每个单项报成 1–6、0.5 递增。单题分本身是 0–6，
 * 因此直接按 0.5 步长取整并落到 [1,6]。
 */
export function bandFromAverage(avg: number | null | undefined): number | null {
  if (avg == null || !Number.isFinite(avg)) return null
  const a = Math.max(0, Math.min(MAX_RESPONSE_SCORE, avg))
  const stepped = Math.round(a / BAND_STEP) * BAND_STEP
  return Math.max(BAND_MIN, Math.min(BAND_MAX, Math.round(stepped * 2) / 2))
}

/** 0-6 的原始分 → 百分比（用于进度条等可视化） */
export function toPercent(score: number | null | undefined): number | null {
  if (score == null || !Number.isFinite(score)) return null
  return Math.round((score / MAX_RESPONSE_SCORE) * 100)
}

const round1 = (n: number): number => Math.round(n * 10) / 10

export function buildTaskScoreEntries(
  questionScores: { taskType: TaskType; score: QuestionScore | null }[]
): TaskScoreEntry[] {
  const byTask = new Map<TaskType, QuestionScore[]>()
  for (const qs of questionScores) {
    if (!qs.score) continue
    const list = byTask.get(qs.taskType) ?? []
    list.push(qs.score)
    byTask.set(qs.taskType, list)
  }

  return TASK_TYPES.map((t) => {
    const list = byTask.get(t) ?? []
    if (list.length === 0) {
      return {
        taskType: t,
        rawScore: null,
        band: null,
        responseCount: 0,
        delivery: null,
        languageUse: null,
        topicDevelopment: null
      }
    }
    const avg = (pick: (s: QuestionScore) => number) =>
      round1(list.reduce((a, s) => a + (Number(pick(s)) || 0), 0) / list.length)
    const raw = avg((s) => s.score)
    return {
      taskType: t,
      rawScore: raw,
      band: bandFromAverage(raw),
      responseCount: list.length,
      delivery: avg((s) => s.delivery),
      languageUse: avg((s) => s.language_use),
      topicDevelopment: avg((s) => s.topic_development)
    }
  })
}

/**
 * Speaking 单项分。
 *
 * 官方把整个 Speaking section 视为一个单项、报 1–6 分。
 * 因此这里按「所有已回答小题的平均分」换算，而不是两个题型等权平均——
 * 否则 7 道跟读和 4 道面试会被强行拉成各占一半，偏离官方口径。
 */
export function computeOverall(
  entries: TaskScoreEntry[],
  mode: ExamMode
): { overall: number | null; rawAverage: number | null; projected: boolean } {
  const scored = entries.filter((e) => e.rawScore != null && e.responseCount > 0)
  if (scored.length === 0) return { overall: null, rawAverage: null, projected: false }

  const totalResponses = scored.reduce((a, e) => a + e.responseCount, 0)
  const weighted = scored.reduce((a, e) => a + (e.rawScore ?? 0) * e.responseCount, 0)
  const rawAverage = totalResponses > 0 ? round1(weighted / totalResponses) : null

  // 只考了部分任务时，分数是对完整 Speaking section 的预测
  const projected = mode !== 'FULL'
  return { overall: bandFromAverage(rawAverage), rawAverage, projected }
}

export function taskIndex(taskType: TaskType): number {
  return TASK_META[taskType].index
}

export function formatScore(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/**
 * 按考试模式挑选题目。
 *
 * FULL：一整套完整 Speaking section —— 优先取同一题组里三种任务齐全的题。
 * 单任务模式：只取该任务的全部题。
 * CUSTOM：按用户勾选的任务各取一题。
 */
export function pickQuestionsForMode<T extends { taskType: TaskType; tags?: string[] }>(
  pool: T[],
  mode: ExamMode,
  customTaskTypes?: TaskType[]
): T[] {
  const wanted: TaskType[] =
    mode === 'CUSTOM'
      ? customTaskTypes?.length
        ? customTaskTypes
        : []
      : mode === 'FULL'
        ? [...TASK_TYPES]
        : [mode as TaskType]
  if (wanted.length === 0) return []

  const officialCount = (t: TaskType): number => (t === 'LISTEN_REPEAT' ? 7 : 4)
  const expected = wanted.reduce((a, t) => a + officialCount(t), 0)

  /* 按题组聚合：一套真题的 7 道跟读 + 4 道面试是绑在一起的，
     出题必须整套取，不能把全库同题型混在一起。 */
  const groups = new Map<string, T[]>()
  for (const q of pool) {
    const g = (q.tags ?? []).find((t) => t.startsWith('group:')) ?? '__nogroup__'
    const list = groups.get(g) ?? []
    list.push(q)
    groups.set(g, list)
  }

  let best: T[] = []
  let bestScore = -Infinity
  for (const list of groups.values()) {
    const picked = list.filter((q) => wanted.includes(q.taskType))
    if (picked.length === 0) continue
    // 题型齐不齐是第一位；其次是题量是否贴合官方（跟读 7 / 面试 4）
    const kinds = new Set(picked.map((q) => q.taskType)).size
    const score = kinds * 1000 - Math.abs(picked.length - expected)
    if (score > bestScore) {
      bestScore = score
      best = picked
    }
  }
  if (best.length > 0) return best

  // 没有成组的题（例如全部手动新增）：退回按题型取官方数量
  return wanted.flatMap((t) => pool.filter((q) => q.taskType === t).slice(0, officialCount(t)))
}

/** 1-6 分档 → 水平定位描述（对齐官方绩效描述与 CEFR） */
export function estimateLevel(band: number | null): string {
  if (band == null) return '暂无'
  if (band >= 5.5) return 'Band 6 — 流利自如（约 C1）'
  if (band >= 4.5) return 'Band 5 — 表达自然（约 B2+）'
  if (band >= 3.5) return 'Band 4 — 基本达意（约 B1+）'
  if (band >= 2.5) return 'Band 3 — 尚可交流（约 B1）'
  if (band >= 1.5) return 'Band 2 — 表达受限（约 A2）'
  return 'Band 1 — 基础薄弱（约 A1）'
}
