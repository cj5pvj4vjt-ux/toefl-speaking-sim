import { describe, expect, it } from 'vitest'
import {
  bandFromAverage,
  buildTaskScoreEntries,
  computeOverall,
  estimateLevel,
  formatScore,
  pickQuestionsForMode,
  taskIndex,
  toPercent
} from '@shared/scoring/convert'
import { BAND_MAX, BAND_MIN, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '@shared/constants'
import { makeQuestion, makeScore } from './helpers'
import type { QuestionScore } from '@shared/types'

describe('官方分档常量（2026 新版托福）', () => {
  it('单项分是 1-6 分档，单题满分 6', () => {
    expect(BAND_MIN).toBe(1)
    expect(BAND_MAX).toBe(6)
    expect(MAX_RESPONSE_SCORE).toBe(6)
  })

  it('只有官方公布的两个题型，顺序与官方一致', () => {
    expect(TASK_TYPES).toEqual(['LISTEN_REPEAT', 'INTERVIEW'])
    expect(TASK_META.LISTEN_REPEAT.index).toBe(1)
    expect(TASK_META.INTERVIEW.index).toBe(2)
  })

  it('官方时间规格：全程无准备时间，跟读 8-12 秒，面试 45 秒', () => {
    expect(TASK_META.LISTEN_REPEAT.prepTime).toBe(0)
    expect(TASK_META.INTERVIEW.prepTime).toBe(0)
    expect(TASK_META.INTERVIEW.responseTime).toBe(45)
    expect(TASK_META.LISTEN_REPEAT.responseTime).toBeGreaterThanOrEqual(8)
    expect(TASK_META.LISTEN_REPEAT.responseTime).toBeLessThanOrEqual(12)
  })

  it('跟读题必须有听力材料，面试题不需要阅读材料', () => {
    expect(TASK_META.LISTEN_REPEAT.hasListening).toBe(true)
    expect(TASK_META.INTERVIEW.hasReading).toBe(false)
  })
})

describe('bandFromAverage：平均分 → 1-6 分档', () => {
  it('永远落在 1-6 之间且是 0.5 的整数倍', () => {
    for (let a = -3; a <= 9; a += 0.1) {
      const b = bandFromAverage(a)!
      expect(b).toBeGreaterThanOrEqual(BAND_MIN)
      expect(b).toBeLessThanOrEqual(BAND_MAX)
      expect(Math.round(b * 2)).toBeCloseTo(b * 2, 6)
    }
  })

  it('单调不减', () => {
    let prev = -1
    for (let a = 0; a <= 6; a += 0.25) {
      const b = bandFromAverage(a)!
      expect(b).toBeGreaterThanOrEqual(prev)
      prev = b
    }
  })

  it('边界值符合直觉：0 → 1，6 → 6', () => {
    expect(bandFromAverage(0)).toBe(1)
    expect(bandFromAverage(6)).toBe(6)
    expect(bandFromAverage(3)).toBe(3)
    expect(bandFromAverage(4.3)).toBe(4.5)
  })

  it('非法输入返回 null 而不是 NaN', () => {
    expect(bandFromAverage(null)).toBeNull()
    expect(bandFromAverage(undefined)).toBeNull()
    expect(bandFromAverage(NaN)).toBeNull()
    expect(bandFromAverage(Infinity)).toBeNull()
  })
})

describe('toPercent：0-6 映射到 0-100', () => {
  it('保留整数百分比', () => {
    expect(toPercent(0)).toBe(0)
    expect(toPercent(3)).toBe(50)
    expect(toPercent(6)).toBe(100)
    expect(toPercent(4.5)).toBe(75)
  })

  it('非法输入返回 null', () => {
    expect(toPercent(null)).toBeNull()
    expect(toPercent(NaN)).toBeNull()
  })
})

describe('buildTaskScoreEntries', () => {
  it('两个题型各生成一条，维度取平均', () => {
    const entries = buildTaskScoreEntries([
      { taskType: 'LISTEN_REPEAT', score: makeScore({ score: 4, delivery: 4, language_use: 5, topic_development: 3 }) },
      { taskType: 'LISTEN_REPEAT', score: makeScore({ score: 6, delivery: 5, language_use: 5, topic_development: 5 }) },
      { taskType: 'INTERVIEW', score: makeScore({ score: 5 }) }
    ])
    expect(entries.length).toBe(2)

    const rep = entries.find((e) => e.taskType === 'LISTEN_REPEAT')!
    expect(rep.rawScore).toBe(5)
    expect(rep.responseCount).toBe(2)
    expect(rep.delivery).toBe(4.5)
    expect(rep.topicDevelopment).toBe(4)

    const itv = entries.find((e) => e.taskType === 'INTERVIEW')!
    expect(itv.responseCount).toBe(1)
    expect(itv.rawScore).toBe(5)
  })

  it('没有分数的题型返回 null 且 responseCount 为 0', () => {
    const entries = buildTaskScoreEntries([{ taskType: 'LISTEN_REPEAT', score: makeScore({}) }])
    const itv = entries.find((e) => e.taskType === 'INTERVIEW')!
    expect(itv.rawScore).toBeNull()
    expect(itv.band).toBeNull()
    expect(itv.responseCount).toBe(0)
  })

  it('忽略 null 分数项', () => {
    const entries = buildTaskScoreEntries([
      { taskType: 'INTERVIEW', score: null },
      { taskType: 'INTERVIEW', score: makeScore({ score: 4 }) }
    ])
    expect(entries.find((e) => e.taskType === 'INTERVIEW')!.responseCount).toBe(1)
  })
})

describe('computeOverall：Speaking 单项分', () => {
  const entriesFor = (repeats: number[], interviews: number[]) =>
    buildTaskScoreEntries([
      ...repeats.map((n) => ({ taskType: 'LISTEN_REPEAT' as const, score: makeScore({ score: n }) })),
      ...interviews.map((n) => ({ taskType: 'INTERVIEW' as const, score: makeScore({ score: n }) }))
    ])

  it('按回答数加权，而不是两个题型等权', () => {
    // 7 题跟读都是 6 分，4 题面试都是 1 分
    const entries = entriesFor([6, 6, 6, 6, 6, 6, 6], [1, 1, 1, 1])
    const { overall, rawAverage } = computeOverall(entries, 'FULL')
    // (6*7 + 1*4) / 11 = 46/11 ≈ 4.18 → 4
    expect(rawAverage).toBe(4.2)
    expect(overall).toBe(4)
  })

  it('完整考试不算「预测」，专项模式算预测', () => {
    expect(computeOverall(entriesFor([5], [5]), 'FULL').projected).toBe(false)
    expect(computeOverall(entriesFor([5], []), 'LISTEN_REPEAT').projected).toBe(true)
  })

  it('没有任何分数时返回 null', () => {
    const r = computeOverall(buildTaskScoreEntries([]), 'FULL')
    expect(r.overall).toBeNull()
    expect(r.rawAverage).toBeNull()
    expect(r.projected).toBe(false)
  })

  it('满分得到 Band 6，最低分得到 Band 1', () => {
    expect(computeOverall(entriesFor([6], [6]), 'FULL').overall).toBe(6)
    expect(computeOverall(entriesFor([0], [0]), 'FULL').overall).toBe(1)
  })
})

describe('taskIndex / formatScore', () => {
  it('taskIndex 与 TASK_META 一致', () => {
    expect(taskIndex('LISTEN_REPEAT')).toBe(1)
    expect(taskIndex('INTERVIEW')).toBe(2)
  })

  it('formatScore 保留一位小数、空值显示 --', () => {
    expect(formatScore(4)).toBe('4')
    expect(formatScore(4.5)).toBe('4.5')
    expect(formatScore(null)).toBe('--')
    expect(formatScore(NaN)).toBe('--')
  })
})

describe('estimateLevel', () => {
  it('覆盖 1-6 六个档位', () => {
    expect(estimateLevel(6)).toContain('Band 6')
    expect(estimateLevel(5)).toContain('Band 5')
    expect(estimateLevel(4)).toContain('Band 4')
    expect(estimateLevel(3)).toContain('Band 3')
    expect(estimateLevel(2)).toContain('Band 2')
    expect(estimateLevel(1)).toContain('Band 1')
    expect(estimateLevel(null)).toBe('暂无')
  })
})

describe('pickQuestionsForMode', () => {
  const pool: ReturnType<typeof makeQuestion>[] = []
  for (const g of ['group:A', 'group:B']) {
    pool.push(
      makeQuestion({ taskType: 'LISTEN_REPEAT', tags: [g, 'no:1'] }),
      makeQuestion({ taskType: 'INTERVIEW', tags: [g, 'no:8'] })
    )
  }

  it('FULL：只取同一个题组，且两个题型齐全', () => {
    const picked = pickQuestionsForMode(pool, 'FULL')
    const groups = new Set(picked.map((q) => q.tags[0]))
    expect(groups.size).toBe(1)
    expect(new Set(picked.map((q) => q.taskType)).size).toBe(2)
  })

  it('专项：只取对应题型，且整套取（跟读 7 / 面试 4）', () => {
    const picked = pickQuestionsForMode(pool, 'INTERVIEW')
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.every((q) => q.taskType === 'INTERVIEW')).toBe(true)

    const onlyRepeat = pickQuestionsForMode(pool, 'LISTEN_REPEAT')
    expect(onlyRepeat.every((q) => q.taskType === 'LISTEN_REPEAT')).toBe(true)
    // 专项模式绝不能把全库同题型混在一起
    expect(onlyRepeat.length).toBeLessThanOrEqual(7)
    expect(picked.length).toBeLessThanOrEqual(4)
  })

  it('CUSTOM：从同一题组里取所需题型，不会把两种题型串到不同套题上', () => {
    const both = pickQuestionsForMode(pool, 'CUSTOM', ['LISTEN_REPEAT', 'INTERVIEW'])
    const groups = new Set(both.map((q) => q.tags.find((t) => t.startsWith('group:')) ?? ''))
    expect(groups.size).toBe(1)
    expect(new Set(both.map((q) => q.taskType))).toEqual(new Set(['LISTEN_REPEAT', 'INTERVIEW']))
  })

  it('FULL：取一个完整题组', () => {
    const picked = pickQuestionsForMode(pool, 'FULL')
    const groups = new Set(picked.map((q) => q.tags.find((t) => t.startsWith('group:')) ?? ''))
    expect(groups.size).toBe(1)
  })

  it('题库为空时返回空数组', () => {
    expect(pickQuestionsForMode([], 'FULL')).toEqual([])
  })
})

describe('QuestionScore 结构与官方三维度对齐', () => {
  it('makeScore 产出的分数落在 0-6', () => {
    const s: QuestionScore = makeScore({ score: 5.5 })
    expect(s.score).toBe(5.5)
    expect(s.score).toBeLessThanOrEqual(MAX_RESPONSE_SCORE)
  })
})
