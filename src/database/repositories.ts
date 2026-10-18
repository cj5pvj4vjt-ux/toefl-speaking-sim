import type { Question, QuestionSet, ExamAttempt, QuestionAttempt, ImportStats, TaskType } from '@shared/types'
import { QuestionSetSchema } from '@shared/schemas'
import { bind, getDb, safeJsonParse } from './db'

/* ------------------------------------------------------------------ */
/*                              题库                                   */
/* ------------------------------------------------------------------ */

export function saveQuestionSet(set: QuestionSet): QuestionSet {
  const db = getDb()
  const parsed = QuestionSetSchema.parse(set)
  const tx = () => {
    db.prepare(
      `INSERT INTO question_sets (id, title, source_pdf, created_at, stats_json)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title=excluded.title, source_pdf=excluded.source_pdf, stats_json=excluded.stats_json`
    ).run(
      parsed.id,
      parsed.title,
      parsed.sourcePdf ?? '',
      parsed.createdAt,
      JSON.stringify(set.importStats ?? null)
    )
    db.prepare('DELETE FROM questions WHERE set_id = ?').run(parsed.id)
    const stmt = db.prepare(
      `INSERT INTO questions
        (id, set_id, ord, task_type, question_text, context_text, reading_text, listening_text,
         reference_answer, preparation_time, response_time, source_page, tags_json,
         parse_warnings_json, needs_review, raw_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    parsed.questions.forEach((q, i) => {
      stmt.run(
        q.id,
        parsed.id,
        i,
        q.taskType,
        q.questionText ?? '',
        bind(q.contextText ?? null),
        bind(q.readingText),
        bind(q.listeningText),
        bind(q.referenceAnswer ?? null),
        q.preparationTime,
        q.responseTime,
        bind(q.sourcePage),
        JSON.stringify(q.tags ?? []),
        JSON.stringify(q.parseWarnings ?? []),
        q.needsReview ? 1 : 0,
        q.rawText ?? ''
      )
    })
  }
  runInTransaction(tx)
  return parsed
}

export function listQuestionSets(): QuestionSet[] {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT s.id, s.title, s.source_pdf, s.created_at, s.stats_json FROM question_sets s ORDER BY s.created_at DESC`
    )
    .all() as Record<string, unknown>[]
  // 注意：题库列表必须带上完整题目。
  // 首页/题库页要用它统计各 Task 题量，考试设置页要据此组卷，
  // 之前这里传 false（不加载题目）导致列表里所有题库都显示 0 题、无法生成试卷。
  return rows.map((r) => hydrateSet(r, true))
}

export function getQuestionSet(id: string): QuestionSet | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT s.id, s.title, s.source_pdf, s.created_at, s.stats_json FROM question_sets s WHERE s.id = ?`
    )
    .get(id) as Record<string, unknown> | undefined
  if (!row) return null
  return hydrateSet(row, true)
}

export function deleteQuestionSet(id: string): void {
  runInTransaction(() => {
    getDb().prepare('DELETE FROM questions WHERE set_id = ?').run(id)
    getDb().prepare('DELETE FROM question_sets WHERE id = ?').run(id)
  })
}

function hydrateSet(row: Record<string, unknown>, withQuestions: boolean): QuestionSet {
  const set: QuestionSet = {
    id: String(row.id),
    title: String(row.title),
    sourcePdf: String(row.source_pdf ?? ''),
    createdAt: Number(row.created_at ?? 0),
    questions: [],
    importStats: safeJsonParse<ImportStats | undefined>(row.stats_json as string, undefined)
  }
  if (withQuestions) {
    const rows = getDb()
      .prepare('SELECT * FROM questions WHERE set_id = ? ORDER BY ord ASC')
      .all(set.id) as Record<string, unknown>[]
    set.questions = rows.map(rowToQuestion)
  }
  return set
}

function rowToQuestion(row: Record<string, unknown>): Question {
  return {
    id: String(row.id),
    taskType: String(row.task_type) as Question['taskType'],
    questionText: String(row.question_text ?? ''),
    contextText: (row.context_text as string | null) ?? null,
    readingText: (row.reading_text as string | null) ?? null,
    listeningText: (row.listening_text as string | null) ?? null,
    referenceAnswer: (row.reference_answer as string | null) ?? null,
    preparationTime: Number(row.preparation_time ?? 15),
    responseTime: Number(row.response_time ?? 45),
    sourcePage: row.source_page == null ? null : Number(row.source_page),
    tags: safeJsonParse<string[]>(row.tags_json as string, []),
    parseWarnings: safeJsonParse<string[]>(row.parse_warnings_json as string, []),
    needsReview: Number(row.needs_review ?? 0) === 1,
    rawText: String(row.raw_text ?? '')
  }
}

/* ------------------------------------------------------------------ */
/*                            考试记录                                 */
/* ------------------------------------------------------------------ */

export function saveAttempt(attempt: ExamAttempt): ExamAttempt {
  const db = getDb()
  runInTransaction(() => {
    db.prepare(
      `INSERT INTO attempts
        (id, date, question_set_id, question_set_title, title, mode, overall_score, raw_total,
         summary_json, duration_ms, status, pending_errors_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         date=excluded.date, overall_score=excluded.overall_score, raw_total=excluded.raw_total,
         summary_json=excluded.summary_json, duration_ms=excluded.duration_ms,
         status=excluded.status, pending_errors_json=excluded.pending_errors_json,
         title=excluded.title, mode=excluded.mode`
    ).run(
      attempt.id,
      attempt.date,
      attempt.questionSetId ?? '',
      attempt.questionSetTitle ?? '',
      attempt.title ?? '',
      attempt.mode,
      bind(attempt.overallScore),
      bind(attempt.rawTotal),
      JSON.stringify(attempt.summary ?? null),
      attempt.durationMs ?? 0,
      attempt.status ?? 'COMPLETED',
      JSON.stringify(attempt.pendingErrors ?? [])
    )
    db.prepare('DELETE FROM exam_items WHERE attempt_id = ?').run(attempt.id)
    const stmt = db.prepare(
      `INSERT INTO exam_items
        (attempt_id, ord, question_id, task_type, audio_path, audio_mime, duration_ms, transcript,
         transcript_segments_json, score_json, stt_error, score_error, question_snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    attempt.attempts.forEach((item, i) => {
      stmt.run(
        attempt.id,
        item.order ?? i,
        item.questionId ?? '',
        item.taskType,
        bind(item.audioPath),
        bind(item.audioMimeType),
        item.durationMs ?? 0,
        bind(item.transcript),
        JSON.stringify(item.transcriptSegments ?? null),
        JSON.stringify(item.score ?? null),
        bind(item.sttError),
        bind(item.scoreError),
        JSON.stringify(item.questionSnapshot)
      )
    })
  })
  return attempt
}

