import fs from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { AI_DIMENSIONS, APP_NAME, BAND_MAX, MAX_RESPONSE_SCORE, TASK_META } from '@shared/constants'
import { estimateLevel } from '../scoring/engine'
import type { ExamAttempt, QuestionAttempt } from '@shared/types'

/**
 * PDF 考试报告生成。
 * 需要 CJK 字体，按优先级从系统中挑选（macOS 自带，无需额外资源）。
 */

const FONT_CANDIDATES: { path: string; family?: string }[] = [
  { path: '/System/Library/Fonts/Supplemental/Arial Unicode.ttf' },
  { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'HiraginoSansGB-W3' },
  { path: '/System/Library/Fonts/STHeiti Light.ttc', family: 'STHeitiSC-Light' },
  { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFangSC-Regular' },
  { path: '/Library/Fonts/Arial Unicode.ttf' }
]

export function resolveCjkFont(): { path: string; family?: string } | null {
  for (const c of FONT_CANDIDATES) {
    try {
      if (fs.existsSync(c.path)) return c
    } catch {
      /* ignore */
    }
  }
  return null
}

const COLORS = {
  ink: '#0F172A',
  muted: '#64748B',
  line: '#E2E8F0',
  brand: '#4F46E5',
  aqua: '#0891B2',
  good: '#059669',
  warn: '#D97706',
  bad: '#DC2626',
  soft: '#F1F5F9'
}

type Doc = PDFKit.PDFDocument

function shadeColor(v: number, max: number): string {
  const r = max === 0 ? 0 : v / max
  if (r >= 0.75) return COLORS.good
  if (r >= 0.5) return COLORS.aqua
  if (r >= 0.3) return COLORS.warn
  return COLORS.bad
}

function fmt(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '--'
  return Number.isInteger(n) ? String(n) : n.toFixed(digits)
}

export interface ReportOptions {
  outPath: string
  /** 学生名（可选） */
  studentName?: string
  appVersion?: string
}

export async function generateExamReport(attempt: ExamAttempt, opts: ReportOptions): Promise<string> {
  const font = resolveCjkFont()
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 52, right: 52 },
    info: {
      Title: 'TOEFL Speaking Mock Exam Report',
      Author: APP_NAME,
      Subject: attempt.title || attempt.questionSetTitle
    },
    bufferPages: true
  }) as Doc

  // 用户可能选择了任意保存路径，先确保父目录存在
  const outDir = path.dirname(opts.outPath)
  if (outDir) fs.mkdirSync(outDir, { recursive: true })

  const out = fs.createWriteStream(opts.outPath)
  doc.pipe(out)

  const fontName = font ? 'zh' : 'Helvetica'
  try {
    if (font) {
      if (font.family) doc.registerFont('zh', font.path, font.family)
      else doc.registerFont('zh', font.path)
    }
  } catch {
    doc.font('Helvetica')
  }

  const pageW = doc.page.width
  const marginL = 52
  const contentW = pageW - marginL * 2
  const bottomLimit = doc.page.height - 60

  const use = (size = 10, color = COLORS.ink, name = fontName): Doc =>
    doc.font(name).fontSize(size).fillColor(color) as Doc

  const ensureSpace = (h: number) => {
    if (doc.y + h > bottomLimit) doc.addPage()
  }

  const hr = (gap = 8) => {
    doc.moveDown(gap / 10)
    doc
      .strokeColor(COLORS.line)
      .lineWidth(1)
      .moveTo(marginL, doc.y)
      .lineTo(pageW - marginL, doc.y)
      .stroke()
    doc.moveDown(gap / 10)
  }

  const sectionTitle = (text: string) => {
    ensureSpace(50)
    use(13, COLORS.brand).text(text)
    doc.moveDown(0.35)
  }

  const bar = (label: string, value: number | null, max: number, color: string, zh?: string) => {
    ensureSpace(28)
    const y = doc.y
    use(9.5).text(`${label}${zh ? ` / ${zh}` : ''}`, marginL, y, { width: contentW * 0.28 })
    const barX = marginL + contentW * 0.3
    const barW = contentW * 0.55
    use(9.5, COLORS.muted).text(`${fmt(value)} / ${max}`, barX + barW + 8, y, { width: contentW * 0.15, align: 'right' })
    doc.roundedRect(barX, y + 2, barW, 9).fill(COLORS.soft)
    const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max))
    if (ratio > 0) doc.roundedRect(barX, y + 2, Math.max(4, barW * ratio), 9).fill(color)
    doc.y = y + 20
  }

  /* ------------------------- 封面头部 ------------------------- */
  doc.rect(0, 0, pageW, 116).fill('#0F172A')
  doc.fillColor('#FFFFFF').font(fontName).fontSize(21).text('TOEFL Speaking', marginL, 28)
  doc.fillColor('#A5B4FC').fontSize(13).text('Mock Exam Report  ·  全真模拟考试报告', marginL, 56)
  use(9, '#94A3B8')
    .text(
      `生成时间 ${new Date().toLocaleString('zh-CN')}${opts.studentName ? `   ·   考生 ${opts.studentName}` : ''}` +
        `${opts.appVersion ? `   ·   v${opts.appVersion}` : ''}`,
      marginL,
      82
    )

  doc.y = 140

  /* ------------------------- 概览 ------------------------- */
  const overall = attempt.overallScore
  const boxY = doc.y
  doc.roundedRect(marginL, boxY, contentW, 92).fill('#EEF2FF')
  doc.roundedRect(marginL, boxY, 4, 92).fill(COLORS.brand)

  use(10, COLORS.muted).text('Estimated Score（估算分）', marginL + 20, boxY + 16)
  use(34, COLORS.brand).text(`${overall == null ? '--' : fmt(overall)}`, marginL + 20, boxY + 32, {
    continued: true
  })
  use(13, COLORS.muted).text(` / ${BAND_MAX}`)

  use(10, COLORS.muted).text('Raw Total（原始分合计）', marginL + 230, boxY + 22)
  use(15, COLORS.ink).text(`${attempt.rawTotal == null ? '--' : fmt(attempt.rawTotal)} / 6`, marginL + 230, boxY + 40)

  use(10, COLORS.muted).text('Level（水平定位）', marginL + 230, boxY + 60)
  use(10, COLORS.ink).text(estimateLevel(overall), marginL + 230, boxY + 74)

  use(10, COLORS.muted).text('考试时间', marginL + 400, boxY + 22)
  use(10, COLORS.ink).text(new Date(attempt.date).toLocaleString('zh-CN'), marginL + 400, boxY + 38)
  use(10, COLORS.muted).text('考试模式', marginL + 400, boxY + 56)
  use(10, COLORS.ink).text(modeLabel(attempt.mode), marginL + 400, boxY + 70)

  doc.y = boxY + 108

  /* ------------------------- 题目来源 ------------------------- */
  use(9.5, COLORS.muted).text(
    `题库：${attempt.questionSetTitle || '（未关联题库）'}      用时：${formatDuration(attempt.durationMs)}      题目数：${attempt.attempts.length}`,
    marginL,
    doc.y,
    { width: contentW }
  )
  doc.moveDown(1)
  hr(6)

  /* ------------------------- Task 分数 ------------------------- */
  sectionTitle('Task Scores · 分项得分')
  const colW = contentW / 4
  const ty = doc.y
  attempt.taskScores.forEach((t, i) => {
    const x = marginL + colW * i
    const meta = TASK_META[t.taskType]
    doc.roundedRect(x + 2, ty, colW - 8, 74).fill(COLORS.soft)
    use(9, COLORS.muted).text(meta.shortLabel, x + 12, ty + 10)
    use(9, COLORS.muted).text(meta.title.split('—')[0].trim(), x + 12, ty + 24, { width: colW - 20 })
    use(20, shadeColor(t.rawScore ?? 0, MAX_RESPONSE_SCORE)).text(fmt(t.rawScore), x + 12, ty + 36)
    use(9, COLORS.muted).text(`/ 6   单项分 ${fmt(t.band)} / 6`, x + 12, ty + 60)
  })
  doc.y = ty + 88

  /* ------------------------- 三维度 ------------------------- */
  sectionTitle('Dimensions · 评分维度（ETS 官方三维度，0-6 分）')
  const dims = AI_DIMENSIONS.map((d) => {
    const nums = attempt.taskScores
      .map((t) => (d.key === 'delivery' ? t.delivery : d.key === 'language_use' ? t.languageUse : t.topicDevelopment))
      .filter((n): n is number => n != null)
    const avg = nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null
    return { ...d, value: avg }
  })
  for (const d of dims) bar(d.label, d.value, MAX_RESPONSE_SCORE, d.color, d.labelZh)
  doc.moveDown(0.5)
  hr(6)

  /* ------------------------- AI 总结 ------------------------- */
  sectionTitle('AI Summary · AI 总结')
  if (attempt.summary) {
    use(10).text(attempt.summary.overall_feedback, marginL, doc.y, { width: contentW, align: 'left' })
    doc.moveDown(0.6)
    const cols: [string, string[], string][] = [
      ['Strengths · 优势', attempt.summary.strengths, COLORS.good],
      ['Weaknesses · 主要问题', attempt.summary.weaknesses, COLORS.bad],
      ['Suggestions · 改进建议', attempt.summary.suggestions, COLORS.brand]
    ]
    for (const [title, list, color] of cols) {
      if (!list?.length) continue
      ensureSpace(40)
      use(10, color).text(title)
      doc.moveDown(0.2)
      for (const item of list) {
        ensureSpace(18)
        use(9.5, COLORS.ink).text(`•  ${item}`, marginL + 12, doc.y, { width: contentW - 12 })
      }
      doc.moveDown(0.4)
    }
  } else {
    use(10, COLORS.muted).text('本次考试未生成 AI 总结。', marginL, doc.y)
  }
  doc.moveDown(0.5)
  hr(6)

  /* ------------------------- 逐题分析 ------------------------- */
  sectionTitle('Question-by-Question Analysis · 逐题分析')

  attempt.attempts
    .slice()
    .sort((a, b) => a.order - b.order)
    .forEach((item) => {
      renderQuestion(doc, item, {
        marginL,
        contentW,
        ensureSpace,
        use,
        fontName,
        bar,
        sectionTitle
      })
    })

  /* ------------------------- 推荐练习 ------------------------- */
  doc.addPage()
  sectionTitle('Recommended Practice Areas · 推荐练习方向')
  const recs = attempt.summary?.recommended_practice?.length
    ? attempt.summary.recommended_practice
    : defaultRecommendations(attempt)
  recs.forEach((r, i) => {
    ensureSpace(24)
    use(10, COLORS.brand).text(`${i + 1}.`, marginL, doc.y, { continued: true, width: 20 })
    use(10, COLORS.ink).text(`  ${r}`, { width: contentW - 24 })
    doc.moveDown(0.35)
  })

  doc.moveDown(1)
  hr(8)
  use(8.5, COLORS.muted).text(
    '说明：2026 新版 TOEFL iBT Speaking 官方评分对每道题给出 0-6 的整体分，并在 Delivery / Language Use / Topic Development 三个维度上评价；' +
      `每个任务的单项分为该任务下所有回答的平均分，报 1-${BAND_MAX}、0.5 递增（估算分即此单项分），仅供参考，不等同于 ETS 官方成绩。本报告由 AI 辅助生成。`,
    marginL,
    doc.y,
    { width: contentW, align: 'left' }
  )

  // 页脚页码
  const range = doc.bufferedPageRange()
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    // 关键：页脚要画在下边距里。若不把 bottom margin 临时置 0，
    // pdfkit 会认为这一行放不下而自动分页，每盖一次页脚就凭空多出一整页空白页。
    const savedBottom = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    use(8, COLORS.muted).text(
      `${APP_NAME}  ·  ${new Date(attempt.date).toLocaleDateString('zh-CN')}  ·  Page ${i + 1} / ${range.count}`,
      marginL,
      doc.page.height - 42,
      { width: contentW, align: 'center', lineBreak: false }
    )
    doc.page.margins.bottom = savedBottom
  }

  doc.end()
  await new Promise<void>((resolve, reject) => {
    out.on('finish', () => resolve())
    out.on('error', reject)
  })
  return opts.outPath
}

