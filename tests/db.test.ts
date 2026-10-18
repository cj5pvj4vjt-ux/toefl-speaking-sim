import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, openDatabase, safeJsonParse, bind } from '@database/db'
import {
  clearAllAttempts,
  clearAllData,
  countAttempts,
  deleteAttempt,
  deleteQuestionSet,
  getAttempt,
  getQuestionSet,
  kvGet,
  kvSet,
  listAttempts,
  listQuestionSets,
  runInTransaction,
  saveAttempt,
  saveQuestionSet
} from '@database/repositories'
import { makeAttempt, makeQuestion, makeQuestionSet, makeSummary, tempDir } from './helpers'

let dir: string
let cleanup: () => void

beforeAll(() => {
  const t = tempDir('toefl-db-')
  dir = t.dir
  cleanup = t.cleanup
  openDatabase(path.join(dir, 'test.db'))
})

afterAll(() => {
  closeDatabase()
  cleanup()
})

describe('数据库初始化', () => {
  it('成功建库并创建全部必要表', () => {
    const db = getDb()
    const rows = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of ['question_sets', 'questions', 'attempts', 'exam_items', 'kv']) {
      expect(names).toContain(t)
    }
  })

  it('bind 把 undefined 转成 null（SQLite 不接受 undefined）', () => {
    expect(bind(undefined)).toBeNull()
    expect(bind(null)).toBeNull()
    expect(bind(0)).toBe(0)
    expect(bind('x')).toBe('x')
  })

  it('safeJsonParse 遇到坏数据时回退而不是抛异常', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
    expect(safeJsonParse('{{{bad', { fallback: true })).toEqual({ fallback: true })
    expect(safeJsonParse(null, [])).toEqual([])
  })
})

describe('题库持久化', () => {
  const set = makeQuestionSet({
    id: 'set-persist',
    title: 'TPO 74 Speaking',
    importStats: { totalPages: 1, pagesWithText: 1, detected: 4, parsed: 4, needsReview: 0, warnings: [], usedOcr: false }
  })

  it('保存后可以完整读回（含所有题目字段）', () => {
    saveQuestionSet(set)
    const got = getQuestionSet('set-persist')!
    expect(got).toBeTruthy()
    expect(got.title).toBe('TPO 74 Speaking')
    expect(got.questions).toHaveLength(11)
    expect(got.questions[0].taskType).toBe('LISTEN_REPEAT')
    expect(got.questions[1].rawText).toBe('')
    expect(got.questions[0].tags).toContain('group:Test 1')
  })

  it('重复保存同一题库是幂等的（覆盖而不是重复插入）', () => {
    saveQuestionSet(set)
    saveQuestionSet(set)
    expect(getQuestionSet('set-persist')!.questions).toHaveLength(11)
    expect(listQuestionSets().filter((s) => s.id === 'set-persist')).toHaveLength(1)
  })

  it('列表按创建时间倒序返回', () => {
    saveQuestionSet(makeQuestionSet({ id: 'set-a', createdAt: 1000, title: 'A' }))
    saveQuestionSet(makeQuestionSet({ id: 'set-b', createdAt: 2000, title: 'B' }))
    const list = listQuestionSets()
    expect(list[0].createdAt).toBeGreaterThanOrEqual(list[1].createdAt)
  })

  it('删除题库会级联删除其题目', () => {
    const q = makeQuestion({ taskType: 'LISTEN_REPEAT', id: 'orphan-check' })
    saveQuestionSet(makeQuestionSet({ id: 'set-del', questions: [q] }))
    deleteQuestionSet('set-del')
    expect(getQuestionSet('set-del')).toBeNull()
    const rows = getDb().prepare('SELECT COUNT(*) AS n FROM questions WHERE set_id = ?').get('set-del') as {
      n: number
    }
    expect(rows.n).toBe(0)
  })

  it('读取不存在的题库返回 null 而不是抛异常', () => {
    expect(getQuestionSet('does-not-exist')).toBeNull()
  })
})

