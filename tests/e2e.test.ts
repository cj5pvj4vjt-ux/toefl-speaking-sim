import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PDFDocument from 'pdfkit'
import { parseQuestionsFromPages, pickExamQuestions } from '@shared/pdf/parseQuestions'
import { buildTaskScoreEntries, computeOverall } from '@shared/scoring/convert'
import type { ExamAttempt, QuestionAttempt, QuestionScore, TaskType } from '@shared/types'
import { chatCompletion, listModels, normalizeBaseUrl, testConnection } from '@main/services/llm/openaiCompatible'
import { scoreExamSummary, scoreQuestion } from '@main/services/scoring/engine'
import { generateExamReport } from '@main/services/reports/pdfReport'
import { saveRecording } from '@main/services/audioStorage'
import { setDataRoot } from '@main/services/paths'
import { SAMPLE_SCRIPT, makeWavBuffer, tempDir } from './helpers'

/**
 * 端到端集成测试：
 *   真实 PDF → pdfjs 抽取文字 → 结构化题库 → 组卷 → 模拟录音落盘
 *   → 本地 Mock OpenAI 服务 → 结构化评分 → 汇总 → PDF 报告
 *
 * 全程不访问外网、不需要 API Key。
 */

let dir: string
let cleanup: () => void

beforeAll(() => {
  const t = tempDir('toefl-e2e-')
  dir = t.dir
  cleanup = t.cleanup
  setDataRoot(dir)
})

afterAll(() => {
  cleanup()
})

/* ------------------------------------------------------------------ */
/*                      1. 生成一份真实 PDF                            */
/* ------------------------------------------------------------------ */

async function buildToeflPdf(outPath: string): Promise<string> {
  const font = fs.existsSync('/System/Library/Fonts/Supplemental/Arial Unicode.ttf')
    ? '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
    : undefined
  const doc = new PDFDocument({ size: 'A4', margin: 50 })
  const stream = fs.createWriteStream(outPath)
  doc.pipe(stream)
  if (font) doc.font(font)
  doc.fontSize(11)
  for (const line of SAMPLE_SCRIPT.split('\n')) {
    doc.text(line || ' ', { lineGap: 2 })
  }
  doc.end()
  await new Promise<void>((resolve) => stream.on('finish', () => resolve()))
  return outPath
}

/** 用 pdfjs-dist 抽取文字（与渲染进程完全相同的库） */
async function extractPdfText(file: string): Promise<{ page: number; text: string }[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(fs.readFileSync(file))
  const task = pdfjs.getDocument({ data, useSystemFonts: false })
  const pdf = await task.promise
  const pages: { page: number; text: string }[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items
      .map((it) => {
        const item = it as { str?: string; hasEOL?: boolean }
        return (item.str ?? '') + (item.hasEOL ? '\n' : '')
      })
      .join('')
    pages.push({ page: i, text })
  }
  await (task as unknown as { destroy?: () => Promise<void> }).destroy?.()
  return pages
}

/* ------------------------------------------------------------------ */
/*                  2. 本地 Mock OpenAI 兼容服务                        */
/* ------------------------------------------------------------------ */

interface MockServer {
  url: string
  calls: { path: string; body: any }[]
  close: () => Promise<void>
}

