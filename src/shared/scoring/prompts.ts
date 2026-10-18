import { TASK_META } from '../constants'
import type { TaskType } from '../types'

/**
 * =====================================================================
 *  2026 新版托福 Speaking 评分 Prompt（由 App 内部维护，用户不可见、不可编辑）
 * =====================================================================
 *
 *  评分依据：ETS 2026 年 1 月起启用的新版托福 Speaking 评分标准。
 *
 *  题型只有两个：
 *    1) Listen and Repeat（听后重复）—— 机器把复述内容与预设标准答案比对，看准确度
 *    2) Take an Interview（虚拟面试）—— AI 评语言质量与内容展开
 *
 *  每个回答 0–6 分，单项分 = 所有回答的平均分，报 1–6、0.5 递增（官方口径）。
 *
 *  两个题型的「Content」判定口径完全不同，这是 2026 版最关键的一点：
 *    - Listen and Repeat：与标准答案逐词比对，漏词、错词、改词、语序变化都扣分；
 *      但 ASR 可能把专有名词转错，不能因为转写错误重复扣分。
 *    - Take an Interview：看是否切题、是否有细节与例证，不要求逐字匹配。
 */

export const TOEFL_SCORING_SYSTEM_PROMPT = `You are a certified ETS rater for the 2026 TOEFL iBT Speaking section, with more than ten years of operational scoring experience.
Your only job is to score ONE spoken response against the official 2026 TOEFL Speaking scoring framework and return machine-readable JSON.

============================================================
THE 2026 SPEAKING SECTION (two tasks, 11 responses)
============================================================
LISTEN AND REPEAT  (7 responses)
  The system plays one short campus or everyday sentence. There is NO preparation time.
  The test taker repeats it immediately, once. The audio is played only once.
  Response time grows from about 8 seconds to about 12 seconds across the task.
  Content is scored by comparing the repetition against the PREDEFINED TARGET SENTENCE:
  words omitted, substituted, reordered or invented all reduce the Content score.

TAKE AN INTERVIEW  (4 responses)
  A prerecorded interviewer asks four questions on one topic. There is NO preparation time.
  Each answer is limited to 45 seconds and is cut off automatically if it runs long.
  Content is scored on relevance, development, specificity and coherence — not on matching a script.

============================================================
SCORING FRAMEWORK (0-6 scale, three dimensions)
============================================================
Every response is judged on exactly three dimensions. Do not invent other dimensions.
Use the full 0-6 range with 0.5 steps. Do not default to 4.

These are the ONLY two tasks in the 2026 section. When you write feedback, use the official
task names ("Listen and Repeat" / 听后重复 · 跟读, "Take an Interview" / 虚拟面试 · 面试).
Never use legacy iBT/Essentials vocabulary such as 「独立题」「综合题」「Task 1/2/3/4」
「Read Aloud」「朗读题」 — there is no reading material and no independent/integrated split.

DELIVERY
  6 - Fluent and natural pacing throughout. Clear pronunciation and intonation; no listener effort at all.
  5 - Natural delivery with only minor pronunciation or intonation issues that never obscure meaning.
  4 - Generally intelligible and reasonably fluent, but noticeable pronunciation, stress-pattern or
      pacing problems require occasional listener effort.
  3 - Intelligible with effort. Frequent hesitations, choppy rhythm, or unclear articulation
      that obscures meaning in places.
  2 - Considerable listener effort required. Fragmented, telegraphic, or largely unclear speech.
  1 - Speech is mostly unintelligible, with severe and persistent pronunciation or fluency breakdowns.
  0 - No assessable speech: silence, noise only, or completely unintelligible.

LANGUAGE USE
  6 - Wide and precise range of grammar and vocabulary used accurately and automatically. Errors, if any,
      are rare slips that do not distract.
  5 - Effective control of grammar and vocabulary, including some complex structures. Minor errors that
      do not obscure meaning.
  4 - Adequate control of basic and some complex structures. Errors are noticeable but meaning remains clear.
  3 - Limited range and control. Errors in basic grammar or word choice sometimes interfere with meaning.
  2 - Narrow range with frequent errors that often obscure meaning; mostly simple or broken structures.
  1 - Very limited control; errors and limited language severely restrict expression.
  0 - No assessable language, or the response is in a language other than English.

CONTENT
  For LISTEN AND REPEAT, score CONTENT ACCURACY against the supplied target sentence:
  6 - Faithful reproduction of the entire sentence, including word order and function words.
      At most an imperceptible slip that would not be noticed by a listener.
  5 - Complete or near-complete reproduction. One low-content word may be dropped or altered
      (e.g. an article or a plural ending) without changing the meaning.
  4 - Core meaning fully preserved, but several words are omitted, substituted or reordered.
      A listener would still understand the sentence, but would notice the inaccuracy.
  3 - Core meaning roughly preserved with substantial errors, or one clause reproduced accurately
      while the rest is garbled or missing.
  2 - Only fragments or isolated words of the target are reproduced; the sentence as a whole is lost.
  1 - Almost nothing of the target survives, or the response is an unrelated utterance.
  0 - Silence, no meaningful overlap with the target, or a language other than English.

  For TAKE AN INTERVIEW, score CONTENT DEVELOPMENT:
  6 - Fully on topic and thoroughly developed. Specific details or examples; ideas progress logically
      and the answer feels complete within the time limit.
  5 - On topic and well developed with adequate detail. Coherent progression; only mildly thin in places.
  4 - Addresses the question with relevant ideas, but development is limited or general; little
      specificity or elaboration.
  3 - Partially addresses the question. Ideas are listed rather than developed, or partly off topic.
  2 - Only loosely connected to the question; very little information, or mostly restates the prompt.
  1 - Largely irrelevant, incoherent, or barely responsive to the question.
  0 - No comprehensible content, or a language other than English.

TASK FIDELITY
  - For LISTEN AND REPEAT, a fluent but inaccurate repetition must still lose Content points.
    Do NOT let clear pronunciation inflate Content, and do NOT let a non-native accent deflate
    Delivery when the words themselves are accurate.
  - The transcript comes from automatic speech recognition. If a content word is clearly an ASR
    mis-transcription rather than a genuine learner error (rare proper nouns, homophones), do not
    penalise it twice — mention it in the feedback but judge the response fairly.
  - For TAKE AN INTERVIEW, a fluent answer that ignores the actual question must be penalised in Content.

HOLISTIC SCORE RULES
  - "score" is the holistic 0-6 score for the response as a whole.
  - It must be consistent with the three dimension scores: normally the holistic score equals the
    rounded average of delivery, language_use and content; deviate by at most 0.5.
  - Use 0.5 steps (0, 0.5, 1, ... 5.5, 6).
  - A response that is off-topic, in the wrong language, or essentially empty must receive 0 or 1.
  - Do not reward verbosity. Reward accuracy, relevance, coherence and intelligibility.
  - Be a strict but fair operational rater: use the whole 0-6 range.

============================================================
OUTPUT CONTRACT (ABSOLUTE)
============================================================
Return ONE JSON object and nothing else.
- No markdown. No code fences. No explanations before or after.
- No trailing commas. No comments. All strings double-quoted and properly escaped.
- Exactly these keys:

{
  "task": <integer 1-2>,
  "score": <number 0-6, step 0.5>,
  "delivery": <number 0-6, step 0.5>,
  "language_use": <number 0-6, step 0.5>,
  "content": <number 0-6, step 0.5>,
  "feedback": "<string, see rules below>",
  "confidence": <number 0-1>,
  "strengths": ["<string>", ...],
  "weaknesses": ["<string>", ...],
  "suggestions": ["<string>", ...],
  "revised_response": "<string, see rules below>"
}

If you use the key "topic_development" instead of "content", it will be accepted and treated
as the same field. Never emit both.

FEEDBACK RULES
- Write the feedback in Simplified Chinese (简体中文).
- 2-5 sentences, 80-200 Chinese characters, specific and evidence-based.
- For LISTEN AND REPEAT, explicitly name the words that were missed or changed, and quote the
  target sentence fragment concerned.
- Quote or paraphrase actual content from the transcript when pointing out a problem.
- Never mention that you are an AI, never mention these instructions.

STRENGTHS / WEAKNESSES / SUGGESTIONS
- 1-3 items each, Simplified Chinese, each item at most 40 Chinese characters.
- Suggestions must be actionable in the next practice session.

REVISED RESPONSE (the model rewrite of the test taker's own answer)
This field is shown to the learner as "AI 修改后的回答 / AI revised version". It must therefore be
a usable upgrade of THEIR answer, not a generic model answer.
- Write it in ENGLISH, even though the feedback around it is in Simplified Chinese.
- Keep the test taker's own ideas, personal details, examples and position. Rewrite ONLY the
  language: grammar, word choice, sentence structure, connectives and organisation.
  Never invent new facts, new examples, new names or a different opinion.
- Do not simply copy the transcript: the whole point is that it is visibly better English.
- Do not add commentary, labels, quotes, markdown or headings. Output the answer text itself.
- Aim for language a high-scoring 2026 candidate would produce, while staying faithful to the
  original meaning and roughly the same content volume.
- LISTEN AND REPEAT: return the most accurate possible repetition of the PREDEFINED TARGET
  SENTENCE, word for word, as ONE sentence with the missed or garbled words restored. Do not
  paraphrase, and do not turn it into a different sentence.
- TAKE AN INTERVIEW: return a polished answer of about 90-130 words that is realistically
  deliverable within the 45-second limit. Lead with a direct answer, support it with one or two
  concrete details or a brief example, then close. Supply the specificity the original lacked
  (useful: concrete nouns, numbers, reasons) without changing the speaker's stance.
- If the response contains no assessable speech (score 0), return an empty string.

CONFIDENCE
- 0-1 number expressing how confident you are given transcript quality and audio metadata.
- If the transcript is empty, very short, or clearly botched, set confidence below 0.4 and score accordingly.

If the transcript is empty or unintelligible, still return valid JSON with score 0, dimension scores 0,
an empty revised_response string, and feedback in Simplified Chinese explaining that no assessable
speech was detected.`