export function getAttempt(id: string): ExamAttempt | null {
  const db = getDb()
  const row = db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (!row) return null
  return hydrateAttempt(row)
}

export function listAttempts(limit = 100, offset = 0): ExamAttempt[] {
  const rows = getDb()
    .prepare('SELECT * FROM attempts ORDER BY date DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as Record<string, unknown>[]
  return rows.map(hydrateAttempt)
}

export function deleteAttempt(id: string): void {
  runInTransaction(() => {
    getDb().prepare('DELETE FROM exam_items WHERE attempt_id = ?').run(id)
    getDb().prepare('DELETE FROM attempts WHERE id = ?').run(id)
  })
}

export function countAttempts(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM attempts').get() as { c: number }
  return Number(row?.c ?? 0)
}

export function clearAllAttempts(): void {
  runInTransaction(() => {
    getDb().prepare('DELETE FROM exam_items').run()
    getDb().prepare('DELETE FROM attempts').run()
  })
}

export function clearAllData(): void {
  runInTransaction(() => {
    getDb().prepare('DELETE FROM exam_items').run()
    getDb().prepare('DELETE FROM attempts').run()
    getDb().prepare('DELETE FROM questions').run()
    getDb().prepare('DELETE FROM question_sets').run()
  })
}

function hydrateAttempt(row: Record<string, unknown>): ExamAttempt {
  const items = getDb()
    .prepare('SELECT * FROM exam_items WHERE attempt_id = ? ORDER BY ord ASC')
    .all(String(row.id)) as Record<string, unknown>[]

  const attempts: QuestionAttempt[] = items.map((it) => ({
    questionId: String(it.question_id ?? ''),
    taskType: String(it.task_type) as QuestionAttempt['taskType'],
    order: Number(it.ord ?? 0),
    audioPath: (it.audio_path as string | null) ?? null,
    audioMimeType: (it.audio_mime as string | null) ?? null,
    durationMs: Number(it.duration_ms ?? 0),
    transcript: (it.transcript as string | null) ?? null,
    transcriptSegments: safeJsonParse(it.transcript_segments_json as string, undefined as never) ?? undefined,
    score: safeJsonParse(it.score_json as string, null),
    sttError: (it.stt_error as string | null) ?? null,
    scoreError: (it.score_error as string | null) ?? null,
    questionSnapshot: safeJsonParse(it.question_snapshot_json as string, null as never)
  }))

  const taskScores = computeTaskScoresFromItems(attempts)

  return {
    id: String(row.id),
    date: Number(row.date ?? 0),
    questionSetId: String(row.question_set_id ?? ''),
    questionSetTitle: String(row.question_set_title ?? ''),
    title: String(row.title ?? ''),
    mode: String(row.mode ?? 'FULL') as ExamAttempt['mode'],
    overallScore: row.overall_score == null ? null : Number(row.overall_score),
    rawTotal: row.raw_total == null ? null : Number(row.raw_total),
    taskScores,
    summary: safeJsonParse(row.summary_json as string, null),
    durationMs: Number(row.duration_ms ?? 0),
    attempts,
    status: String(row.status ?? 'COMPLETED') as ExamAttempt['status'],
    pendingErrors: safeJsonParse<string[]>(row.pending_errors_json as string, [])
  }
}

function computeTaskScoresFromItems(items: QuestionAttempt[]): ExamAttempt['taskScores'] {
  const types: TaskType[] = ['LISTEN_REPEAT', 'INTERVIEW']
  const band = (avg: number | null): number | null =>
    avg == null ? null : Math.max(1, Math.min(6, Math.round(avg * 2) / 2))
  return types.map((t) => {
    const list = items.filter((i) => i.taskType === t && i.score)
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
    const avg = (pick: (s: NonNullable<QuestionAttempt['score']>) => number) =>
      Math.round((list.reduce((a, i) => a + (Number(pick(i.score!)) || 0), 0) / list.length) * 10) / 10
    const raw = avg((x) => x.score)
    return {
      taskType: t,
      rawScore: raw,
      band: band(raw),
      responseCount: list.length,
      delivery: avg((x) => x.delivery),
      languageUse: avg((x) => x.language_use),
      topicDevelopment: avg((x) => x.topic_development)
    }
  })
}


/* ------------------------------------------------------------------ */
/*                               KV                                    */
/* ------------------------------------------------------------------ */

export function kvSet(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(key, value)
}

export function kvGet(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : null
}

/* ------------------------------------------------------------------ */

/**
 * 事务深度。SQLite 不支持嵌套 BEGIN，
 * 因此内层调用改用 SAVEPOINT；这样 saveQuestionSet 这类「自带事务」的函数
 * 也能被安全地放进一个更大的事务里组合使用。
 */
let txDepth = 0

export function runInTransaction(fn: () => void): void {
  const db = getDb()

  if (txDepth > 0) {
    const name = `sp_${txDepth}`
    txDepth += 1
    db.exec(`SAVEPOINT ${name}`)
    try {
      fn()
      db.exec(`RELEASE ${name}`)
    } catch (e) {
      try {
        db.exec(`ROLLBACK TO ${name}`)
        db.exec(`RELEASE ${name}`)
      } catch {
        /* ignore */
      }
      throw e
    } finally {
      txDepth -= 1
    }
    return
  }

  db.exec('BEGIN')
  txDepth = 1
  try {
    fn()
    db.exec('COMMIT')
  } catch (e) {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
    throw e
  } finally {
    txDepth = 0
  }
}