async function startMockLlm(): Promise<MockServer> {
  const calls: { path: string; body: any }[] = []
  let failureMode: 'none' | 'invalid-json' | 'unauthorized' | 'no-json-mode' = 'none'

  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {}
      calls.push({ path: req.url ?? '', body })

      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            data: [
              { id: 'gpt-4o', object: 'model' },
              { id: 'text-embedding-3-small', object: 'model' },
              { id: 'whisper-1', object: 'model' }
            ]
          })
        )
        return
      }

      if (failureMode === 'unauthorized') {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'Invalid API key provided.' } }))
        return
      }

      if (failureMode === 'no-json-mode' && body.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'response_format is not supported' } }))
        return
      }

      const system: string = body.messages?.[0]?.content ?? ''
      // 两道 Prompt 通过要求的输出字段区分：总结要求 overall_feedback
      const isSummary = system.includes('overall_feedback')

      let content: string
      if (failureMode === 'invalid-json') {
        content = 'I am sorry, but I cannot produce JSON right now.'
      } else if (isSummary) {
        content = JSON.stringify({
          overall_feedback: '整体表现稳定，综合任务的信息整合能力较强，独立任务展开略显单薄。',
          strengths: ['语速自然', '发音清晰'],
          weaknesses: ['细节复述不完整'],
          suggestions: ['加强笔记训练'],
          recommended_practice: ['Task 3 学术概念复述'],
          estimated_level: '良好 (20-25)'
        })
      } else {
        // 故意返回带 markdown 包裹 + 全角标点的"脏" JSON，检验宽松抽取
        content =
          '```json\n{\n  "task": 1,\n  "score": 3.5,\n  "delivery": 3.5,\n  "language_use": 3,\n  "topic_development": 3.5,\n  "feedback": "表达流利，观点明确，但例证略显笼统，可以补充具体细节。",\n  "confidence": 0.82,\n  "strengths": ["语速自然"],\n  "weaknesses": ["细节不足"],\n  "suggestions": ["补充具体例子"],\n  "revised_response": "I study alone because I can set my own pace and avoid distractions.",\n}\n```'
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: body.model ?? 'gpt-4o',
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100 }
        })
      )
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    // 暴露给测试用例内部控制
    setFailureMode: (m: typeof failureMode) => {
      failureMode = m
    }
  } as MockServer & { setFailureMode: (m: 'none' | 'invalid-json' | 'unauthorized' | 'no-json-mode') => void }
}

/* ================================================================== */