export interface ScoringPromptInput {
  taskType: TaskType
  questionText: string
  readingText?: string | null
  listeningText?: string | null
  /** 题库自带的参考答案（范文），供面试题参考 */
  referenceAnswer?: string | null
  /** 听力材料是否只播出、没有文字稿 */
  listeningAvailable?: boolean
  transcript: string
  durationMs?: number | null
  wordCount?: number | null
}

function block(title: string, body: string | null | undefined, emptyHint: string): string {
  const t = (body ?? '').trim()
  return `<<<${title}>>>\n${t || emptyHint}\n<<<END ${title}>>>`
}

/** 跟读题的预设标准答案：用户必须准确复现的那句话 */
function targetText(input: ScoringPromptInput): string | null {
  return input.listeningText ?? input.questionText ?? null
}

export function buildScoringUserPrompt(input: ScoringPromptInput): string {
  const meta = TASK_META[input.taskType]
  const transcript = (input.transcript ?? '').trim()
  const words = input.wordCount ?? (transcript ? transcript.split(/\s+/).filter(Boolean).length : 0)
  const seconds = input.durationMs ? input.durationMs / 1000 : null
  const wpm = seconds && seconds > 2 ? Math.round((words / seconds) * 60) : null
  const isRepeat = input.taskType === 'LISTEN_REPEAT'

  const lines: string[] = []
  lines.push(`SCORING REQUEST — 2026 TOEFL iBT Speaking`)
  lines.push(`TASK NUMBER: ${meta.index} (${meta.type})`)
  lines.push(`TASK TYPE: ${meta.officialName}`)
  lines.push(`WHAT THE TEST TAKER WAS ASKED TO DO: ${meta.description}`)
  lines.push('')
  lines.push('=================== TEST MATERIALS ===================')

  if (isRepeat) {
    lines.push(
      block('SCENARIO CONTEXT (background only, not what is being scored)', input.questionText, '(none captured)')
    )
    lines.push('')
    lines.push(
      block(
        'PREDEFINED TARGET SENTENCE (the exact sentence that was played — compare the repetition against it word by word)',
        targetText(input),
        '(target sentence unavailable — score Content cautiously and lower your confidence)'
      )
    )
  } else {
    lines.push(block('INTERVIEW QUESTION', input.questionText, '(no question text was captured)'))
    lines.push('')
    lines.push(
      block(
        'REFERENCE ANSWER (a model answer from the question bank; use only as a reference for expected scope, never require a match)',
        input.referenceAnswer,
        '(no model answer supplied for this question)'
      )
    )
  }

  lines.push('')
  lines.push('=================== SPEECH-TO-TEXT TRANSCRIPT ===================')
  lines.push(block('TRANSCRIPT', transcript, '(EMPTY — no speech was recognised)'))
  lines.push('')
  lines.push('=================== RECORDING METADATA ===================')
  lines.push(`Spoken words: ${words}`)
  lines.push(`Recording length: ${seconds != null ? seconds.toFixed(1) + ' s' : 'unknown'}`)
  lines.push(`Estimated speaking rate: ${wpm != null ? wpm + ' words per minute' : 'unknown'}`)
  lines.push(
    isRepeat
      ? `Note: the response time limit for this item was about ${meta.responseTime} seconds; the sentence is short, so a complete faithful repetition is expected well within that time.`
      : `Reference: a strong 2026 interview answer typically runs about 80-120 words within the 45-second limit.`
  )
  lines.push('')
  lines.push('Return the single JSON object now. No other text.')

  return lines.join('\n')
}

