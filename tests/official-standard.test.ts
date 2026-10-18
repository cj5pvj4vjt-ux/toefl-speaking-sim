import { describe, expect, it } from 'vitest'
import {
  AI_DIMENSIONS,
  BAND_MAX,
  BAND_MIN,
  BAND_STEP,
  MAX_RESPONSE_SCORE,
  TASK_DIRECTIONS,
  TASK_META,
  TASK_TYPES
} from '@shared/constants'
import { bandFromAverage, buildTaskScoreEntries, computeOverall, pickQuestionsForMode } from '@shared/scoring/convert'
import type { QuestionScore } from '@shared/types'
import { loadRealPdfPages, parseRealPdf } from './helpers'

/**
 * 这个文件专门钉住 **2026 新托福口语的官方流程与反馈标准**。
 *
 * 目的不是测「代码能跑」，而是测「跑出来的是不是新托福」：
 * 一旦有人把旧 iBT / Essentials 的题型、时间、分档改回来，这里必须立刻红。
 */

const OFFICIAL_REPEAT_RESPONSE_TIMES = [8, 10, 12]

describe('官方题型：只有 2 个大题', () => {
  it('题型恰好是 Listen and Repeat + Take an Interview，不含任何旧题型', () => {
    expect(TASK_TYPES).toEqual(['LISTEN_REPEAT', 'INTERVIEW'])
    // 旧托福 / Essentials 的题型一律不得出现
    const legacy = ['READ_ALOUD', 'INDEPENDENT', 'INTEGRATED', 'BUILD_A_SENTENCE', 'WRITE_AN_EMAIL']
    for (const t of legacy) {
      expect(TASK_TYPES as string[]).not.toContain(t)
      expect(Object.keys(TASK_META)).not.toContain(t)
    }
  })

  it('大题顺序与官方一致：先跟读、后面试', () => {
    expect(TASK_META.LISTEN_REPEAT.index).toBe(1)
    expect(TASK_META.INTERVIEW.index).toBe(2)
  })

  it('官方时长：跟读 0 秒准备，面试 0 秒准备 / 45 秒作答', () => {
    expect(TASK_META.LISTEN_REPEAT.prepTime).toBe(0)
    expect(TASK_META.INTERVIEW.prepTime).toBe(0)
    expect(TASK_META.INTERVIEW.responseTime).toBe(45)
  })

  it('两种题型都不需要阅读材料（新托福口语没有阅读+朗读）', () => {
    expect(TASK_META.LISTEN_REPEAT.hasReading).toBe(false)
    expect(TASK_META.INTERVIEW.hasReading).toBe(false)
  })
})

describe('官方 Directions 文案', () => {
  it('跟读指令采用官方表述，且只播一遍', () => {
    expect(TASK_DIRECTIONS.LISTEN_REPEAT).toContain('You will listen as someone speaks to you')
    expect(TASK_DIRECTIONS.LISTEN_REPEAT).toContain('repeat what you have heard')
    expect(TASK_DIRECTIONS.LISTEN_REPEAT).toContain('Repeat only once')
  })

  it('Directions 里绝不能出现任何目标句（否则跟读变成朗读）', async () => {
    const questions = await parseRealPdf()
    const repeats = questions.filter((q) => q.taskType === 'LISTEN_REPEAT')
    expect(repeats.length).toBeGreaterThan(0)
    for (const q of repeats) {
      const directions = `${q.contextText ?? ''} ${TASK_DIRECTIONS.LISTEN_REPEAT}`
      const target = q.questionText.trim().replace(/[.?!]+$/, '')
      if (target.length < 12) continue
      expect(directions).not.toContain(target)
    }
  })
})

