import { describe, expect, it } from 'vitest'
import { chatCompletion, listModels, testConnection } from '@main/services/llm/openaiCompatible'
import { scoreExamSummary, scoreQuestion, validateQuestionScore } from '@main/services/scoring/engine'
import { TOEFL_SCORING_SYSTEM_PROMPT } from '@shared/scoring/prompts'

/**
 * 真实云端联调测试（默认跳过，不会在 npm test 时消耗额度）。
 *
 * 运行方式：
 *   TOEFL_LIVE_LLM=1 \
 *   TOEFL_LLM_BASE_URL=https://api.modelverse.cn/v1 \
 *   TOEFL_LLM_API_KEY=<你的 Key> \
 *   TOEFL_LLM_MODEL=deepseek-v4.1-flash \
 *   npx vitest run tests/live-llm.test.ts
 *
 * Key 只从环境变量读取，绝不写进仓库。
 */

const LIVE = process.env.TOEFL_LIVE_LLM === '1'
const CFG = {
  baseUrl: process.env.TOEFL_LLM_BASE_URL ?? 'https://api.modelverse.cn/v1',
  apiKey: process.env.TOEFL_LLM_API_KEY ?? '',
  model: process.env.TOEFL_LLM_MODEL ?? 'deepseek-v4.1-flash'
}

const d = LIVE ? describe : describe.skip

/** 一段真实的 Task 2 回答（含轻微的语法与流利度问题，便于观察评分区分度） */
const REAL_ANSWER = `The woman in the conversation thinks that extending the library hours
is a good idea. Um, she gives two main reasons. First, she says that during finals
last semester she could not find any seat in the library, and she had to study in
the hallway, which was really noisy and uncomfortable. So she thinks more students
will be able to study in a proper environment if the library stays open until two
in the morning. Second, she mentions that she, uh, she lives off campus, and the
bus only runs until eleven, so she usually goes home early. But if the library
stays open later, she can stay on campus and use the resources like the quiet
study rooms and the printing service. That is why she supports the announcement.`

d('真实云端评分联调', () => {
  it('1. 能拉取模型列表', async () => {
    const res = await listModels({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey })
    expect(res.ok).toBe(true)
    expect(res.models.length).toBeGreaterThan(10)
  }, 60000)

  it('2. 连接测试通过', async () => {
    const res = await testConnection({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey, model: CFG.model })
    expect(res.ok).toBe(true)
  }, 60000)

  it('3. 真实模型按 ETS 量表给出结构化评分（json_schema 模式）', async () => {
    const res = await scoreQuestion(
      {
        taskType: 'INTERVIEW',
        questionText:
          'The woman expresses her opinion about the announcement. State her opinion and explain the reasons she gives for holding that opinion.',
        readingText:
          'The university announced that the main library will remain open until 2 a.m. during the final examination period.',
        listeningText: 'Narrator: Now listen to two students discussing the announcement.',
        transcript: REAL_ANSWER.replace(/\s+/g, ' ').trim(),
        durationMs: 58000,
        wordCount: REAL_ANSWER.split(/\s+/).length
      },
      { ...CFG, temperature: 0.1, useJsonSchema: true }
    )

    if (!res.ok) console.error('评分失败：', res.error, res.raw)

    expect(res.ok).toBe(true)
    const s = res.score!
    expect(s.task).toBe(2)
    expect(s.score).toBeGreaterThanOrEqual(0)
    expect(s.score).toBeLessThanOrEqual(4)
    expect(s.feedback.length).toBeGreaterThan(20)
    // 反馈必须是中文（Prompt 强制要求）
    expect(/[\u4e00-\u9fa5]/.test(s.feedback)).toBe(true)
    expect(s.confidence).toBeGreaterThan(0)
    expect(s.confidence).toBeLessThanOrEqual(1)

    console.log('\n=== 真实评分结果 ===')
    console.log(JSON.stringify(s, null, 2))
    console.log('====================\n')
  }, 300000)

  it('4. 纯 Prompt 模式（不支持 response_format 的厂商）同样可用', async () => {
    const res = await scoreQuestion(
      {
        taskType: 'LISTEN_REPEAT',
        questionText: 'Some students prefer to study alone. Others prefer to study in a group. Which do you prefer and why?',
        transcript:
          'I prefer to study alone. Um, because I can focus better when there is no one talking around me. For example, last semester I tried to study with my roommates and we ended up chatting for two hours. But when I study alone in my room, I can finish a whole chapter in one hour.',
        durationMs: 44000,
        wordCount: 60
      },
      { ...CFG, temperature: 0.1, useJsonSchema: false }
    )
    expect(res.ok).toBe(true)
    console.log('\n=== Task 1 评分 ===', JSON.stringify(res.score, null, 2), '\n')
  }, 300000)

  it('5. 整场总结可用且字段完整', async () => {
    const res = await scoreExamSummary(
      {
        estimatedScore: 23,
        rawAverage: 11,
        mode: 'FULL',
        items: [
          {
            taskNumber: 1,
            taskType: 'LISTEN_REPEAT',
            score: 3,
            delivery: 3,
            languageUse: 2.5,
            topicDevelopment: 3.5,
            transcript: 'I prefer to study alone because I can focus better.',
            question: 'Which do you prefer and why?'
          },
          {
            taskNumber: 2,
            taskType: 'INTERVIEW',
            score: 2.5,
            delivery: 2.5,
            languageUse: 2,
            topicDevelopment: 3,
            transcript: REAL_ANSWER.replace(/\s+/g, ' ').trim(),
            question: 'State her opinion and explain her reasons.'
          }
        ]
      },
      { ...CFG, temperature: 0.1, useJsonSchema: true }
    )
    if (!res.ok) console.error('总结失败：', res.error)
    expect(res.ok).toBe(true)
    const s = res.summary!
    console.log('\n=== RAW SUMMARY ===', JSON.stringify(s, null, 2), '\n')
    expect(s.overall_feedback.length).toBeGreaterThan(40)
    expect(s.strengths.length).toBeGreaterThan(0)
    expect(s.suggestions.length).toBeGreaterThan(0)
    expect(s.recommended_practice.length).toBeGreaterThan(0)
    expect(/[\u4e00-\u9fa5]/.test(s.overall_feedback)).toBe(true)
    console.log('\n=== 整场总结 ===', JSON.stringify(s, null, 2), '\n')
  }, 300000)

  it('6. 评分 Prompt 确实要求模型输出官方三维度（自检）', () => {
    for (const k of ['delivery', 'language_use', 'topic_development', 'confidence']) {
      expect(TOEFL_SCORING_SYSTEM_PROMPT).toContain(k)
    }
  })

  it('7. 校验器接受真实返回、拒绝残缺返回', () => {
    expect(validateQuestionScore({ task: 1, score: 3, delivery: 3, language_use: 3, topic_development: 3, feedback: '好', confidence: 0.5 }).ok).toBe(true)
    expect(validateQuestionScore({ score: 3 }).ok).toBe(false)
  })
})