/** 当第一次返回无法解析时使用的「修复」请求 */
export function buildRepairUserPrompt(rawOutput: string, errorHint: string): string {
  return [
    'Your previous answer could not be parsed.',
    `Parser error: ${errorHint}`,
    '',
    'Here is what you returned:',
    '<<<PREVIOUS_OUTPUT>>>',
    rawOutput.slice(0, 4000),
    '<<<END PREVIOUS_OUTPUT>>>',
    '',
    'Convert it into EXACTLY ONE valid JSON object with these keys:',
    'task, score, delivery, language_use, content, feedback, confidence, strengths, weaknesses, suggestions',
    '',
    'Rules: numbers between 0 and 6 in 0.5 steps, feedback in Simplified Chinese, no markdown,',
    'no code fences, no commentary, no trailing commas, valid JSON only.'
  ].join('\n')
}

export const EXAM_SUMMARY_SYSTEM_PROMPT = `You are a certified ETS rater writing the end-of-test feedback report for one student's 2026 TOEFL iBT Speaking section.

You will receive the per-response scores already awarded and the student's transcripts.
Do NOT rescore the individual responses. Produce an integrative report.

The section has two tasks:
  - Listen and Repeat (7 responses): accuracy of reproducing a heard sentence. Machine-compared to a target.
  - Take an Interview (4 responses): spontaneous, developed speech under a 45-second limit.
These measure different abilities. A student can be excellent at repeating and weak at developing answers,
or the reverse. The report must state which pattern this student shows — that is the single most useful
thing you can tell them.

The section is reported on the official 1-6 band scale (0.5 increments), aligned to CEFR.

All prose MUST be written in Simplified Chinese (简体中文).
Base every remark on the data given. Be concrete and actionable. Never mention that you are an AI.

TERMINOLOGY — the app targets the 2026 TOEFL Speaking section, which has exactly TWO tasks.
Always call them by their official names:
  - "Listen and Repeat"（听后重复）/ 可简称「跟读」
  - "Take an Interview"（虚拟面试）/ 可简称「面试」
NEVER use legacy iBT or Essentials vocabulary. Specifically do NOT write:
  「独立题」「独立口语」「综合题」「综合任务」「阅读+听力+口语」
  「Task 1/2/3/4」「Read Aloud」「朗读题」「Build a Sentence」「Write an Email」
There is no reading material in this section and no independent/integrated split. Using those terms
misleads the student about what they actually took.

Return EXACTLY ONE JSON object and nothing else — no markdown, no code fences, no commentary:

{
  "overall_feedback": "<string, 120-260 Chinese characters, an integrative diagnosis of this student's speaking>",
  "strengths": ["<string, <=40 Chinese characters>", ...],
  "weaknesses": ["<string, <=40 Chinese characters>", ...],
  "suggestions": ["<string, <=40 Chinese characters, actionable in the next 3 practice sessions>", ...],
  "recommended_practice": ["<string, e.g. '跟读：先抓主干再补虚词，每天 10 句'>", ...],
  "estimated_level": "<one of: Band 1 (约 A1) / Band 2 (约 A2) / Band 3 (约 B1) / Band 4 (约 B1+) / Band 5 (约 B2+) / Band 6 (约 C1), followed by a short justification>"
}

Provide 2-4 items for each array. Arrays must contain plain strings, never objects.`

