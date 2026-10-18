import { describe, expect, it, vi } from 'vitest'
import { parseLooseJson, extractFirstJsonObject, repairJson, stripCodeFences } from '@shared/parsing/json'
import { QuestionScoreSchema } from '@shared/schemas'
import {
  buildLocalFallbackSummary,
  scoreExamSummary,
  scoreQuestion,
  validateQuestionScore
} from '@main/services/scoring/engine'
import { TOEFL_SCORING_SYSTEM_PROMPT } from '@shared/scoring/prompts'
import type { ChatFn } from '@main/services/scoring/engine'

const BASE_CFG = { baseUrl: 'https://example.test/v1', apiKey: 'sk-test', model: 'gpt-4o' }

const PROMPT_INPUT = {
  taskType: 'INTERVIEW' as const,
  questionText: 'The woman expresses her opinion about the announcement.',
  readingText: 'The library will stay open later.',
  listeningText: 'Woman: I think that is a great idea.',
  transcript:
    'The woman supports the plan because students need more study space during finals and the library is the only place open late.',
  durationMs: 58000,
  wordCount: 24
}

/* ================================================================== */

describe('LLM 返回内容解析（宽松 JSON 抽取）', () => {
  it('剥离 markdown 代码块', () => {
    expect(stripCodeFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('从自然语言包裹中抽取第一个 JSON 对象', () => {
    const raw = 'Sure! Here is the score:\n{"score": 3, "feedback": "不错"}\nHope that helps.'
    const extracted = extractFirstJsonObject(raw)
    expect(extracted).toBe('{"score": 3, "feedback": "不错"}')
  })

  it('正确处理字符串里的大括号', () => {
    const raw = '{"feedback": "use {braces} carefully", "score": 2}'
    expect(extractFirstJsonObject(raw)).toBe(raw)
  })

  it('修复尾随逗号、单引号与全角标点', () => {
    const broken = "{'score': 3, 'feedback': '很好',}"
    const res = parseLooseJson(broken)
    expect(res.ok).toBe(true)
    expect((res.value as { score: number }).score).toBe(3)
  })

  it('修复 Python 风格字面量并补齐缺失的右括号', () => {
    const broken = '{"score": 3, "confidence": 0.9, "extra": None'
    const res = parseLooseJson(broken)
    expect(res.ok).toBe(true)
    expect((res.value as { extra: null }).extra).toBeNull()
  })

  it('无效 JSON 明确失败且不抛异常', () => {
    const res = parseLooseJson('completely not json at all')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('空字符串失败但可控', () => {
    expect(parseLooseJson('').ok).toBe(false)
    expect(repairJson('')).toBe('')
  })
})

/* ================================================================== */

describe('评分结果 Zod 校验（严格结构）', () => {
  const valid = {
    task: 2,
    score: 3,
    delivery: 3,
    language_use: 2.5,
    topic_development: 3,
    feedback: '内容切题，但语言准确性还有提升空间。',
    confidence: 0.85,
    revised_response: 'The response is on topic, though the language could be more accurate.'
  }

  it('接受合法的官方结构', () => {
    const r = validateQuestionScore(valid)
    expect(r.ok).toBe(true)
    expect(r.data?.score).toBe(3)
  })

  it('分数自动收敛到 0-6 且按 0.5 取整', () => {
    const r = validateQuestionScore({ ...valid, score: 5.2, delivery: -1, language_use: 3.3 })
    expect(r.ok).toBe(true)
    expect(r.data!.score).toBe(5)
    expect(r.data!.delivery).toBe(0)
    expect(r.data!.language_use).toBe(3.5)
  })

  it('缺少必填字段时校验失败并给出字段级错误', () => {
    const r = validateQuestionScore({ score: 3, feedback: 'ok' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/task|delivery|language_use|confidence/)
  })

  it('字符串形式的分数也能被接受（模型常见输出）', () => {
    const r = validateQuestionScore({ ...valid, score: '3', delivery: '2.5' })
    expect(r.ok).toBe(true)
    expect(r.data!.score).toBe(3)
    expect(r.data!.delivery).toBe(2.5)
  })

  it('feedback 为空时校验失败（避免空报告）', () => {
    expect(QuestionScoreSchema.safeParse({ ...valid, feedback: '' }).success).toBe(false)
  })
})

/* ================================================================== */

describe('AI 评分引擎', () => {
  it('未配置模型时直接返回可读错误，不发起请求', async () => {
    const chat = vi.fn()
    const res = await scoreQuestion(PROMPT_INPUT, { ...BASE_CFG, model: '' }, { chat: chat as ChatFn })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/模型/)
    expect(chat).not.toHaveBeenCalled()
  })

  it('模型返回合法 JSON 时得到结构化评分', async () => {
    const chat: ChatFn = async () => ({
      ok: true,
      content: JSON.stringify({
        task: 2,
        score: 3.5,
        delivery: 3.5,
        language_use: 3,
        topic_development: 3.5,
        feedback: '流利度较好，词汇可以更丰富。',
        confidence: 0.8,
        revised_response: 'I can speak fluently, but my vocabulary could be richer.'
      })
    })
    const res = await scoreQuestion(PROMPT_INPUT, BASE_CFG, { chat })
    expect(res.ok).toBe(true)
    expect(res.score!.score).toBe(3.5)
    expect(res.attempts).toBe(1)
  })

  it('题号由 App 强制写入，防止模型串题', async () => {
    const chat: ChatFn = async () => ({
      ok: true,
      content: JSON.stringify({
        task: 9,
        score: 3,
        delivery: 3,
        language_use: 3,
        topic_development: 3,
        feedback: 'ok',
        confidence: 0.7,
        revised_response: 'This is the improved answer.'
      })
    })
    const res = await scoreQuestion(PROMPT_INPUT, BASE_CFG, { chat })
    expect(res.ok).toBe(true)
    expect(res.score!.task).toBe(2)
  })

  it('无效 JSON 时会发起一次修复请求，第二次成功则正常返回', async () => {
    let call = 0
    const chat: ChatFn = async () => {
      call += 1
      if (call === 1) return { ok: true, content: 'I think this response deserves a 3.' }
      return {
        ok: true,
        content:
          '{"task":2,"score":3,"delivery":3,"language_use":3,"topic_development":3,"feedback":"已修复","confidence":0.9,"revised_response":"This is the improved answer."}'
      }
    }
    const res = await scoreQuestion(PROMPT_INPUT, BASE_CFG, { chat })
    expect(call).toBe(2)
    expect(res.ok).toBe(true)
    expect(res.score!.feedback).toBe('已修复')
  })

  it('多次都是无效 JSON 时返回失败但保留原始输出片段（不崩溃）', async () => {
    const chat: ChatFn = async () => ({ ok: true, content: 'sorry, I cannot do that' })
    const res = await scoreQuestion(PROMPT_INPUT, BASE_CFG, { chat })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/格式错误/)
    expect(res.raw).toContain('sorry')
    expect(res.attempts).toBe(3)
  })

  it('API 报错时直接失败，不做无意义的修复重试', async () => {
    let call = 0
    const chat: ChatFn = async () => {
      call += 1
      return { ok: false, error: '401 Unauthorized', content: '' }
    }
    const res = await scoreQuestion(PROMPT_INPUT, BASE_CFG, { chat })
    expect(res.ok).toBe(false)
    expect(res.error).toBe('401 Unauthorized')
    expect(call).toBe(1)
  })

  it('打分 Prompt 内固定包含 ETS 三维度与 JSON 输出约束', () => {
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/DELIVERY/i)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/LANGUAGE USE/i)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/CONTENT/i)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/delivery/)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/language_use/)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/topic_development/)
    expect(TOEFL_SCORING_SYSTEM_PROMPT).toMatch(/4/)
  })
})

