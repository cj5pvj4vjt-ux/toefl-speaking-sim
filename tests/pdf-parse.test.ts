import { describe, expect, it } from 'vitest'
import {
  collapseGlyphSpacing,
  isLikelyScanned,
  newId,
  normalizePageText,
  parseQuestionsFromPages,
  pickExamQuestions
} from '@shared/pdf/parseQuestions'
import { SAMPLE_SCRIPT, groupOf, makeQuestion } from './helpers'

describe('PDF 文本归一化', () => {
  it('统一不可见字符与智能引号', () => {
    const out = normalizePageText('a\u00a0b\u2019s \u201cquoted\u201d\r\nnext')
    expect(out).toContain('a b')
    expect(out).toContain("a b's \"quoted\"")
    expect(out).not.toContain('\r')
  })

  it('修复英文连字符断行', () => {
    expect(normalizePageText('informa-\ntion')).toContain('information')
  })
})

describe('PDF 逐字拆开噪声修复（真实真题库的典型形态）', () => {
  it('合并被空格拆散的日期与题号', () => {
    expect(collapseGlyphSpacing('2 0 2 6 年 1 月 2 1 日 第 1 套')).toBe('2026年1月21日第1套')
    expect(collapseGlyphSpacing('【 参 考 3 月 1 0 日 第 1 套 】')).toBe('【参考3月10日第1套】')
  })

  it('不会误伤正常英文句子', () => {
    const line = 'You are working a part-time job at a grocery store near campus.'
    expect(collapseGlyphSpacing(line)).toBe(line)
    expect(collapseGlyphSpacing('a b normal words')).toBe('a b normal words')
  })

  it('保留换行结构', () => {
    expect(collapseGlyphSpacing('A B C\nnext line')).toBe('ABC\nnext line')
  })
})

/* ============ 2026 新版托福口语：7 题听后重复 + 4 题虚拟面试 ============ */

const parseSample = () => parseQuestionsFromPages([{ page: 1, text: SAMPLE_SCRIPT }])

describe('2026 新托福口语题组解析', () => {
  it('识别出两套题', () => {
    const groups = new Set(parseSample().questions.map((q) => groupOf(q)))
    expect(groups.size).toBe(2)
  })

  it('每套题拆成 7 道跟读 + 4 道面试，正好 11 题', () => {
    const { questions } = parseSample()
    const groups = [...new Set(questions.map((q) => groupOf(q)))]
    for (const g of groups) {
      const inGroup = questions.filter((q) => groupOf(q) === g)
      expect(inGroup.filter((q) => q.taskType === 'LISTEN_REPEAT').length).toBe(7)
      expect(inGroup.filter((q) => q.taskType === 'INTERVIEW').length).toBe(4)
      expect(inGroup.length).toBe(11)
    }
    expect(questions.length).toBe(22)
  })

  it('只会产生官方两个题型，不会出现别的题型', () => {
    const kinds = new Set(parseSample().questions.map((q) => q.taskType))
    expect([...kinds].sort()).toEqual(['INTERVIEW', 'LISTEN_REPEAT'])
  })

  it('跟读句提取为独立小题，句子内容完整', () => {
    const first = parseSample().questions.find((q) => q.taskType === 'LISTEN_REPEAT')!
    expect(first.questionText).toBe('Milk and Yogurt are in the dairy section.')
    // 跟读题要播放句子给考生听，因此必须有听力文本
    expect(first.listeningText).toBe('Milk and Yogurt are in the dairy section.')
  })

  it('面试题不会被跟读句污染', () => {
    const q8 = parseSample().questions.find(
      (q) => q.taskType === 'INTERVIEW' && q.questionText.includes('health and wellness habits')
    )!
    expect(q8).toBeTruthy()
    expect(q8.questionText).not.toMatch(/Milk and Yogurt/)
  })

  it('参考答案一律不录入题库', () => {
    const { questions } = parseSample()
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every((q) => q.referenceAnswer === null)).toBe(true)
  })

  it('参考答案的正文绝不混进题干（Question N / 【文】/【简单版】/答案：都不能漏进来）', () => {
    const { questions } = parseSample()
    for (const q of questions) {
      expect(q.questionText).not.toMatch(/【\s*(简单版|范文|答案|文)\s*】/)
      expect(q.questionText).not.toMatch(/^Questions?\s*\d/i)
      expect(q.questionText).not.toMatch(/^答案\s*[:：]/)
      expect(q.questionText).not.toMatch(/balanced and healthy diet/)
    }
  })

  it('场景（Directions）与题干分开存：跟读题的题干是句子本身，场景里不出现该句', () => {
    const { questions } = parseSample()
    const repeat = questions.filter((q) => q.taskType === 'LISTEN_REPEAT')
    expect(repeat.length).toBeGreaterThan(0)

    for (const q of repeat) {
      // 指令那行是场景，不是题
      expect(q.questionText).not.toMatch(/Listen to .* and repeat/i)
      expect(q.questionText).not.toMatch(/Repeat only once/i)
      // 官方：跟读题没有准备时间
      expect(q.preparationTime).toBe(0)
    }

    const withCtx = repeat.filter((q) => (q.contextText ?? '').length > 10)
    expect(withCtx.length).toBe(repeat.length)
    // 场景里绝不能出现目标句，否则等于泄题
    for (const q of repeat) expect(q.contextText ?? '').not.toContain(q.questionText)
  })

  it('跟读题作答时间按官方 8 / 10 / 12 秒递增', () => {
    const repeats = parseSample().questions.filter((q) => q.taskType === 'LISTEN_REPEAT')
    for (const q of repeats) {
      expect([8, 10, 12]).toContain(q.responseTime)
    }
    // 长短句应当拿到不同时长，体现官方「由短到长递增」
    expect(new Set(repeats.map((q) => q.responseTime)).size).toBeGreaterThan(1)
  })

  it('考试全程没有准备时间（官方：无准备时间，听完立刻作答）', () => {
    for (const q of parseSample().questions) {
      expect(q.preparationTime).toBe(0)
    }
  })

  it('面试题作答时间 45 秒（官方口径）', () => {
    const interview = parseSample().questions.filter((q) => q.taskType === 'INTERVIEW')
    for (const q of interview) {
      expect(q.responseTime).toBe(45)
    }
  })

  it('题组标记与题号写进 tags，方便按套练', () => {
    const q8 = parseSample().questions.find((q) => q.taskType === 'INTERVIEW' && q.tags.includes('no:8'))
    expect(q8).toBeTruthy()
    expect(q8!.tags.some((t) => t.startsWith('group:'))).toBe(true)
  })
})

