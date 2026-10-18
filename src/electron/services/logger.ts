import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * 轻量日志。绝不记录 API Key / 授权头。
 */

const SENSITIVE = /(sk-[A-Za-z0-9_\-]{6,}|Bearer\s+[A-Za-z0-9._\-]+|api[_-]?key["']?\s*[:=]\s*["']?[^"',}\s]+)/gi

export function redact(input: unknown): string {
  let s: string
  if (input instanceof Error) s = `${input.name}: ${input.message}`
  else if (typeof input === 'string') s = input
  else {
    try {
      s = JSON.stringify(input)
    } catch {
      s = String(input)
    }
  }
  return (s ?? '').replace(SENSITIVE, '[REDACTED]')
}

let logFile: string | null = null

function file(): string | null {
  if (logFile) return logFile
  try {
    const dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    logFile = path.join(dir, 'main.log')
  } catch {
    logFile = null
  }
  return logFile
}

function write(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(redact).join(' ')}`
  if (level === 'ERROR') console.error(line)
  else console.log(line)
  const f = file()
  if (f) {
    try {
      fs.appendFileSync(f, line + '\n')
    } catch {
      /* ignore */
    }
  }
}

export const logger = {
  info: (...a: unknown[]) => write('INFO', a),
  warn: (...a: unknown[]) => write('WARN', a),
  error: (...a: unknown[]) => write('ERROR', a),
  debug: (...a: unknown[]) => {
    if (!app.isPackaged) write('DEBUG', a)
  }
}
