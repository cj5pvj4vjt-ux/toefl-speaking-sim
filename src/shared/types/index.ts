/**
 * 全局共享类型定义（Main / Preload / Renderer 共同使用）
 */

/**
 * 2026 新版托福（TOEFL iBT 改革版）Speaking 只有两个题型：
 *   LISTEN_REPEAT  听后重复 —— 机器比对标准答案
 *   INTERVIEW      虚拟面试 —— AI 评分
 */
export type TaskType = 'LISTEN_REPEAT' | 'INTERVIEW'

export type ExamMode = 'FULL' | 'LISTEN_REPEAT' | 'INTERVIEW' | 'CUSTOM'

/** 只考某一个任务时的 ExamMode 取值 */
export const SINGLE_TASK_MODES: TaskType[] = ['LISTEN_REPEAT', 'INTERVIEW']

/** 单道题目 */
export interface Question {
  id: string
  taskType: TaskType
  /** 题干 / 题目要求 */
  questionText: string
  /** Task 2/3/4 的阅读材料（Task 1 为 null） */
  readingText: string | null
  /** 听力材料文字稿（PDF 中若存在） */
  listeningText: string | null
  /**
   * 题库 PDF 里自带的参考答案 / 范文。
   * 与 questionText 严格分开存放：参考答案绝不能混进题干，
   * 但在题库编辑页和报告里可以查看、对照。
   */
  /**
   * 屏幕上显示的「场景 / 指令」。
   *
   * 官方 2026 新托福口语：屏幕上只有场景，**没有任何题目文字**。
   * 所以场景必须与 questionText 分开存，绝不能拼进题干。
   */
  contextText: string | null
  /** 题库自带的参考答案（面试范文）；绝不能混进题干 */
  referenceAnswer: string | null
  /** 准备时间（秒） */
  preparationTime: number
  /** 回答时间（秒） */
  responseTime: number
  /** 来源 PDF 页码（从 1 开始） */
  sourcePage: number | null
  tags: string[]
  /** 自动解析时产生的问题，需要人工确认 */
  parseWarnings: string[]
  /** 是否需要人工修正 */
  needsReview: boolean
  /** PDF 中该题的原始文本，便于人工修正 */
  rawText: string
}

/** 题库（一次 PDF 导入产生一批） */
export interface QuestionSet {
  id: string
  title: string
  sourcePdf: string
  createdAt: number
  questions: Question[]
  /** 导入统计 */
  importStats?: ImportStats
}

export interface ImportStats {
  totalPages: number
  pagesWithText: number
  detected: number
  parsed: number
  needsReview: number
  warnings: string[]
  usedOcr: boolean
}

/* ------------------------------------------------------------------ */
/*                             评分结果                                */
/* ------------------------------------------------------------------ */

/** 大模型必须返回的固定结构（逐题） */
export interface QuestionScore {
  task: number
  score: number
  delivery: number
  language_use: number
  topic_development: number
  feedback: string
  confidence: number
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  /**
   * AI 改写后的回答（英文）。
   * 保留考生原本的观点与个人细节，只修正语法用词、句子结构与组织方式，
   * 用于报告中「AI 修改后的回答」一节。0 分（无可评估语音）时为空串。
   */
  revised_response: string
}

export interface ExamSummary {
  overall_feedback: string
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  recommended_practice: string[]
  estimated_level: string
}

/* ------------------------------------------------------------------ */
/*                             考试记录                                */
/* ------------------------------------------------------------------ */

export interface QuestionAttempt {
  questionId: string
  taskType: TaskType
  order: number
  /** 录音文件绝对路径 */
  audioPath: string | null
  audioMimeType: string | null
  durationMs: number
  transcript: string | null
  transcriptSegments?: { start: number; end: number; text: string }[]
  score: QuestionScore | null
  sttError: string | null
  scoreError: string | null
  /** 该题快照，避免题库被删除后无法复盘 */
  questionSnapshot: Question
}

export interface TaskScoreEntry {
  taskType: TaskType
  /** 该任务下所有回答的 0-6 平均分 */
  rawScore: number | null
  /** 2026 新版托福单项分档（1-6，0.5 递增） */
  band: number | null
  /** 该任务下已评分的回答数 */
  responseCount: number
  delivery: number | null
  languageUse: number | null
  topicDevelopment: number | null
}

export interface ExamAttempt {
  id: string
  date: number
  questionSetId: string
  questionSetTitle: string
  title: string
  mode: ExamMode
  /** 1-6 分档（Speaking 单项分） */
  overallScore: number | null
  /** 各小题平均原始分（0-6），用于换算分档 */
  rawTotal: number | null
  taskScores: TaskScoreEntry[]
  summary: ExamSummary | null
  durationMs: number
  attempts: QuestionAttempt[]
  status: 'COMPLETED' | 'PARTIAL' | 'DRAFT'
  /** 评分/转写过程中的错误信息（允许稍后重新评分） */
  pendingErrors: string[]
}

/* ------------------------------------------------------------------ */
/*                              设置                                   */
/* ------------------------------------------------------------------ */