describe('扫描件判定', () => {
  it('有文字层时不会被判成扫描件', () => {
    expect(isLikelyScanned([{ page: 1, text: SAMPLE_SCRIPT }])).toBe(false)
  })

  it('整页无文字时判成扫描件', () => {
    expect(isLikelyScanned([{ page: 1, text: '' }, { page: 2, text: '  ' }])).toBe(true)
  })
})

/* ===================== 组卷 ===================== */

describe('组卷（pickExamQuestions）', () => {
  const pool = parseSample().questions

  it('完整考试取同一整套题，两个题型都要有', () => {
    const picked = pickExamQuestions(pool, 'FULL')
    expect(new Set(picked.map((q) => groupOf(q))).size).toBe(1)
    const kinds = new Set(picked.map((q) => q.taskType))
    expect(kinds.has('LISTEN_REPEAT')).toBe(true)
    expect(kinds.has('INTERVIEW')).toBe(true)
  })

  it('完整考试应当抽满 11 题', () => {
    expect(pickExamQuestions(pool, 'FULL').length).toBe(11)
  })

  it('专项模式只取对应任务', () => {
    const repeats = pickExamQuestions(pool, 'LISTEN_REPEAT')
    expect(repeats.length).toBeGreaterThan(0)
    expect(repeats.every((q) => q.taskType === 'LISTEN_REPEAT')).toBe(true)

    const interview = pickExamQuestions(pool, 'INTERVIEW')
    expect(interview.every((q) => q.taskType === 'INTERVIEW')).toBe(true)
  })

  it('自定义模式：从同一题组里取所选题型', () => {
    const picked = pickExamQuestions(pool, 'CUSTOM', ['INTERVIEW', 'LISTEN_REPEAT'])
    expect(new Set(picked.map((q) => q.taskType))).toEqual(new Set(['INTERVIEW', 'LISTEN_REPEAT']))
    const groups = new Set(picked.map((q) => q.tags.find((t) => t.startsWith('group:')) ?? ''))
    expect(groups.size).toBe(1)
  })

  it('专项模式只出该题型，且不会把全库同题型堆成一场考试', () => {
    const onlyRepeat = pickExamQuestions(pool, 'LISTEN_REPEAT')
    expect(onlyRepeat.length).toBeGreaterThan(0)
    expect(onlyRepeat.every((q) => q.taskType === 'LISTEN_REPEAT')).toBe(true)
    expect(onlyRepeat.length).toBeLessThanOrEqual(7)

    const onlyInterview = pickExamQuestions(pool, 'INTERVIEW')
    expect(onlyInterview.every((q) => q.taskType === 'INTERVIEW')).toBe(true)
    expect(onlyInterview.length).toBeLessThanOrEqual(4)
  })

  it('题库缺少某个题型时不会崩溃', () => {
    const onlyRepeat = pool.filter((q) => q.taskType === 'LISTEN_REPEAT')
    expect(() => pickExamQuestions(onlyRepeat, 'FULL')).not.toThrow()
    expect(pickExamQuestions(onlyRepeat, 'INTERVIEW')).toEqual([])
  })

  it('空题库返回空数组', () => {
    expect(pickExamQuestions([], 'FULL')).toEqual([])
  })
})

describe('newId', () => {
  it('生成的 id 不重复', () => {
    expect(new Set(Array.from({ length: 200 }, () => newId('q'))).size).toBe(200)
  })
})

describe('手工题目构造', () => {
  it('makeQuestion 支持两个官方题型', () => {
    for (const t of ['LISTEN_REPEAT', 'INTERVIEW'] as const) {
      const q = makeQuestion({ taskType: t })
      expect(q.taskType).toBe(t)
      expect(q.responseTime).toBeGreaterThan(0)
    }
  })
})
