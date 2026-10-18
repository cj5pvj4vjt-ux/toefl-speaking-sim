import type {
  AppSettings,
  ExamSettings,
  LlmSettings,
  MicrophoneSettings,
  SttSettings,
  TtsSettings,
  ConnectionTestResult,
  DashboardStats,
  ExamAttempt,
  ExamMode,
  ExportReportResult,
  ListModelsResult,
  Question,
  QuestionSet,
  SafeAppSettings,
  TaskType
} from './index'

/** 设置补丁：允许只提交某一层的一部分字段 */
export interface SettingsPatch {
  llm?: Partial<LlmSettings>
  stt?: Partial<SttSettings>
  tts?: Partial<TtsSettings>
  microphone?: Partial<MicrophoneSettings>
  exam?: Partial<ExamSettings>
}

export interface AppInfo {
  version: string
  name: string
  platform: string
  arch: string
  electron: string
  chrome: string
  node: string
  dataDir: string
  recordingsDir: string
  reportsDir: string
  encryptionAvailable: boolean
  sttProviders: { id: string; label: string }[]
}

export interface OpenedFile {
  ok: boolean
  filePath?: string
  fileName?: string
  size?: number
  /** PDF 原始字节，供渲染进程用 pdf.js 解析 */
  data?: ArrayBuffer
  error?: string
  canceled?: boolean
}

/**
 * 考试相关 IPC 的返回契约。
 * 这些别名被主进程 handler 与渲染进程同时引用，
 * 保证「主进程返回什么」和「渲染进程读什么」永远一致
 * （曾经这里只声明 {ok, attempt} 而主进程返回 {ok, data}，导致点击开始考试必然失败）。
 */
export type ExamCreateResult =
  | { ok: true; attempt: ExamAttempt }
  | { ok: false; error: string }

export type ExamSaveRecordingResult =
  | { ok: true; audioPath?: string }
  | { ok: false; error: string }

export type ExamAnalyzeResult =
  | { ok: true; attempt: ExamAttempt }
  | { ok: false; error: string }

export interface CreateExamRequest {
  questionSetId: string
  mode: ExamMode
  customTaskTypes?: TaskType[]
  /** 覆盖默认时间（可选） */
  preparationTime?: number
  responseTime?: number
  title?: string
}

export interface SaveRecordingRequest {
  examId: string
  order: number
  taskType: TaskType
  occurrence: number
  mimeType: string
  durationMs: number
  data: ArrayBuffer
}

export interface ReanalyzeRequest {
  examId: string
  transcribeOnly?: boolean
  force?: boolean
  regenerateSummary?: boolean
}

export interface PipelineProgressEvent {
  examId: string
  stage: 'idle' | 'stt' | 'scoring' | 'summary' | 'done'
  itemIndex: number
  itemTotal: number
  message: string
  attempt?: ExamAttempt
  error?: string
}

export interface TestConnectionRequest {
  baseUrl?: string
  apiKey?: string
  model?: string
}

export interface ListModelsRequest {
  baseUrl?: string
  apiKey?: string
}

export interface TofeApi {
  /* ------------------------------ 应用 ------------------------------ */
  getAppInfo(): Promise<AppInfo>

  /* ------------------------------ 设置 ------------------------------ */
  settings: {
    get(): Promise<SafeAppSettings>
    save(patch: SettingsPatch): Promise<SafeAppSettings>
    setApiKey(which: 'llm' | 'stt' | 'tts', apiKey: string): Promise<SafeAppSettings>
    clearApiKey(which: 'llm' | 'stt' | 'tts'): Promise<SafeAppSettings>
    testConnection(req?: TestConnectionRequest): Promise<ConnectionTestResult>
    listModels(req?: ListModelsRequest): Promise<ListModelsResult>
    diagnoseStt(): Promise<{ ok: boolean; message: string; detail?: string }>
    chooseDataDir(): Promise<{ ok: boolean; path?: string; error?: string }>
    openDataDir(): Promise<void>
  }

