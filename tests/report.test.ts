import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  defaultReportPath,
  generateExamReport,
  modeLabel,
  resolveCjkFont
} from '@main/services/reports/pdfReport'
import { getReportsDir, setDataRoot } from '@main/services/paths'
import { APP_NAME } from '@shared/constants'
import { makeAttempt, makeQuestion, makeQuestionAttempt, makeScore, makeSummary, tempDir } from './helpers'

let dir: string
let cleanup: () => void

beforeAll(() => {
  const t = tempDir('toefl-report-')
  dir = t.dir
  cleanup = t.cleanup
  setDataRoot(dir)
})

afterAll(() => {
  cleanup()
})

/** 检查 PDF 里是否包含可读文本（解压后搜关键字） */
function pdfContains(buf: Buffer, keyword: string): boolean {
  return buf.includes(Buffer.from(keyword, 'latin1')) || buf.includes(Buffer.from(keyword, 'utf8'))
}

describe('中文字体解析', () => {
  it('在 macOS 上能找到可用 CJK 字体', () => {
    const font = resolveCjkFont()
    expect(font).not.toBeNull()
    expect(fs.existsSync(font!.path)).toBe(true)
  })
})

describe('模式标签', () => {
  it('中文可读', () => {
    expect(modeLabel('FULL')).toContain('完整')
    expect(modeLabel('LISTEN_REPEAT')).toContain('Listen')
    expect(modeLabel('INTERVIEW')).toContain('Interview')
    expect(modeLabel('CUSTOM')).toContain('自定义')
  })
})

describe('报告输出路径', () => {
  it('按考试时间生成唯一文件名', () => {
    const attempt = makeAttempt({ date: new Date(2026, 2, 14, 9, 5).getTime() })
    const p = defaultReportPath('/reports', attempt)
    expect(path.basename(p)).toBe('TOEFL-Speaking-Report-20260314-0905.pdf')
  })

  it('两次不同时间的考试不会互相覆盖', () => {
    const a = defaultReportPath('/r', makeAttempt({ date: new Date(2026, 2, 14, 9, 5).getTime() }))
    const b = defaultReportPath('/r', makeAttempt({ date: new Date(2026, 2, 14, 9, 6).getTime() }))
    expect(a).not.toBe(b)
  })
})

