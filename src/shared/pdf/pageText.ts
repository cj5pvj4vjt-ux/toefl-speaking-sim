/**
 * 把 pdfjs 的文本 item 还原成「接近阅读顺序」的页面文本。
 *
 * 放在 shared 而不是渲染进程，是为了让测试能用同一份实现跑真实 PDF——
 * 文本还原方式直接决定了题号、段落能否被正确切分，两套实现一定会漂移。
 */

export interface PdfTextItemLike {
  str?: string
  hasEOL?: boolean
  transform?: number[]
  height?: number
  width?: number
}

export function buildPageText(items: PdfTextItemLike[]): string {
  if (!items.length) return ''
  const rows: { y: number; x: number; str: string; h: number }[] = []
  for (const it of items) {
    const str = it.str ?? ''
    const tr = it.transform ?? [1, 0, 0, 1, 0, 0]
    if (!str) {
      if (it.hasEOL) rows.push({ y: tr[5], x: tr[4], str: '\n', h: it.height ?? 10 })
      continue
    }
    rows.push({ y: Math.round(tr[5]), x: tr[4], str, h: it.height ?? Math.abs(tr[3] ?? 10) })
  }
  // 按 y 聚类成行
  rows.sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: { y: number; parts: { x: number; str: string }[]; h: number }[] = []
  for (const r of rows) {
    const last = lines[lines.length - 1]
    const tolerance = Math.max(2.2, (r.h || 10) * 0.45)
    if (last && Math.abs(last.y - r.y) <= tolerance) {
      last.parts.push({ x: r.x, str: r.str })
    } else {
      lines.push({ y: r.y, parts: [{ x: r.x, str: r.str }], h: r.h || 10 })
    }
  }
  const out: string[] = []
  let prevBottom: number | null = null
  for (const line of lines) {
    line.parts.sort((a, b) => a.x - b.x)
    const text = line.parts
      .map((p) => p.str)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
    if (!text) continue
    // 行间距明显变大 → 视为段落分隔
    if (prevBottom != null) {
      const gap = prevBottom - line.y
      if (gap > line.h * 1.9) out.push('')
    }
    out.push(text)
    prevBottom = line.y
  }
  return out.join('\n')
}