describe('考试记录持久化', () => {
  const attempt = makeAttempt({
    id: 'exam-persist',
    attempts: undefined,
    summary: makeSummary(),
    pendingErrors: ['Task 3：AI 请求超时']
  })

  it('保存并读回完整考试结构', () => {
    saveAttempt(attempt)
    const got = getAttempt('exam-persist')!
    expect(got).toBeTruthy()
    expect(got.id).toBe('exam-persist')
    expect(got.attempts).toHaveLength(11)
    expect(got.attempts[0].taskType).toBe('LISTEN_REPEAT')
    expect(got.attempts[7].taskType).toBe('INTERVIEW')
    expect(got.attempts[0].questionSnapshot.questionText).toBeTruthy()
    expect(got.summary!.strengths.length).toBeGreaterThan(0)
    expect(got.pendingErrors).toContain('Task 3：AI 请求超时')
    expect(got.taskScores).toHaveLength(2)
  })

  it('录音路径与文字稿保持原样（含 null）', () => {
    const a = makeAttempt({
      id: 'exam-audio',
      attempts: [
        makeQuestionAttemptStub('task1.webm', 'Hello world transcript'),
        makeQuestionAttemptStub(null, null)
      ]
    })
    saveAttempt(a)
    const got = getAttempt('exam-audio')!
    expect(got.attempts[0].audioPath).toBe('/tmp/recordings/exam-audio/task1.webm')
    expect(got.attempts[0].transcript).toBe('Hello world transcript')
    expect(got.attempts[1].audioPath).toBeNull()
    expect(got.attempts[1].transcript).toBeNull()
  })

  it('列表与计数正确', () => {
    const before = countAttempts()
    saveAttempt(makeAttempt({ id: 'exam-c1' }))
    saveAttempt(makeAttempt({ id: 'exam-c2' }))
    expect(countAttempts()).toBe(before + 2)
    expect(listAttempts(5).length).toBeLessThanOrEqual(5)
  })

  it('删除单条记录', () => {
    saveAttempt(makeAttempt({ id: 'exam-to-delete' }))
    deleteAttempt('exam-to-delete')
    expect(getAttempt('exam-to-delete')).toBeNull()
  })

  it('清空全部记录后计数为 0，题库不受影响', () => {
    clearAllAttempts()
    expect(countAttempts()).toBe(0)
    expect(listQuestionSets().length).toBeGreaterThan(0)
  })
})

