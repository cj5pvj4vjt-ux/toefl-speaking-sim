/**
 * 极其宽容的 JSON 抽取器。
 *
 * 现实中的大模型会返回：
 *   "Here is your score: { ... }"
 *   "```json\n{...}\n```"
 *   "{...}\n\nHope this helps!"
 *   "{ 'task': 1, }"   ← 尾逗号
 *   "{...} {…}"        ← 两个对象
 *
 * 本模块负责把这些脏输出变成可 JSON.parse 的字符串。
 */

/** 去除 Markdown 代码块围栏 */
export function stripCodeFences(input: string): string {
  let s = input.trim()
  // ```json ... ``` / ``` ... ```
  const fence = /```(?:json|JSON|jsonc|javascript|js)?\s*([\s\S]*?)```/g
  const blocks: string[] = []
  let m: RegExpExecArray | null
  while ((m = fence.exec(s)) !== null) blocks.push(m[1].trim())
  if (blocks.length > 0) {
    // 优先选择包含花括号且最长的块
    const best = blocks.filter((b) => b.includes('{')).sort((a, b) => b.length - a.length)[0]
    if (best) return best
  }
  // 未闭合的围栏
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
  return s.trim()
}

/**
 * 从任意文本中扫描出第一个「括号平衡」的 JSON 对象。
 * 正确处理字符串字面量与转义字符。
 */
export function extractFirstJsonObject(input: string): string | null {
  const s = input
  let start = -1
  let depth = 0
  let inString = false
  let escape = false

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) {
        escape = false
      } else if (ch === '\\') {
        escape = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') {
      if (depth === 0) start = i
      depth++
      continue
    }
    if (ch === '}') {
      if (depth > 0) {
        depth--
        if (depth === 0 && start >= 0) {
          return s.slice(start, i + 1)
        }
      }
    }
  }
  // 未闭合：返回从 start 到结尾，交给修复器补齐
  if (start >= 0) return s.slice(start)
  return null
}

/** 修复常见 JSON 语法问题 */
export function repairJson(input: string): string {
  let s = input.trim()
  // 去掉 BOM
  s = s.replace(/^\uFEFF/, '')
  // 全角标点 → 半角
  s = s
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\uff1a/g, ':')
    .replace(/\uff0c/g, ',')
    .replace(/\u3002/g, '.')
  // 单引号 key/value → 双引号（仅当不存在双引号冲突时）
  s = s.replace(/([{,]\s*)'([^']*?)'(\s*:)/g, '$1"$2"$3')
  s = s.replace(/:\s*'([^']*?)'/g, ': "$1"')
  // 去尾逗号
  s = s.replace(/,(\s*[}\]])/g, '$1')
  // 去掉 JS 注释
  s = s.replace(/\/\/[^\n\r]*/g, '')
  s = s.replace(/\/\*[\s\S]*?\*\//g, '')
  // Python 的 True/False/None
  s = s.replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')
  // NaN / Infinity
  s = s.replace(/\bNaN\b/g, 'null').replace(/-?\bInfinity\b/g, 'null')
  // 字符串内的裸换行 → \n（简单处理：不在字符串内的换行保留）
  return balanceBraces(s)
}

/** 补齐未闭合的括号与引号 */
export function balanceBraces(input: string): string {
  let s = input.trim()
  let inString = false
  let escape = false
  const stack: string[] = []
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inString) {
      if (escape) escape = false
      else if (ch === '\\') escape = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') stack.push(ch)
    else if (ch === '}' || ch === ']') stack.pop()
  }
  if (inString) s += '"'
  // 去掉悬挂的逗号后补齐
  s = s.replace(/,\s*$/, '')
  while (stack.length) {
    const open = stack.pop()
    s += open === '{' ? '}' : ']'
  }
  return s
}

export interface JsonExtractResult {
  ok: boolean
  value?: unknown
  /** 实际被解析的 JSON 文本 */
  json?: string
  error?: string
  /** 是否经过修复 */
  repaired?: boolean
}

/** 主入口：把模型返回的任意文本解析成对象 */
export function parseLooseJson(raw: string): JsonExtractResult {
  if (raw == null) return { ok: false, error: '返回内容为空' }
  const original = String(raw)
  if (!original.trim()) return { ok: false, error: '返回内容为空' }

  const stripped = stripCodeFences(original)

  const candidates: string[] = []
  const pushUnique = (c: string | null | undefined) => {
    if (!c) return
    const t = c.trim()
    if (t && !candidates.includes(t)) candidates.push(t)
  }

  pushUnique(stripped)
  pushUnique(extractFirstJsonObject(stripped))
  pushUnique(original)
  pushUnique(extractFirstJsonObject(original))

  // 1) 直接 parse
  for (const c of candidates) {
    try {
      return { ok: true, value: JSON.parse(c), json: c }
    } catch {
      /* continue */
    }
  }

  // 2) 修复后 parse
  for (const c of candidates) {
    const fixed = repairJson(c)
    try {
      return { ok: true, value: JSON.parse(fixed), json: fixed, repaired: true }
    } catch {
      /* continue */
    }
  }

  return {
    ok: false,
    error: '无法从模型返回中解析出 JSON 对象',
    json: stripped.slice(0, 800)
  }
}