/* ================================================================== */

describe('整场总结', () => {
  const payload = {
    estimatedScore: 23,
    rawAverage: 11,
    mode: 'FULL',
    items: [
      {
        taskNumber: 1,
        taskType: 'LISTEN_REPEAT',
        score: 3,
        delivery: 3,
        languageUse: 3,
        topicDevelopment: 3,
        transcript: 'I prefer studying alone because I can focus better.',
        question: 'Which do you prefer?'
      }
    ]
  }

  it('总结合法时正常返回', async () => {
    const chat: ChatFn = async () => ({
      ok: true,
      content: JSON.stringify({
        overall_feedback: '整体表现稳定，综合任务的信息整合能力较强。',
        strengths: ['语速自然'],
        weaknesses: ['细节复述不完整'],
        suggestions: ['练习笔记法'],
        recommended_practice: ['Task 3 学术概念复述'],
        estimated_level: 'Band 4 (约 B1+)'
      })
    })
    const res = await scoreExamSummary(payload, BASE_CFG, { chat })
    expect(res.ok).toBe(true)
    expect(res.summary!.strengths).toContain('语速自然')
  })

  it('总结格式错误时失败但给出原因', async () => {
    const chat: ChatFn = async () => ({ ok: true, content: 'not json' })
    const res = await scoreExamSummary(payload, BASE_CFG, { chat })
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('本地兜底总结一定可用（即使 AI 完全失败）', () => {
    const s = buildLocalFallbackSummary(
      [
      {
        taskNumber: 1,
        score: 4,
        delivery: 4,
        languageUse: 3.5,
        topicDevelopment: 4,
        transcript: 'x'.repeat(80)
      },
      {
        taskNumber: 2,
        score: 2,
        delivery: 2,
        languageUse: 2,
        topicDevelopment: 2,
        transcript: 'y'.repeat(40)
        }
      ],
      18
    )
    expect(s.overall_feedback.length).toBeGreaterThan(10)
    expect(s.weaknesses.length).toBeGreaterThan(0)
    expect(s.recommended_practice.length).toBeGreaterThan(0)
  })
})
