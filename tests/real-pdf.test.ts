import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPageText } from '@shared/pdf/pageText'
import { parseQuestionsFromPages, isLikelyScanned, type PageText } from '@shared/pdf/parseQuestions'

/**
 * 用一份真实的 164 页 2026 新托福口语真题库跑端到端解析。
 *
 * 这份 PDF 的难点：
 *  - 文字被逐字拆开（"2 0 2 6 年 1 月 2 1 日"），日期还会被拆成 "20 2 6 年 1 月 28 日"
 *  - 三种版式混用：「1-7. 场景」「1 – 7. 场景」「只有一段场景文字」
 *  - 参考答案有四种开头：Question 8 / 【文】8. / 问题 10: + 答案： / 干脆没有任何标记，直接重编号
 *  - 两页之间会把两道题挤在同一行（"…around the world, 3.discover…"）
 *  - 第 1 句偶尔漏掉编号
 *
 * 按用户要求：参考答案一律不录入，只要「场景 + 题目」。
 */

const SAMPLE = path.resolve(__dirname, '../samples/real-tpo-0826.pdf')

async function extractPages(file: string): Promise<PageText[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(fs.readFileSync(file))
  const task = pdfjs.getDocument({ data, useSystemFonts: false })
  const doc = await task.promise
  const pages: PageText[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push({ page: i, text: buildPageText(content.items as never[]) })
    page.cleanup()
  }
  await task.destroy?.()
  return pages
}

describe('真实真题库 PDF（2026 新托福口语）', () => {
  it.runIf(fs.existsSync(SAMPLE))('规则解析能识别出跟读题与面试题', async () => {
    const pages = await extractPages(SAMPLE)
    expect(pages.length).toBeGreaterThan(100)
    expect(isLikelyScanned(pages)).toBe(false)

    const res = parseQuestionsFromPages(pages)

    const repeat = res.questions.filter((q) => q.taskType === 'LISTEN_REPEAT')
    const interview = res.questions.filter((q) => q.taskType === 'INTERVIEW')

    // 164 页 / 每套 11 题，规则解析至少应当稳稳识别出数百道题
    expect(res.questions.length).toBeGreaterThan(500)
    expect(interview.length).toBeGreaterThan(250)

    // 参考答案一律不录入（用户要求）
    expect(res.questions.every((q) => q.referenceAnswer === null)).toBe(true)
    for (const q of res.questions) {
      expect(q.questionText).not.toMatch(/【\s*(简单版|范文|答案|文)\s*】/)
      expect(q.questionText).not.toMatch(/^Questions?\s*\d/i)
      // 答案正文不能混进题干
      expect(q.questionText).not.toMatch(/^答案\s*[:：]/)
    }

    // 绝大多数题组应当是标准的 11 题（7 跟读 + 4 面试）
    const byGroup = new Map<string, number>()
    for (const q of res.questions) {
      const g = q.tags.find((t) => t.startsWith('group:')) ?? ''
      byGroup.set(g, (byGroup.get(g) ?? 0) + 1)
    }
    const full = [...byGroup.values()].filter((n) => n === 11).length
    expect(full).toBeGreaterThan(byGroup.size * 0.9)

    // 题号连续、成组
    const groups = new Set(res.questions.map((q) => q.tags.find((t) => t.startsWith('group:'))))
    expect(groups.size).toBeGreaterThan(30)

    // eslint-disable-next-line no-console
    // eslint-disable-next-line no-console
    // eslint-disable-next-line no-console
  })

  it.runIf(fs.existsSync(SAMPLE))('每个题组都是 7 道跟读 + 4 道面试', async () => {
    const pages = await extractPages(SAMPLE)
    const res = parseQuestionsFromPages(pages)
    const byGroup = new Map<string, { rep: number; itv: number }>()
    for (const q of res.questions) {
      const g = q.tags.find((t) => t.startsWith('group:')) ?? ''
      const cur = byGroup.get(g) ?? { rep: 0, itv: 0 }
      if (q.taskType === 'LISTEN_REPEAT') cur.rep += 1
      else cur.itv += 1
      byGroup.set(g, cur)
    }
    const complete = [...byGroup.values()].filter((v) => v.rep === 7 && v.itv === 4).length
    // 实测：117 个题组里 115 个是完整的 7+4；另 2 个是源 PDF 本身缺第 11 题 / 页面错乱
    expect(complete).toBeGreaterThanOrEqual(byGroup.size - 2)
    expect(complete / byGroup.size).toBeGreaterThan(0.95)
  })

  it.runIf(fs.existsSync(SAMPLE))('场景与题干彻底分开：跟读题的题干是指令、场景里没有目标句', async () => {
    const pages = await extractPages(SAMPLE)
    const res = parseQuestionsFromPages(pages)
    const repeat = res.questions.filter((q) => q.taskType === 'LISTEN_REPEAT')

    expect(repeat.length).toBeGreaterThan(300)
    // 跟读题的题干必须是真正的句子，不能是「语法指令」那一行
    for (const q of repeat) {
      expect(q.questionText).not.toMatch(/Listen to .* and repeat/i)
      expect(q.questionText).not.toMatch(/Repeat only once/i)
      expect(q.responseTime).toBeGreaterThanOrEqual(8)
      expect(q.responseTime).toBeLessThanOrEqual(12)
      expect(q.preparationTime).toBe(0)
    }
    // 场景要真的被抽出来
    // 实测约 84% 的套题在 PDF 里写了场景，其余套题本身就没有场景文字
    const withCtx = repeat.filter((q) => (q.contextText ?? '').length > 20)
    expect(withCtx.length / repeat.length).toBeGreaterThan(0.8)
    // 场景里绝不能出现本题的目标句（否则等于泄题）
    const leak = repeat.filter((q) => (q.contextText ?? '').includes(q.questionText))
    expect(leak.length).toBe(0)
  })
})
