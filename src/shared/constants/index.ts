import type { TaskType } from '../types'

/** 应用显示名（Dock / 窗口标题 / 报告页脚唯一来源，改名只需改这里 + package.json） */
export const APP_NAME = 'TOEFL 口语模考'

/** 拉丁字母名，用于报告封面、DMG 文件名等不便使用中文的场景 */
export const APP_NAME_LATIN = 'TOEFL Speaking Sim'

/** 产品副标题 */
export const APP_TAGLINE = 'Mock Exam Sim'

/** 2026 新版托福 Speaking 的两大题型 */
export const TASK_TYPES: TaskType[] = ['LISTEN_REPEAT', 'INTERVIEW']

export interface TaskMeta {
  type: TaskType
  /** 1..2（在 Speaking section 中的题型序号） */
  index: number
  shortLabel: string
  title: string
  /** 官方任务名称 */
  officialName: string
  description: string
  /** 官方默认准备时间（秒） */
  prepTime: number
  /** 官方默认回答时间（秒） */
  responseTime: number
  hasReading: boolean
  hasListening: boolean
  accent: string
}

export const TASK_META: Record<TaskType, TaskMeta> = {
  LISTEN_REPEAT: {
    type: 'LISTEN_REPEAT',
    index: 1,
    shortLabel: 'Listen & Repeat',
    title: 'Listen and Repeat',
    officialName: 'Listen and Repeat（听后重复）',
    description:
      '系统播放一句校园或日常场景的短句，没有准备时间，听完立刻原样复述一遍。句子由短到长、由简单到复杂，作答时间从 8 秒逐步增加到 12 秒。音频只播一遍，不可重听。',
    prepTime: 0,
    responseTime: 12,
    hasReading: false,
    hasListening: true,
    accent: '#22D3EE'
  },
  INTERVIEW: {
    type: 'INTERVIEW',
    index: 2,
    shortLabel: 'Interview',
    title: 'Take an Interview',
    officialName: 'Take an Interview（虚拟面试）',
    description:
      '与预录的虚拟面试官对话，对方连续提出 4 个问题，问完立刻作答，没有准备时间，每题限时 45 秒，超时自动切断。',
    prepTime: 0,
    responseTime: 45,
    hasReading: false,
    hasListening: true,
    accent: '#34D399'
  }
}

/**
 * 2026 新版托福官方分数体系。
 *
 * 官方说明（ETS，2026 年 1 月起）：
 *  - 每个单项（Reading / Listening / Writing / Speaking）报 1–6 分，0.5 递增
 *  - 总分 = 四个单项的平均分，同样 1–6 分、0.5 递增
 *  - 1–6 分档与 CEFR 对接（6 分约对应 C1）
 *
 * 本 App 一个回答按 0–6 评分，单项分 = 所有回答的平均分，
 * 再规整到 1–6、0.5 递增，与官方口径一致。
 * ETS 未公布「每道题的原始分」到档位的唯一映射，因此 UI 中标注 Estimated。
 */
/**
 * 官方 Directions 原文（屏幕上方显示的指令）。
 *
 * 2026 新托福口语的屏幕呈现规则：**屏幕上只有场景，没有题目文字**。
 * 跟读题绝不显示目标句，面试题在提问播完后才显示问题文本。
 */
export const TASK_DIRECTIONS: Record<TaskType, string> = {
  LISTEN_REPEAT:
    'You will listen as someone speaks to you. Listen carefully and then repeat what you have heard. Repeat only once.',
  INTERVIEW:
    'You will hear an interviewer ask you a question. Answer it as fully as you can within the time limit.'
}

export const BAND_MIN = 1
export const BAND_MAX = 6
/** 官方的档位步长 */
export const BAND_STEP = 0.5

/** 单个回答的满分 */
export const MAX_RESPONSE_SCORE = 6

export const AI_DIMENSIONS = [
  { key: 'delivery', label: 'Delivery', labelZh: '表达与流利度', color: '#818CF8' },
  { key: 'language_use', label: 'Language Use', labelZh: '语言运用', color: '#22D3EE' },
  { key: 'topic_development', label: 'Content', labelZh: '内容与准确度', color: '#34D399' }
] as const

export type DimensionKey = (typeof AI_DIMENSIONS)[number]['key']

/** 默认设置 */
export const DEFAULT_SETTINGS = {
  llm: {
    provider: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    temperature: 0.1,
    useJsonSchema: true
  },
  stt: {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'whisper-1',
    language: 'en',
    localBinaryPath: '',
    localModelPath: ''
  },
  microphone: {
    deviceId: 'default',
    deviceLabel: '',
    inputGain: 1
  },
  tts: {
    provider: 'cloud' as const,
    baseUrl: '',
    apiKey: '',
    model: 'qwen3-tts-flash',
    voice: 'Serena',
    systemVoice: 'Samantha',
    /*
     * 实测云端模型在 speed=1.0 时约 135 wpm，偏慢；
     * 官方听力材料约 150–165 wpm，所以默认在播放端提速。
     * Chromium 会保持音高（preservesPitch），不会变成「快进怪声」。
     */
    speed: 1.15
  },
  exam: {
    defaultPreparationTime: 0,
    defaultResponseTime: 0,
    speakListening: false,
    listeningDisplay: 'text' as const,
    autoAdvance: true
  }
}

/** 云端 TTS 音色（Qwen3-TTS，已实测全部可用） */
export const TTS_VOICES: { id: string; label: string }[] = [
  { id: 'Serena', label: 'Serena · 女声，自然清晰（推荐）' },
  { id: 'Cherry', label: 'Cherry · 女声，明亮偏活泼' },
  { id: 'Chelsie', label: 'Chelsie · 女声，柔和' },
  { id: 'Ethan', label: 'Ethan · 男声，稳重清晰' },
  { id: 'Dylan', label: 'Dylan · 男声，偏低沉' },
  { id: 'Jada', label: 'Jada · 女声，偏成熟' },
  { id: 'Sunny', label: 'Sunny · 偏年轻活泼' }
]

/** 常用云端 TTS 模型 */
export const TTS_MODELS = ['qwen3-tts-flash', 'qwen3-tts', 'cicada-tts']

/** 系统语音（macOS say）常见音色，作为云端不可用时的兜底 */
export const SYSTEM_TTS_VOICES = [
  'Samantha',
  'Alex',
  'Daniel',
  'Karen',
  'Moira',
  'Tessa',
  'Fred',
  'Victoria'
]

/** 试听用的固定句子（贴近托福口语音频风格） */
export const TTS_PREVIEW_TEXT = 'Please remember to turn off the lights before you leave.'

export const SUPPORTED_STT_MODELS = ['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe']

/** 常用 OpenAI 兼容服务预设，方便用户快速切换 */
export const LLM_PRESETS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'] },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'moonshot', label: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k'] },
  { id: 'dashscope', label: '阿里云百炼 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'zhipu', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash', 'glm-4-air'] },
  { id: 'siliconflow', label: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', models: [] },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: [] },
  { id: 'ollama', label: '本地 Ollama', baseUrl: 'http://localhost:11434/v1', models: ['qwen2.5:14b', 'llama3.1:8b'] },
  { id: 'custom', label: '自定义 / 其他兼容服务', baseUrl: '', models: [] }
] as const
