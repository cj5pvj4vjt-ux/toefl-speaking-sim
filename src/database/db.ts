/**
 * SQLite 数据层。
 *
 * 使用 Node.js / Electron 内置的 `node:sqlite`（SQLite 引擎本身），
 * 好处：零原生模块编译、主进程与单元测试（纯 Node）都能直接使用同一套代码。
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export type SqliteDb = DatabaseSync

let db: SqliteDb | null = null

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS question_sets (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  source_pdf    TEXT NOT NULL DEFAULT '',
  created_at    INTEGER NOT NULL,
  stats_json    TEXT
);

CREATE TABLE IF NOT EXISTS questions (
  id                  TEXT PRIMARY KEY,
  set_id              TEXT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
  ord                 INTEGER NOT NULL,
  task_type           TEXT NOT NULL,
  question_text       TEXT NOT NULL DEFAULT '',
  reading_text        TEXT,
  listening_text      TEXT,
  reference_answer    TEXT,
  context_text        TEXT,
  preparation_time    INTEGER NOT NULL DEFAULT 15,
  response_time       INTEGER NOT NULL DEFAULT 45,
  source_page         INTEGER,
  tags_json           TEXT NOT NULL DEFAULT '[]',
  parse_warnings_json TEXT NOT NULL DEFAULT '[]',
  needs_review        INTEGER NOT NULL DEFAULT 0,
  raw_text            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_questions_set ON questions(set_id, ord);

CREATE TABLE IF NOT EXISTS attempts (
  id                 TEXT PRIMARY KEY,
  date               INTEGER NOT NULL,
  question_set_id    TEXT NOT NULL DEFAULT '',
  question_set_title TEXT NOT NULL DEFAULT '',
  title              TEXT NOT NULL DEFAULT '',
  mode               TEXT NOT NULL DEFAULT 'FULL',
  overall_score      REAL,
  raw_total          REAL,
  summary_json       TEXT,
  duration_ms        INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'COMPLETED',
  pending_errors_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_attempts_date ON attempts(date DESC);

CREATE TABLE IF NOT EXISTS exam_items (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_id             TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  ord                    INTEGER NOT NULL,
  question_id            TEXT NOT NULL DEFAULT '',
  task_type              TEXT NOT NULL,
  audio_path             TEXT,
  audio_mime             TEXT,
  duration_ms            INTEGER NOT NULL DEFAULT 0,
  transcript             TEXT,
  transcript_segments_json TEXT,
  score_json             TEXT,
  stt_error              TEXT,
  score_error            TEXT,
  question_snapshot_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_attempt ON exam_items(attempt_id, ord);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/**
 * 轻量 schema 迁移。
 *
 * 用 CREATE TABLE IF NOT EXISTS 建的表不会自动加新列，
 * 老用户的数据库在升级后会缺列并直接报错，所以这里按需补齐。
 * 只做「加列」这种向后兼容的操作，不做破坏性变更。
 */
function migrateSchema(db: SqliteDb): void {
  const required: Record<string, Record<string, string>> = {
    questions: {
      reference_answer: 'TEXT',
      context_text: 'TEXT'
    }
  }
  for (const [table, columns] of Object.entries(required)) {
    let existing: string[]
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name?: unknown }[]
      existing = rows.map((r) => String(r.name ?? ''))
    } catch {
      continue
    }
    if (existing.length === 0) continue
    for (const [col, type] of Object.entries(columns)) {
      if (existing.includes(col)) continue
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`)
      } catch {
        /* 已存在或并发添加，忽略 */
      }
    }
  }
}

/**
 * 从老版本（旧托福 iBT / Essentials 三题型）升级过来时，
 * 旧数据里的任务类型在新模型里已经不存在。
 *
 * 用户明确要求「不需要兼容老托福」，所以这里直接清理：
 *  - 删掉含有已废弃任务类型的考试记录
 *  - 删掉题库里已废弃任务类型的题目；整套都是旧题型的题库一并删除
 *
 * 只做一次：清理完写入 kv 标记，之后不再重复扫描。
 */
const LEGACY_CLEANUP_KEY = 'legacy_ibt_cleanup_v1'

function cleanupLegacyData(db: SqliteDb): void {
  try {
    const marker = db.prepare('SELECT value FROM kv WHERE key = ?').get(LEGACY_CLEANUP_KEY) as
      | { value?: unknown }
      | undefined
    if (marker) return
  } catch {
    return
  }

  const VALID = ['LISTEN_REPEAT', 'INTERVIEW']

  const run = () => {
    try {
      // ---- 考试记录：attempts 里出现过旧任务类型就整场删除 ----
      const legacyAttempts = db
        .prepare('SELECT DISTINCT attempt_id FROM exam_items WHERE task_type NOT IN (?, ?)')
        .all(...VALID) as { attempt_id?: unknown }[]
      const delAttempt = db.prepare('DELETE FROM attempts WHERE id = ?')
      const delAttemptRows = db.prepare('DELETE FROM exam_items WHERE attempt_id = ?')
      for (const row of legacyAttempts) {
        const id = String(row.attempt_id ?? '')
        if (!id) continue
        delAttemptRows.run(id)
        delAttempt.run(id)
      }

      // ---- 题库：剔除旧题型题目 ----
      const delQuestion = db.prepare('DELETE FROM questions WHERE task_type NOT IN (?, ?)')
      delQuestion.run(...VALID)
      const emptySets = db
        .prepare(
          'SELECT id FROM question_sets WHERE id NOT IN (SELECT DISTINCT set_id FROM questions)'
        )
        .all() as { id?: unknown }[]
      const delSet = db.prepare('DELETE FROM question_sets WHERE id = ?')
      for (const row of emptySets) {
        const id = String(row.id ?? '')
        if (id) delSet.run(id)
      }

      db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(
        LEGACY_CLEANUP_KEY,
        String(Date.now())
      )
    } catch {
      /* 老库结构异常时静默跳过，不影响启动 */
    }
  }

  try {
    db.exec('BEGIN')
    run()
    db.exec('COMMIT')
  } catch {
    try {
      db.exec('ROLLBACK')
    } catch {
      /* ignore */
    }
  }
}

export function openDatabase(file: string): SqliteDb {
  if (db) return db
  const dir = path.dirname(file)
  if (dir && dir !== ':memory:') {
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      /* ignore */
    }
  }
  const instance = new DatabaseSync(file)
  instance.exec('PRAGMA foreign_keys = ON;')
  migrateSchema(instance)
  instance.exec(SCHEMA)
  cleanupLegacyData(instance)
  db = instance
  return db
}

export function getDb(): SqliteDb {
  if (!db) throw new Error('数据库尚未初始化')
  return db
}

export function isDbOpen(): boolean {
  return db !== null
}

export function closeDatabase(): void {
  if (db) {
    try {
      db.close()
    } catch {
      /* ignore */
    }
    db = null
  }
}

/** 只读帮助函数：把可能为 undefined 的值转成 SQLite 可接受的绑定值 */
export function bind<T>(v: T | undefined | null): T | null {
  return v === undefined || v === null ? null : v
}

export function safeJsonParse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}