  /* ------------------------------ 文件 ------------------------------ */
  file: {
    openPdfDialog(): Promise<OpenedFile>
    readPdf(path: string): Promise<OpenedFile>
    /** 用系统默认程序打开文件/目录 */
    reveal(path: string): Promise<void>
    openExternal(path: string): Promise<void>
    saveDialog(defaultName: string, data: ArrayBuffer): Promise<{ ok: boolean; path?: string; error?: string }>
    /** 获取拖拽文件的真实路径（可能返回空字符串） */
    pathForFile(file: File): string
  }

  /* ------------------------------ 题库 ------------------------------ */
  questionSets: {
    list(): Promise<QuestionSet[]>
    get(id: string): Promise<QuestionSet | null>
    save(set: QuestionSet): Promise<QuestionSet>
    delete(id: string): Promise<{ ok: boolean }>
    updateQuestion(setId: string, question: Question): Promise<QuestionSet | null>
  }

  /* ------------------------------ 考试 ------------------------------ */
  exams: {
    create(req: CreateExamRequest): Promise<ExamCreateResult>
    saveRecording(req: SaveRecordingRequest): Promise<ExamSaveRecordingResult>
    finish(examId: string): Promise<ExamAnalyzeResult>
    get(id: string): Promise<ExamAttempt | null>
    list(limit?: number): Promise<ExamAttempt[]>
    delete(id: string): Promise<{ ok: boolean }>
    reanalyze(req: ReanalyzeRequest): Promise<ExamAnalyzeResult>
    dashboard(): Promise<DashboardStats>
    clearAll(): Promise<{ ok: boolean }>
    onProgress(cb: (e: PipelineProgressEvent) => void): () => void
  }

  /* --------------------------- PDF 智能解析 --------------------------- */
  pdf: {
    /**
     * 交给云端模型把「页面文字」整理成结构化题目。
     *
     * 解决规则解析搞不定的版式：不同模板、带参考答案干扰、
     * 题号错乱、中英混排标记、甚至扫描件 OCR 后的脏文本。
     */
    parseLlm(
      pages: { page: number; text: string }[],
      concurrency?: number
    ): Promise<{
      ok: boolean
      questions?: Question[]
      warnings?: string[]
      chunks?: number
      failedChunks?: number
      error?: string
    }>
    /** 解析进度（主进程主动推送） */
    onParseProgress(cb: (e: { done: number; total: number; message: string }) => void): () => void
  }

  /* ------------------------------ 音频 ------------------------------ */
  audio: {
    read(path: string): Promise<{ ok: boolean; data?: ArrayBuffer; error?: string }>
    delete(path: string): Promise<{ ok: boolean }>
    /** 合成（或命中缓存）一道题的题目音频；仅 macOS 可用，失败时渲染层降级显示文本 */
    prompt(req: { text: string; voice?: string; rate?: number }): Promise<{
      ok: boolean
      audioPath?: string
      durationMs?: number
      cached?: boolean
      error?: string
    }>
    /** 把合成好的 WAV 读成字节流，用 blob 播放 */
    readPrompt(path: string): Promise<{ ok: boolean; data?: ArrayBuffer; mimeType?: string; error?: string }>
    promptVoices(): Promise<{ ok: boolean; voices: string[] }>
    clearPromptCache(): Promise<{ ok: boolean; removed: number }>
  }

  /* ------------------------------ OCR ------------------------------ */
  ocr: {
    /** 主进程用 tesseract 识别页面图片（扫描版 PDF 用） */
    recognize(image: ArrayBuffer, lang?: string): Promise<{ ok: boolean; text: string; error?: string; confidence?: number }>
  }

  /* ------------------------------ 报告 ------------------------------ */
  report: {
    export(examId: string, studentName?: string): Promise<ExportReportResult>
    exportTo(examId: string, filePath: string, studentName?: string): Promise<ExportReportResult>
  }
}