describe('官方流程：一套 11 题 = 7 跟读 + 4 面试', () => {
  it('整套抽题恰好 11 题，题号 1-7 跟读、8-11 面试', async () => {
    const questions = await parseRealPdf()
    const full = pickQuestionsForMode(questions, 'FULL')
    expect(full.length).toBe(11)
    expect(full.filter((q) => q.taskType === 'LISTEN_REPEAT').length).toBe(7)
    expect(full.filter((q) => q.taskType === 'INTERVIEW').length).toBe(4)
  })

  it('专项练习：只考跟读给 7 题，只考面试给 4 题', async () => {
    const questions = await parseRealPdf()
    const repeatOnly = pickQuestionsForMode(questions, 'LISTEN_REPEAT')
    const interviewOnly = pickQuestionsForMode(questions, 'INTERVIEW')
    expect(repeatOnly.length).toBe(7)
    expect(repeatOnly.every((q) => q.taskType === 'LISTEN_REPEAT')).toBe(true)
    expect(interviewOnly.length).toBe(4)
    expect(interviewOnly.every((q) => q.taskType === 'INTERVIEW')).toBe(true)
  })

  it('跟读每题 0 秒准备，作答 8/10/12 秒三档', async () => {
    const questions = await parseRealPdf()
    const repeats = questions.filter((q) => q.taskType === 'LISTEN_REPEAT')
    for (const q of repeats) {
      expect(q.preparationTime).toBe(0)
      expect(OFFICIAL_REPEAT_RESPONSE_TIMES).toContain(q.responseTime)
    }
    // 三档都要真实存在，不能全挤在一个值上
    const tiers = new Set(repeats.map((q) => q.responseTime))
    expect([...tiers].sort((a, b) => a - b)).toEqual(OFFICIAL_REPEAT_RESPONSE_TIMES)
  })

  it('作答时间随句子长度递增（官方是这样分档的）', async () => {
    const questions = await parseRealPdf()
    const avg = (sec: number): number => {
      const qs = questions.filter((q) => q.taskType === 'LISTEN_REPEAT' && q.responseTime === sec)
      return qs.reduce((a, q) => a + q.questionText.split(/\s+/).filter(Boolean).length, 0) / qs.length
    }
    expect(avg(8)).toBeLessThan(avg(12))
    expect(avg(10)).toBeLessThan(avg(12))
  })

  it('面试每题 0 秒准备、45 秒作答', async () => {
    const questions = await parseRealPdf()
    const interviews = questions.filter((q) => q.taskType === 'INTERVIEW')
    expect(interviews.length).toBeGreaterThan(0)
    for (const q of interviews) {
      expect(q.preparationTime).toBe(0)
      expect(q.responseTime).toBe(45)
    }
  })

  it('整个题库不含参考答案（官方考试不会给答案）', async () => {
    const questions = await parseRealPdf()
    expect(questions.every((q) => q.referenceAnswer === null)).toBe(true)
  })
})

describe('官方评分标准：1-6 分档、0.5 步长、三个维度', () => {
  it('档位区间是 1-6、步长 0.5、单题满分 6', () => {
    expect(BAND_MIN).toBe(1)
    expect(BAND_MAX).toBe(6)
    expect(BAND_STEP).toBe(0.5)
    expect(MAX_RESPONSE_SCORE).toBe(6)
  })

  it('三个维度与官方绩效描述对齐，且不含旧 iBT 的维度', () => {
    expect(AI_DIMENSIONS.map((d) => d.key)).toEqual(['delivery', 'language_use', 'topic_development'])
    expect(AI_DIMENSIONS).toHaveLength(3)
  })

  const score = (v: number): QuestionScore => ({
    task: 1,
    score: v,
    delivery: v,
    language_use: v,
    topic_development: v,
    feedback: '',
    confidence: 1,
    strengths: [],
    weaknesses: [],
    suggestions: [],
    revised_response: 'Revised answer text.'
  })

  it('总成绩是各小题平均后按 0.5 取档，落在 1-6 之间', () => {
    const entries = buildTaskScoreEntries([
      { taskType: 'LISTEN_REPEAT', score: score(3) },
      { taskType: 'INTERVIEW', score: score(5) }
    ])
    const { overall } = computeOverall(entries, 'FULL')
    expect(overall).toBe(4)
    expect(overall as number).toBeGreaterThanOrEqual(BAND_MIN)
    expect(overall as number).toBeLessThanOrEqual(BAND_MAX)
  })

  it('分数只落在 0.5 的整数倍上，不会出现 4.33 这种档位', () => {
    const entries = buildTaskScoreEntries([
      { taskType: 'LISTEN_REPEAT', score: score(4) },
      { taskType: 'INTERVIEW', score: score(4.5) }
    ])
    const { overall, rawAverage } = computeOverall(entries, 'FULL')
    expect(rawAverage).toBe(4.3)
    expect(overall).toBe(4.5)
    const halves = (overall as number) / BAND_STEP
    expect(Math.abs(halves - Math.round(halves))).toBeLessThan(1e-6)
  })

  it('专项练习的成绩标记为「预测整卷」，不谎报为真实整卷分', () => {
    const entries = buildTaskScoreEntries([{ taskType: 'LISTEN_REPEAT', score: score(5) }])
    expect(computeOverall(entries, 'LISTEN_REPEAT').projected).toBe(true)
    expect(computeOverall(entries, 'FULL').projected).toBe(false)
  })

  it('bandFromAverage 边界：0 分兜到 1、满分封顶 6', () => {
    expect(bandFromAverage(0)).toBe(BAND_MIN)
    expect(bandFromAverage(6)).toBe(BAND_MAX)
    expect(bandFromAverage(9)).toBe(BAND_MAX)
    expect(bandFromAverage(null)).toBeNull()
  })
})