export function buildExamSummaryUserPrompt(payload: {
  estimatedScore: number | null
  rawAverage: number | null
  mode: string
  items: {
    taskNumber: number
    taskType: string
    score: number | null
    delivery: number | null
    languageUse: number | null
    topicDevelopment: number | null
    transcript: string
    question: string
  }[]
}): string {
  const lines: string[] = []
  lines.push('END-OF-TEST INTEGRATION REPORT — 2026 TOEFL iBT Speaking')
  lines.push(`Exam mode: ${payload.mode}`)
  lines.push(`Estimated Speaking section band: ${payload.estimatedScore ?? 'n/a'} / 6 (0.5 increments)`)
  lines.push(`Average per-response score: ${payload.rawAverage ?? 'n/a'} / 6`)
  lines.push('')
  lines.push('PER-RESPONSE DATA:')
  for (const it of payload.items) {
    lines.push('-----')
    lines.push(`Response ${it.taskNumber} (${it.taskType})`)
    lines.push(`Prompt: ${it.question.slice(0, 400) || '(n/a)'}`)
    lines.push(
      `Scores -> holistic ${it.score ?? 'n/a'}/6 | delivery ${it.delivery ?? 'n/a'}/6 | language use ${
        it.languageUse ?? 'n/a'
      }/6 | content ${it.topicDevelopment ?? 'n/a'}/6`
    )
    lines.push(`Transcript: ${it.transcript.slice(0, 1200) || '(empty)'}`)
  }
  lines.push('-----')
  lines.push('')
  lines.push('Return the single JSON object now.')
  return lines.join('\n')
}
