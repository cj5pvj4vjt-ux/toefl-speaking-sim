import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 数据目录管理。
 * 默认使用 app.getPath('userData')，用户可在「设置 → 数据」中修改，
 * 修改后写入 userData/bootstrap.json，重启生效。
 */

interface Bootstrap {
  dataRoot?: string
}

function bootstrapPath(): string {
  return path.join(app.getPath('userData'), 'bootstrap.json')
}

function readBootstrap(): Bootstrap {
  try {
    const raw = fs.readFileSync(bootstrapPath(), 'utf8')
    return JSON.parse(raw) as Bootstrap
  } catch {
    return {}
  }
}

let cachedRoot: string | null = null

export function getDefaultDataRoot(): string {
  return path.join(app.getPath('userData'), 'data')
}

export function getDataRoot(): string {
  if (cachedRoot) return cachedRoot
  const boot = readBootstrap()
  cachedRoot = boot.dataRoot && boot.dataRoot.trim() ? boot.dataRoot : getDefaultDataRoot()
  ensureDir(cachedRoot)
  return cachedRoot
}

/** 更改数据目录（重启后生效） */
export function setDataRoot(dir: string): void {
  const target = path.resolve(dir)
  ensureDir(target)
  const boot = readBootstrap()
  boot.dataRoot = target
  fs.writeFileSync(bootstrapPath(), JSON.stringify(boot, null, 2), 'utf8')
  cachedRoot = target
}

export function getDbPath(): string {
  return path.join(getDataRoot(), 'toefl-speaking.db')
}

export function getRecordingsDir(): string {
  return ensureDir(path.join(getDataRoot(), 'recordings'))
}

export function getExamDir(examId: string): string {
  return ensureDir(path.join(getRecordingsDir(), examId))
}

export function getReportsDir(): string {
  return ensureDir(path.join(getDataRoot(), 'reports'))
}

export function getLogsDir(): string {
  return ensureDir(path.join(getDataRoot(), 'logs'))
}

export function getSettingsPath(): string {
  return path.join(getDataRoot(), 'settings.json')
}

export function ensureDir(p: string): string {
  try {
    fs.mkdirSync(p, { recursive: true })
  } catch {
    /* ignore */
  }
  return p
}

export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