describe('键值存储与事务', () => {
  it('kv 读写', () => {
    kvSet('lastImport', 'TPO 74')
    expect(kvGet('lastImport')).toBe('TPO 74')
    expect(kvGet('nope')).toBeNull()
  })

  it('事务内抛异常会整体回滚，不留半成品数据', () => {
    const before = listQuestionSets().length
    expect(() =>
      runInTransaction(() => {
        saveQuestionSet(makeQuestionSet({ id: 'set-rollback', title: 'Rollback' }))
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(listQuestionSets().length).toBe(before)
  })
})

describe('数据文件本身', () => {
  it('数据库文件确实写到了磁盘上', () => {
    expect(fs.existsSync(path.join(dir, 'test.db'))).toBe(true)
    expect(fs.statSync(path.join(dir, 'test.db')).size).toBeGreaterThan(0)
  })

  it('clearAllData 之后仍然可以继续使用数据库', () => {
    clearAllData()
    expect(countAttempts()).toBe(0)
    expect(listQuestionSets()).toHaveLength(0)
    kvSet('afterClear', '1')
    expect(kvGet('afterClear')).toBe('1')
  })
})

/* ------------------------------------------------------------------ */

function makeQuestionAttemptStub(audioPath: string | null, transcript: string | null) {
  const q = makeQuestion({ taskType: 'LISTEN_REPEAT', id: `q-${Math.random()}` })
  return {
    questionId: q.id,
    taskType: q.taskType,
    order: 0,
    audioPath: audioPath ? `/tmp/recordings/exam-audio/${audioPath}` : null,
    audioMimeType: audioPath ? 'audio/webm' : null,
    durationMs: 41000,
    transcript,
    score: null,
    sttError: transcript ? null : '未配置语音转文字',
    scoreError: null,
    questionSnapshot: q
  }
}

describe('题库列表必须携带完整题目（回归：列表页显示 0 题）', () => {
  it('listQuestionSets 返回的每个题库都带有自己的题目', async () => {
    const { saveQuestionSet, listQuestionSets } = await import('@database/repositories')
    const set = makeQuestionSet()
    saveQuestionSet(set)

    const list = listQuestionSets()
    const found = list.find((s) => s.id === set.id)!
    expect(found).toBeTruthy()
    expect(found.questions.length).toBe(set.questions.length)
    expect(found.questions.length).toBeGreaterThan(0)

    // 各 Task 题量必须可统计（考试设置页据此组卷）
    const byTask = found.questions.filter((q) => q.taskType === 'LISTEN_REPEAT').length
    expect(byTask).toBe(set.questions.filter((q) => q.taskType === 'LISTEN_REPEAT').length)
  })
})

describe('schema 迁移（老数据库升级后不能缺列）', () => {
  it('对缺少 reference_answer 列的旧库能自动补列并正常写入', async () => {
    const legacy = path.join(tempDir('toefl-legacy-').dir, 'legacy.db')
    // 造一个「旧版本」的 questions 表：没有 reference_answer 列
    const { DatabaseSync } = await import('node:sqlite')
    const raw = new DatabaseSync(legacy)
    raw.exec(`
      CREATE TABLE question_sets (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, source_pdf TEXT,
        created_at INTEGER NOT NULL, stats_json TEXT
      );
      CREATE TABLE questions (
        id TEXT PRIMARY KEY,
        set_id TEXT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
        ord INTEGER NOT NULL,
        task_type TEXT NOT NULL,
        question_text TEXT NOT NULL DEFAULT '',
        reading_text TEXT,
        listening_text TEXT,
        preparation_time INTEGER NOT NULL DEFAULT 15,
        response_time INTEGER NOT NULL DEFAULT 45,
        source_page INTEGER,
        tags_json TEXT NOT NULL DEFAULT '[]',
        parse_warnings_json TEXT NOT NULL DEFAULT '[]',
        needs_review INTEGER NOT NULL DEFAULT 0,
        raw_text TEXT NOT NULL DEFAULT ''
      );
    `)
    raw.close()

    closeDatabase()
    openDatabase(legacy)

    const set = makeQuestionSet()
    saveQuestionSet(set)
    const back = listQuestionSets().find((s) => s.id === set.id)!
    expect(back.questions.length).toBe(set.questions.length)
    // 迁移后该字段可读可写
    expect(back.questions[0].referenceAnswer).toBe(set.questions[0].referenceAnswer)

    closeDatabase()
  })
})

describe('旧托福数据清理（用户要求不兼容老托福）', () => {
  it('升级后旧 iBT 考试与题库被清掉，新数据不受影响', () => {
    const { dir, cleanup } = tempDir('toefl-legacy-')
    const file = path.join(dir, 'legacy.db')
    try {
      // openDatabase 是单例：必须先关掉别的测试留下的连接，否则会拿到错的库
      closeDatabase()
      // 1) 先建好表结构，再把「一次性清理」的标记抹掉，
      //    这样接着灌进去的旧数据才会在下次打开时被当成待升级的老数据。
      const seed = openDatabase(file)
      seed.exec("DELETE FROM kv WHERE key = 'legacy_ibt_cleanup_v1'")
      seed.exec(`
        INSERT INTO question_sets (id, title, source_pdf, created_at, stats_json)
        VALUES ('set-old', '老托福题库', '/tmp/old.pdf', 1, '{}');
        INSERT INTO questions (id, set_id, ord, task_type, question_text, reading_text, listening_text, preparation_time, response_time, source_page, tags_json, parse_warnings_json, needs_review, raw_text, reference_answer)
        VALUES ('q-old', 'set-old', 0, 'TASK_1', 'Old iBT task 1', NULL, NULL, 15, 45, 1, '[]', '[]', 0, '', NULL);
      `)
      seed.exec(`
        INSERT INTO attempts (id, date, question_set_id, question_set_title, title, mode, overall_score, raw_total, summary_json, duration_ms, status, pending_errors_json)
        VALUES ('exam-old', 1, 'set-old', '老托福题库', '老考试', 'FULL', 22, 14, NULL, 1000, 'COMPLETED', '[]');
        INSERT INTO exam_items (attempt_id, ord, question_id, task_type, audio_path, audio_mime, duration_ms, transcript, score_json, stt_error, score_error, question_snapshot_json)
        VALUES ('exam-old', 0, 'q-old', 'TASK_1', NULL, NULL, 1000, 'hi', NULL, NULL, NULL, '{}');
      `)
      closeDatabase()

      // 2) 重新打开：应当触发一次性清理
      const reopened = openDatabase(file)
      const sets = reopened.prepare('SELECT id FROM question_sets').all() as { id: string }[]
      const attempts = reopened.prepare('SELECT id FROM attempts').all() as { id: string }[]
      expect(sets.map((r) => r.id)).not.toContain('set-old')
      expect(attempts.map((r) => r.id)).not.toContain('exam-old')
      closeDatabase()

      // 3) 再打开一次：标记已写入，不应报错也不应重复清理
      const again = openDatabase(file)
      expect(again.prepare('SELECT COUNT(*) AS n FROM attempts').get()).toBeTruthy()
      closeDatabase()
    } finally {
      cleanup()
    }
  })

  it('新模型的数据不会被误删', () => {
    const { dir, cleanup } = tempDir('toefl-keep-')
    try {
      closeDatabase()
      const file = path.join(dir, 'keep.db')
      const db = openDatabase(file)
      // 清掉标记，让「升级清理」真的跑一遍，验证它不会误删新模型数据
      db.exec("DELETE FROM kv WHERE key = 'legacy_ibt_cleanup_v1'")
      const set = makeQuestionSet({ id: 'set-new' })
      db.exec(`
        INSERT INTO question_sets (id, title, source_pdf, created_at, stats_json)
        VALUES ('set-new', '新托福题库', '/tmp/new.pdf', 1, '{}');
      `)
      db.prepare(
        `INSERT INTO questions (id, set_id, ord, task_type, question_text, reading_text, listening_text, preparation_time, response_time, source_page, tags_json, parse_warnings_json, needs_review, raw_text, reference_answer)
         VALUES (?, 'set-new', 0, 'LISTEN_REPEAT', 'Milk and Yogurt are in the dairy section.', NULL, 'Milk and Yogurt are in the dairy section.', 0, 10, 1, '[]', '[]', 0, '', NULL)`
      ).run('q-new')
      closeDatabase()

      const reopened = openDatabase(file)
      const rows = reopened.prepare('SELECT id FROM questions').all() as { id: string }[]
      expect(rows.map((r) => r.id)).toContain('q-new')
      expect(set.questions.length).toBeGreaterThan(0)
      closeDatabase()
    } finally {
      cleanup()
    }
  })
})