interface RenderCtx {
  marginL: number
  contentW: number
  ensureSpace: (h: number) => void
  use: (size?: number, color?: string, name?: string) => Doc
  fontName: string
  bar: (label: string, value: number | null, max: number, color: string, zh?: string) => void
  sectionTitle: (t: string) => void
}

function renderQuestion(doc: Doc, item: QuestionAttempt, ctx: RenderCtx): void {
  const { marginL, contentW, ensureSpace, use } = ctx
  const meta = TASK_META[item.taskType]
  const score = item.score

  ensureSpace(230)
  const topY = doc.y
  doc.roundedRect(marginL, topY, contentW, 26).fill('#E0E7FF')
  use(10, COLORS.brand).text(
    `${meta.shortLabel}  ·  ${meta.title}    ${score ? `Score ${fmt(score.score)} / ${MAX_RESPONSE_SCORE}` : '未评分'}`,
    marginL + 10,
    topY + 7,
    { width: contentW - 20 }
  )
  doc.y = topY + 34

  if (item.questionSnapshot?.questionText) {
    ensureSpace(40)
    use(9, COLORS.muted).text('题目')
    use(9.5, COLORS.ink).text(clip(item.questionSnapshot.questionText, 700), marginL, doc.y, { width: contentW })
    doc.moveDown(0.4)
  }

  if (item.transcript) {
    ensureSpace(60)
    use(9, COLORS.muted).text('你的回答（Transcript）')
    doc.roundedRect(marginL, doc.y, contentW, measure(doc, item.transcript) + 12).fill('#F8FAFC')
    const ty = doc.y + 6
    use(9.5, COLORS.ink).text(clip(item.transcript, 1400), marginL + 8, ty, { width: contentW - 16 })
    doc.y = ty + measure(doc, clip(item.transcript, 1400)) + 12
  } else {
    ensureSpace(24)
    use(9.5, COLORS.bad).text(
      item.sttError ? `（未获得文字稿：${clip(item.sttError, 160)}）` : '（本题未获得文字稿）',
      marginL,
      doc.y,
      { width: contentW }
    )
  }
  doc.moveDown(0.5)

  /* ------------------- AI 修改后的回答 ------------------- */
  // 与「你的回答」并排呈现，方便考生直接对照自己说的与更好的说法。
  const revised = (score?.revised_response ?? '').trim()
  if (revised) {
    ensureSpace(70)
    use(9, COLORS.brand).text('AI 修改后的回答（AI revised version）')
    const shown = clip(revised, 2200)
    doc.roundedRect(marginL, doc.y, contentW, measure(doc, shown) + 12).fill('#F1F5F9')
    const ry = doc.y + 6
    use(9.5, COLORS.ink).text(shown, marginL + 8, ry, { width: contentW - 16 })
    doc.y = ry + measure(doc, shown) + 12
    doc.moveDown(0.3)
  }

  if (score) {
    ctx.bar('Delivery', score.delivery, MAX_RESPONSE_SCORE, '#818CF8', '表达与流利度')
    ctx.bar('Language Use', score.language_use, MAX_RESPONSE_SCORE, '#22D3EE', '语言运用')
    ctx.bar('Topic Development', score.topic_development, MAX_RESPONSE_SCORE, '#34D399', '内容展开')

    ensureSpace(50)
    use(9, COLORS.muted).text('AI Analysis')
    use(9.5, COLORS.ink).text(score.feedback || '（无）', marginL, doc.y, { width: contentW })
    doc.moveDown(0.4)

    const blocks: [string, string[], string][] = [
      ['Strengths', score.strengths, COLORS.good],
      ['Weaknesses', score.weaknesses, COLORS.bad],
      ['Suggestions', score.suggestions, COLORS.brand]
    ]
    for (const [title, list, color] of blocks) {
      if (!list?.length) continue
      ensureSpace(30)
      use(9, color).text(title)
      for (const s of list) {
        ensureSpace(16)
        use(9, COLORS.ink).text(`•  ${s}`, marginL + 10, doc.y, { width: contentW - 10 })
      }
      doc.moveDown(0.25)
    }
    use(8.5, COLORS.muted).text(`AI 置信度：${Math.round((score.confidence ?? 0) * 100)}%`, marginL, doc.y)
  } else if (item.scoreError) {
    ensureSpace(24)
    use(9.5, COLORS.bad).text(`本题未获得评分：${clip(item.scoreError, 200)}`, marginL, doc.y, { width: contentW })
  }

  doc.moveDown(0.8)
  doc.strokeColor(COLORS.line).lineWidth(0.7).moveTo(marginL, doc.y).lineTo(marginL + contentW, doc.y).stroke()
  doc.moveDown(0.8)
}