export interface LlmSettings {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  /** 是否尝试使用 response_format json_schema */
  useJsonSchema: boolean
}

/**
 * 题目音频合成的音源。
 *
 * - `system`：macOS 自带 `say`，完全离线、零成本，但机械感强。
 * - `cloud`：云端 TTS（OpenAI 兼容 /audio/speech），自然得多，官方题音更接近真人。
 *   baseUrl / apiKey 留空时自动沿用「AI 模型」里配置的服务与密钥。
 */
export interface TtsSettings {
  provider: 'system' | 'cloud'
  baseUrl: string
  apiKey: string
  model: string
  voice: string
  /** cloud 不可用时的兜底：系统语音音色 */
  systemVoice: string
  /** 语速倍率（1 = 原速），影响 cloud 的 speed */
  speed: number
}

export interface SttSettings {
  provider: 'openai-compatible' | 'local-whisper' | 'none'
  baseUrl: string
  apiKey: string
  model: string
  language: string
  /** 本地 whisper.cpp 可执行文件路径（provider = local-whisper 时使用） */
  localBinaryPath: string
  /** 本地 whisper.cpp 模型文件路径 ggml-*.bin */
  localModelPath: string
}

export interface MicrophoneSettings {
  deviceId: string
  deviceLabel: string
  inputGain: number
}

export interface ExamSettings {
  defaultPreparationTime: number
  defaultResponseTime: number
  /** 考试中是否朗读听力材料（TTS） */
  speakListening: boolean
  /** 听力材料显示方式 */
  listeningDisplay: 'text' | 'hidden'
  /**
   * 全自动推进（接近官方真实考试）。
   *
   * 开启后：题目音频自动播放 → 播完自动开始录音 → 时间到自动保存并进入下一题。
   * 考生只能「提前结束本题」，不能延后，也不能重听。
   */
  autoAdvance: boolean
}

export interface AppSettings {
  llm: LlmSettings
  stt: SttSettings
  tts: TtsSettings
  microphone: MicrophoneSettings
  exam: ExamSettings
}

/** 暴露给 Renderer 的设置（不含明文密钥） */
export interface SafeAppSettings {
  llm: Omit<LlmSettings, 'apiKey'> & { apiKeySet: boolean; apiKeyPreview: string }
  stt: Omit<SttSettings, 'apiKey'> & { apiKeySet: boolean; apiKeyPreview: string }
  tts: Omit<TtsSettings, 'apiKey'> & { apiKeySet: boolean; apiKeyPreview: string }
  microphone: MicrophoneSettings
  exam: ExamSettings
  dataDir: string
}

/* ------------------------------------------------------------------ */
/*                          Provider 相关                              */
/* ------------------------------------------------------------------ */

export interface RemoteModel {
  id: string
  ownedBy?: string
  created?: number
}

export interface ListModelsResult {
  ok: boolean
  models: RemoteModel[]
  error?: string
  /** 用于诊断 */
  httpStatus?: number
  endpoint?: string
}

export interface ConnectionTestResult {
  ok: boolean
  message: string
  latencyMs?: number
  modelsCount?: number
  httpStatus?: number
  /** 模型返回的一小段原文，仅用于诊断（不包含密钥） */
  detail?: string
}

export interface SttResult {
  ok: boolean
  text: string
  provider: string
  model?: string
  error?: string
  durationMs?: number
}

export interface ScoreQuestionResult {
  ok: boolean
  score?: QuestionScore
  error?: string
  /** 使用的原始返回文本（截断），用于诊断 */
  raw?: string
  attempts?: number
}

/* ------------------------------------------------------------------ */
/*                              IPC 结果                               */
/* ------------------------------------------------------------------ */

export interface Ok<T> {
  ok: true
  data: T
}
export interface Err {
  ok: false
  error: string
  code?: string
}
export type Result<T> = Ok<T> | Err

/* ------------------------------------------------------------------ */
/*                           PDF 解析中间结构                          */
/* ------------------------------------------------------------------ */

export interface PdfPageText {
  page: number
  text: string
}

export interface PdfExtractResult {
  pages: PdfPageText[]
  totalPages: number
  pagesWithText: number
  /** 疑似扫描件 */
  likelyScanned: boolean
  usedOcr: boolean
  warnings: string[]
  filePath: string
  fileName: string
}

export interface ExamPlan {
  mode: ExamMode
  /** 每项：题目 + 该题的准备/回答时间（可被考试设置覆盖） */
  items: PlannedQuestion[]
  label: string
}

export interface PlannedQuestion {
  order: number
  question: Question
  preparationTime: number
  responseTime: number
}

export interface HistoryPoint {
  date: number
  overallScore: number | null
}

export interface DashboardStats {
  latest: ExamAttempt | null
  recent: ExamAttempt[]
  averageScore: number | null
  bestScore: number | null
  totalExams: number
  taskAverages: Record<TaskType, number | null>
  trend: HistoryPoint[]
  streakDays: number
}

export interface ExportReportResult {
  ok: boolean
  filePath?: string
  error?: string
}