describe('评分 Prompt 的口径：新托福任务名，禁止旧术语', () => {
  it('两份 Prompt 都写明了 2026 两大题与 0-6 分制', async () => {
    const { TOEFL_SCORING_SYSTEM_PROMPT, EXAM_SUMMARY_SYSTEM_PROMPT } = await import('@shared/scoring/prompts')
    const b = await import('@shared/scoring/prompts')
    const all = `${TOEFL_SCORING_SYSTEM_PROMPT}\n${EXAM_SUMMARY_SYSTEM_PROMPT}\n${Object.values(b)
      .filter((v) => typeof v === 'string')
      .join('\n')}`
    expect(all).toContain('2026')
    expect(all).toMatch(/Listen and Repeat/)
    expect(all).toMatch(/Take an Interview/)
    expect(all).toMatch(/0-6/)
    expect(all).toMatch(/7 responses/)
    expect(all).toMatch(/4 responses/)
  })

  it('Prompt 明确禁止使用旧版术语，避免给出误导性反馈', async () => {
    const { TOEFL_SCORING_SYSTEM_PROMPT, EXAM_SUMMARY_SYSTEM_PROMPT } = await import('@shared/scoring/prompts')
    for (const p of [TOEFL_SCORING_SYSTEM_PROMPT, EXAM_SUMMARY_SYSTEM_PROMPT]) {
      expect(p).toMatch(/legacy iBT|legacy iBT\/Essentials/)
      expect(p).toContain('独立题')
      expect(p).toContain('Read Aloud')
    }
  })
})