function measure(doc: Doc, text: string): number {
  const h = doc.heightOfString(text, { width: doc.page.width - 52 * 2 - 16 })
  return Math.max(18, h)
}

function clip(s: string, n: number): string {
  const t = (s ?? '').trim()
  return t.length > n ? t.slice(0, n) + ' …' : t
}

export function modeLabel(mode: ExamAttempt['mode']): string {
  switch (mode) {
    case 'FULL':
      return '完整模拟考试'
    case 'CUSTOM':
      return '自定义考试'
    default:
      return `${TASK_META[mode as keyof typeof TASK_META]?.shortLabel ?? mode} 专项`
  }
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m} 分 ${s} 秒`
}

function defaultRecommendations(attempt: ExamAttempt): string[] {
  const weakest = attempt.taskScores
    .filter((t) => t.rawScore != null)
    .sort((a, b) => (a.rawScore ?? 0) - (b.rawScore ?? 0))[0]
  const out: string[] = []
  if (weakest)
    out.push(
      `重点突破 ${TASK_META[weakest.taskType].shortLabel}（本次 ${fmt(weakest.rawScore)}/${MAX_RESPONSE_SCORE}）`
    )
  out.push('每天 1 组限时练习：严格使用官方准备时间与回答时间')
  out.push('回听自己的录音，标记卡顿与语法错误位置')
  out.push('Take an Interview 练习「直接回答 → 具体细节 → 收尾」的表达结构')
  return out
}

export function defaultReportPath(reportsDir: string, attempt: ExamAttempt): string {
  const d = new Date(attempt.date)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(
    d.getHours()
  ).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  return path.join(reportsDir, `TOEFL-Speaking-Report-${stamp}.pdf`)
}