describe('端到端：PDF → 题库 → 组卷 → 评分 → 报告', () => {
  let pdfPath: string
  let questions: ReturnType<typeof pickExamQuestions>
  let server: Awaited<ReturnType<typeof startMockLlm>>

  beforeAll(async () => {
    pdfPath = await buildToeflPdf(path.join(dir, 'tpo-sample.pdf'))
    server = await startMockLlm()
  })

  afterAll(async () => {
    await server.close()
  })

  it('步骤 1：生成了一份真实的、可被 pdfjs 解析的 PDF', async () => {
    expect(fs.existsSync(pdfPath)).toBe(true)
    expect(fs.statSync(pdfPath).size).toBeGreaterThan(5000)
    const pages = await extractPdfText(pdfPath)
    expect(pages.length).toBeGreaterThanOrEqual(1)
    const all = pages.map((p) => p.text).join('\n')
    expect(all).toMatch(/Listen and Repeat|1-7\./)
    expect(all).toMatch(/8-11/)
  })

  it('步骤 2：从 PDF 文字中解析出结构化的 TOEFL 题目', async () => {
    const pages = await extractPdfText(pdfPath)
    const result = parseQuestionsFromPages(pages)
    // 两套题 × (7 跟读 + 4 面试) = 22
    expect(result.questions.length).toBeGreaterThanOrEqual(11)
    const tasks = new Set(result.questions.map((q) => q.taskType))
    expect([...tasks].sort()).toEqual(['INTERVIEW', 'LISTEN_REPEAT'])
    questions = result.questions
  })

  it('步骤 3：组出一整套 2026 新托福口语试卷（7 跟读 + 4 面试 = 11 题）', () => {
    const picked = pickExamQuestions(questions, 'FULL')
    expect(picked).toHaveLength(11)
    expect(picked.filter((q) => q.taskType === 'LISTEN_REPEAT')).toHaveLength(7)
    expect(picked.filter((q) => q.taskType === 'INTERVIEW')).toHaveLength(4)
    // 必须来自同一套题，不能跨套串题
    const groups = new Set(picked.map((q) => q.tags.find((t) => t.startsWith('group:'))))
    expect(groups.size).toBe(1)
  })

  it('步骤 4：录音按题落盘，路径与大小正确', () => {
    const wav = makeWavBuffer(1)
    const paths: string[] = []
    const types: TaskType[] = [
      ...Array<TaskType>(7).fill('LISTEN_REPEAT'),
      ...Array<TaskType>(4).fill('INTERVIEW')
    ]
    const seen: Record<string, number> = {}
    types.forEach((t, i) => {
      const occurrence = seen[t] ?? 0
      seen[t] = occurrence + 1
      const res = saveRecording({
        examId: 'e2e-exam',
        order: i,
        taskType: t,
        data: new Uint8Array(wav),
        mimeType: 'audio/webm;codecs=opus',
        durationMs: 45000,
        occurrence
      })
      expect(res.ok).toBe(true)
      paths.push(res.audioPath!)
    })
    expect(new Set(paths).size).toBe(11)
    for (const p of paths) {
      expect(fs.existsSync(p)).toBe(true)
      expect(fs.statSync(p).size).toBe(wav.byteLength)
    }
  })

  it('步骤 5：模型列表能够从兼容接口拉取', async () => {
    const res = await listModels({ baseUrl: server.url, apiKey: 'sk-mock' })
    expect(res.ok).toBe(true)
    expect(res.models.map((m) => m.id)).toContain('gpt-4o')
  })

  it('步骤 6：连接测试返回可读结果与耗时', async () => {
    const res = await testConnection({ baseUrl: server.url, apiKey: 'sk-mock', model: 'gpt-4o' })
    expect(res.ok).toBe(true)
    expect(typeof res.latencyMs).toBe('number')
  })

  it('步骤 7：调用云端模型完成结构化评分（自动修复脏 JSON）', async () => {
    const q = questions[0]
    const res = await scoreQuestion(
      {
        taskType: q.taskType,
        questionText: q.questionText,
        readingText: q.readingText,
        listeningText: q.listeningText,
        transcript: 'I prefer to study alone because I can concentrate better without interruptions.',
        durationMs: 43000,
        wordCount: 14
      },
      { baseUrl: server.url, apiKey: 'sk-mock', model: 'gpt-4o', temperature: 0.1, useJsonSchema: false }
    )
    expect(res.ok).toBe(true)
    expect(res.score!.task).toBe(1)
    expect(res.score!.score).toBe(3.5)
    expect(res.score!.delivery).toBe(3.5)
    expect(res.score!.language_use).toBe(3)
    expect(res.score!.topic_development).toBe(3.5)
    expect(res.score!.confidence).toBeCloseTo(0.82, 2)
    expect(res.score!.feedback).toContain('表达流利')
    expect(res.score!.strengths).toEqual(['语速自然'])
  })

  it('步骤 8：四道题全部评分 → 汇总 → 生成 PDF 报告', async () => {
    const cfg = { baseUrl: server.url, apiKey: 'sk-mock', model: 'gpt-4o', temperature: 0.1, useJsonSchema: false }

    const attemptItems: QuestionAttempt[] = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const scored = await scoreQuestion(
        {
          taskType: q.taskType,
          questionText: q.questionText,
          readingText: q.readingText,
          listeningText: q.listeningText,
          transcript: `Spoken response number ${i + 1} for ${q.taskType}.`,
          durationMs: 45000,
          wordCount: 8
        },
        cfg
      )
      expect(scored.ok).toBe(true)
      attemptItems.push({
        questionId: q.id,
        taskType: q.taskType,
        order: i,
        audioPath: path.join(dir, 'recordings', 'e2e-exam', `task${i + 1}.webm`),
        audioMimeType: 'audio/webm',
        durationMs: 45000,
        transcript: `Spoken response number ${i + 1} for ${q.taskType}.`,
        score: scored.score as QuestionScore,
        sttError: null,
        scoreError: null,
        questionSnapshot: q
      })
    }

    const taskScores = buildTaskScoreEntries(attemptItems.map((a) => ({ taskType: a.taskType, score: a.score })))
    const overall = computeOverall(taskScores, 'FULL')

    const summaryRes = await scoreExamSummary(
      {
        estimatedScore: overall.overall,
        rawAverage: overall.rawAverage,
        mode: 'FULL',
        items: attemptItems.map((a) => ({
          taskNumber: a.order + 1,
          taskType: a.taskType,
          score: a.score?.score ?? null,
          delivery: a.score?.delivery ?? null,
          languageUse: a.score?.language_use ?? null,
          topicDevelopment: a.score?.topic_development ?? null,
          transcript: a.transcript ?? '',
          question: a.questionSnapshot.questionText
        }))
      },
      cfg
    )
    expect(summaryRes.ok).toBe(true)

    const attempt: ExamAttempt = {
      id: 'e2e-exam',
      date: Date.now(),
      questionSetId: 'set-e2e',
      questionSetTitle: 'TPO Sample',
      title: '完整模拟考试 · TPO Sample',
      mode: 'FULL',
      overallScore: overall.overall,
      rawTotal: overall.rawAverage,
      taskScores,
      summary: summaryRes.summary!,
      durationMs: 11 * 45000,
      attempts: attemptItems,
      status: 'COMPLETED',
      pendingErrors: []
    }

    // 11 题 × 3.5 = 38.5，平均分 3.5 → Band 3.5
    expect(overall.rawAverage).toBe(3.5)
    expect(overall.overall).toBe(3.5)

    const reportPath = path.join(dir, 'reports', 'e2e-report.pdf')
    const written = await generateExamReport(attempt, { outPath: reportPath, studentName: 'E2E', appVersion: '1.0.0' })
    expect(written).toBe(reportPath)
    expect(fs.existsSync(reportPath)).toBe(true)
    expect(fs.statSync(reportPath).size).toBeGreaterThan(3000)
    expect(fs.readFileSync(reportPath).subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('步骤 9：服务端返回非法 JSON 时评分失败但给出可读原因', async () => {
    const srv = server as MockServer & {
      setFailureMode: (m: 'none' | 'invalid-json' | 'unauthorized' | 'no-json-mode') => void
    }
    srv.setFailureMode('invalid-json')
    const res = await scoreQuestion(
      { taskType: 'LISTEN_REPEAT', questionText: 'q', transcript: 'hello world', durationMs: 1000, wordCount: 2 },
      { baseUrl: server.url, apiKey: 'sk-mock', model: 'gpt-4o', useJsonSchema: false }
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/格式错误/)
    srv.setFailureMode('none')
  })

  it('步骤 10：API Key 错误时返回服务端原文错误', async () => {
    const srv = server as MockServer & {
      setFailureMode: (m: 'none' | 'invalid-json' | 'unauthorized' | 'no-json-mode') => void
    }
    srv.setFailureMode('unauthorized')
    const res = await scoreQuestion(
      { taskType: 'LISTEN_REPEAT', questionText: 'q', transcript: 'hello', durationMs: 1000, wordCount: 1 },
      { baseUrl: server.url, apiKey: 'bad-key', model: 'gpt-4o', useJsonSchema: false }
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/401|Invalid API key/i)
    srv.setFailureMode('none')
  })

  it('步骤 11：服务端不支持 response_format 时自动降级重试', async () => {
    const srv = server as MockServer & {
      setFailureMode: (m: 'none' | 'invalid-json' | 'unauthorized' | 'no-json-mode') => void
    }
    srv.setFailureMode('no-json-mode')
    const res = await chatCompletion({
      baseUrl: server.url,
      apiKey: 'sk-mock',
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      jsonMode: true
    })
    expect(res.ok).toBe(true)
    // 至少一次带 response_format 的尝试 + 一次成功降级
    const attempts = server.calls.filter((c) => c.path.includes('/chat/completions'))
    expect(attempts.length).toBeGreaterThanOrEqual(2)
    srv.setFailureMode('none')
  })

  it('步骤 12：baseUrl 规范化与拼接', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeBaseUrl('api.example.com/v1')).toBe('https://api.example.com/v1')
    expect(normalizeBaseUrl('')).toBe('')
  })
})