describe('评分口径守卫：展示层的分母必须是 6 分制', () => {
  /**
   * 展示层出现过 "/16"、"/4"、"/30"、"0-4 分" 这类与官方量表不符的分母，
   * 会让报告里的分数和新托福完全对不上。这里直接扫源码守住口径。
   */
  const files = [
    'src/renderer/src/pages/Report.tsx',
    'src/renderer/src/pages/Dashboard.tsx',
    'src/renderer/src/pages/History.tsx',
    'src/renderer/src/components/charts.tsx',
    'src/electron/services/reports/pdfReport.ts'
  ]

  it('报告/看板/历史里不出现 /16、/12、/30、max={4}、0-4 分这类旧分母', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const offenders: string[] = []
    for (const f of files) {
      const abs = path.resolve(__dirname, '..', f)
      if (!fs.existsSync(abs)) continue
      const src = fs.readFileSync(abs, 'utf8')
      const patterns: [RegExp, string][] = [
        [/\/\s*16/, '/ 16'],
        [/\/\s*12(?![0-9])/, '/ 12'],
        // 30 分制分母同样必须禁止：报告与看板的分母只能是 6。
        [/\/\s*30(?![0-9])/, '/ 30'],
        [/max=\{4\}/, 'max={4}'],
        [/fullMark:\s*4\b/, 'fullMark: 4'],
        [/0-4\s*分|（0-4）|\(0-4\)|0-4\s*制/, '0-4 分'],
        [/0-16|0-30/, '0-16 / 0-30 换算']
      ]
      for (const [re, label] of patterns) {
        if (re.test(src)) offenders.push(`${f} 里仍有旧分母 ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('分数上限全部来自 MAX_RESPONSE_SCORE，而不是散落的字面量', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/pages/Report.tsx'), 'utf8')
    expect(src).toContain('MAX_RESPONSE_SCORE')
    expect(src).toContain('/ 6')
  })
})

describe('AI 修改后的回答：随评分一起产出，并在报告与 PDF 里展示', () => {
  it('评分 Prompt 要求模型返回 revised_response，并给出改写规则', async () => {
    const { TOEFL_SCORING_SYSTEM_PROMPT } = await import('@shared/scoring/prompts')
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toContain('revised_response')
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toContain('REVISED RESPONSE')
  })

  it('旧记录缺字段时能反序列化为空串，而有效分数必须给出改写回答', async () => {
    const { QuestionScoreSchema } = await import('@shared/schemas')

    // 迁移前存下的评分 JSON 里没有 revised_response，必须仍然解析成功
    const legacy = QuestionScoreSchema.safeParse({
      task: 1,
      score: 0,
      delivery: 0,
      language_use: 0,
      content: 0,
      feedback: '未检测到可评估的语音。',
      confidence: 0.1
    })
    expect(legacy.success).toBe(true)
    expect(legacy.success && legacy.data.revised_response).toBe('')

    // 有分数却没有改写回答 → 判为不合法，由引擎的修复重试补全
    const missing = QuestionScoreSchema.safeParse({
      task: 1,
      score: 4,
      delivery: 4,
      language_use: 4,
      content: 4,
      feedback: '表达清晰，观点明确。',
      confidence: 0.8
    })
    expect(missing.success).toBe(false)
  })

  it('评分 JSON Schema 仍能生成，并包含 revised_response（保证模型被强约束）', async () => {
    const { QuestionScoreSchema } = await import('@shared/schemas')
    const { z } = await import('zod')
    const toJSON = (z as unknown as { toJSONSchema?: (s: unknown, o?: unknown) => unknown }).toJSONSchema
    expect(typeof toJSON).toBe('function')
    const schema = toJSON!(QuestionScoreSchema, { target: 'draft-07', io: 'input' }) as Record<string, unknown>
    expect(schema).toBeTruthy()
    expect(JSON.stringify(schema)).toContain('revised_response')
  })

  it('报告页与 PDF 报告都会渲染改写后的回答', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    for (const f of ['src/renderer/src/pages/Report.tsx', 'src/electron/services/reports/pdfReport.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8')
      expect(src).toContain('revised_response')
    }
  })
})

describe('真实 PDF 的整体结构', () => {
  it('每套都是 7+4，缺题的套数不超过 2（原文缺陷）', async () => {
    const questions = await parseRealPdf()
    const groups = new Map<string, { r: number; i: number }>()
    for (const q of questions) {
      const g = q.tags.find((t) => t.startsWith('group:')) ?? ''
      const c = groups.get(g) ?? { r: 0, i: 0 }
      if (q.taskType === 'LISTEN_REPEAT') c.r += 1
      else c.i += 1
      groups.set(g, c)
    }
    expect(groups.size).toBeGreaterThan(100)
    const complete = [...groups.values()].filter((v) => v.r === 7 && v.i === 4).length
    expect(complete).toBeGreaterThanOrEqual(groups.size - 2)
  })

  it('页面提取口径与 App 一致（原始 pdf.js item，含 hasEOL）', async () => {
    const pages = await loadRealPdfPages()
    expect(pages.length).toBe(164)
    // 有文字层的页数（App 里显示 163 页）
    const withText = pages.filter((p) => p.text.replace(/\s/g, '').length >= 25).length
    expect(withText).toBe(163)
  })
})