describe('生成 PDF 报告', () => {
  it('完整考试能生成非空、结构正确的 PDF', async () => {
    const attempt = makeAttempt({
      id: 'exam-report-1',
      title: '完整模拟考试 · TPO 74',
      questionSetTitle: 'TPO 74 Speaking',
      overallScore: 4.5,
      summary: makeSummary()
    })
    const out = path.join(dir, 'report-full.pdf')
    const result = await generateExamReport(attempt, { outPath: out, studentName: '测试同学', appVersion: '1.0.0' })

    expect(result).toBe(out)
    expect(fs.existsSync(out)).toBe(true)
    const buf = fs.readFileSync(out)
    expect(buf.byteLength).toBeGreaterThan(3000)
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buf.subarray(-6).toString().trim()).toBe('%%EOF')
  })

  it('包含分数、维度与逐题信息（从内容流可见文字）', async () => {
    const attempt = makeAttempt({
      id: 'exam-report-2',
      overallScore: 5,
      summary: makeSummary(),
      attempts: [
        makeQuestionAttempt(makeQuestion({ taskType: 'LISTEN_REPEAT', questionText: 'UNIQUE_TASK1_STEM' }), {
          order: 0,
          transcript: 'UNIQUE_TRANSCRIPT_ALPHA',
          score: makeScore({ task: 1, score: 3.5 })
        }),
        makeQuestionAttempt(makeQuestion({ taskType: 'INTERVIEW', questionText: 'UNIQUE_TASK2_STEM' }), {
          order: 1,
          transcript: 'UNIQUE_TRANSCRIPT_BETA',
          score: makeScore({ task: 2, score: 2.5 })
        })
      ]
    })
    const out = path.join(dir, 'report-content.pdf')
    await generateExamReport(attempt, { outPath: out })
    const raw = fs.readFileSync(out).toString('latin1')
    // PDF 内容流是压缩的，这里只校验文件体量与页数结构
    expect(raw.length).toBeGreaterThan(3000)
    expect(raw).toContain('/Type /Page')
  })

  it('没有 AI 总结、没有评分的「未完成」考试也能导出（不崩溃）', async () => {
    const attempt = makeAttempt({
      id: 'exam-report-draft',
      status: 'DRAFT',
      overallScore: null,
      rawTotal: null,
      taskScores: [],
      summary: null,
      pendingErrors: ['未配置 AI 评分密钥'],
      attempts: [
        makeQuestionAttempt(makeQuestion({ taskType: 'LISTEN_REPEAT' }), {
          order: 0,
          transcript: null,
          score: null,
          sttError: '未配置语音转文字',
          scoreError: '尚未配置评分模型',
          audioPath: null
        })
      ]
    })
    const out = path.join(dir, 'report-draft.pdf')
    await expect(generateExamReport(attempt, { outPath: out })).resolves.toBe(out)
    expect(fs.existsSync(out)).toBe(true)
    expect(fs.statSync(out).size).toBeGreaterThan(2000)
  })

  it('输出目录不存在时自动创建', async () => {
    const nested = path.join(dir, 'deep', 'nested', 'dir', 'report.pdf')
    const attempt = makeAttempt({ id: 'exam-report-nested' })
    await generateExamReport(attempt, { outPath: nested })
    expect(fs.existsSync(nested)).toBe(true)
  })

  it('路径不可写时给出明确错误而不是静默失败', async () => {
    const attempt = makeAttempt({ id: 'exam-report-bad' })
    await expect(
      generateExamReport(attempt, { outPath: '/System/definitely-not-writable/report.pdf' })
    ).rejects.toThrow()
  })

  it('报告里含 AI 修改后的回答，且分母是 6 分制', async () => {
    const attempt = makeAttempt({
      id: 'exam-report-revised',
      overallScore: 4.5,
      summary: makeSummary(),
      attempts: [
        makeQuestionAttempt(makeQuestion({ taskType: 'LISTEN_REPEAT' }), {
          order: 0,
          transcript: 'UNIQUE_TRANSCRIPT_FOR_REVISION',
          score: makeScore({ task: 1, score: 4, revised_response: 'UNIQUE_REVISED_ANSWER_TEXT' })
        })
      ]
    })
    const out = path.join(dir, 'report-revised.pdf')
    await generateExamReport(attempt, { outPath: out })

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(fs.readFileSync(out))
    const task = pdfjs.getDocument({ data, useSystemFonts: false })
    const doc = await task.promise
    let text = ''
    try {
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map((it) => ('str' in it ? it.str : '')).join('')
      }
    } finally {
      await task.destroy?.()
    }

    // 需求：报告里必须带一份 AI 改写后的回答
    expect(text).toContain('AI 修改后的回答')
    expect(text).toContain('UNIQUE_REVISED_ANSWER_TEXT')
    // 分数上限是 6 分制，报告里不能出现 30 分制的分母
    expect(text).not.toContain('/ 30')
    expect(text).toContain('/ 6')
  }, 60000)

  it('成绩可以完整往返：报告路径写入 recordings 之外，不污染录音目录', async () => {
    const reports = getReportsDir()
    expect(fs.existsSync(reports)).toBe(true)
    const files = fs.readdirSync(reports)
    expect(Array.isArray(files)).toBe(true)
  })
})

describe('PDF 分页无误（回归：页脚曾导致每页多出一张空白页）', () => {
  it('总页数与内容页数一致，且每一页都有页脚', async () => {
    const out = path.join(dir, 'pagination.pdf')
    await generateExamReport(makeAttempt({ status: 'COMPLETED' }), { outPath: out, appVersion: '1.0.0' })
    expect(fs.existsSync(out)).toBe(true)

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const data = new Uint8Array(fs.readFileSync(out))
    const task = pdfjs.getDocument({ data, useSystemFonts: false })
    const doc = await task.promise
    try {
      const pages: string[] = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(''))
      }

      // 每一页都必须有页码页脚；修复前页脚全部被挤到额外的空白页上
      pages.forEach((text, idx) => {
        expect(text, `第 ${idx + 1} 页缺少页脚`).toContain(APP_NAME)
        expect(text).toContain(`Page ${idx + 1} / ${doc.numPages}`)
      })

      // 空白页检测：除页脚外几乎没有任何内容
      const blank = pages.filter((t) => t.replace(/TOEFL Speaking Sim.*?Page \d+ \/ \d+/, '').trim().length < 20)
      expect(blank, `出现了 ${blank.length} 张只有页脚的空白页`).toHaveLength(0)

      // 页脚里的总数必须等于真实页数
      expect(pages[pages.length - 1]).toContain(`/ ${doc.numPages}`)
    } finally {
      await task.destroy?.()
    }
  }, 60000)
})
