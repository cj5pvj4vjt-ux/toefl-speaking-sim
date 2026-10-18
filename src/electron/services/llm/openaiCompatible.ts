import { ChatCompletionSchema, ModelsListSchema } from '@shared/schemas'
import type { ConnectionTestResult, ListModelsResult, RemoteModel } from '@shared/types'
import { logger } from '../logger'

/**
 * OpenAI 兼容 Provider。
 * 不绑定任何厂商：只要实现了 /chat/completions 与 /models 即可。
 */

export interface LlmEndpointConfig {
  baseUrl: string
  apiKey: string
  model?: string
}

export function normalizeBaseUrl(raw: string): string {
  let s = (raw ?? '').trim()
  if (!s) return ''
  s = s.replace(/\/+$/, '')
  // 用户常常直接粘贴完整的 chat/completions 地址
  s = s.replace(/\/chat\/completions$/, '')
  s = s.replace(/\/completions$/, '')
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s
}

export function joinUrl(baseUrl: string, suffix: string): string {
  const base = normalizeBaseUrl(baseUrl)
  return `${base}/${suffix.replace(/^\/+/, '')}`
}

function authHeaders(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey && apiKey.trim()) h.Authorization = `Bearer ${apiKey.trim()}`
  return h
}

function describeHttpError(status: number, body: string): string {
  const snippet = (body || '').slice(0, 300)
  switch (status) {
    case 401:
      return `API Key 无效或已过期（HTTP 401）。${snippet}`
    case 403:
      return `没有访问权限，可能是 Key 权限或地区限制（HTTP 403）。${snippet}`
    case 404:
      return `接口地址不存在，请检查 Base URL 是否包含 /v1（HTTP 404）。${snippet}`
    case 429:
      return `请求过于频繁或额度用尽（HTTP 429）。${snippet}`
    default:
      if (status >= 500) return `服务端错误（HTTP ${status}）。${snippet}`
      return `请求失败（HTTP ${status}）。${snippet}`
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function humanizeFetchError(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } }
  if (err?.name === 'AbortError') return '请求超时，请检查网络或代理设置'
  const code = err?.cause?.code ?? ''
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '无法解析服务器域名，请检查 Base URL 与网络'
  if (code === 'ECONNREFUSED') return '连接被拒绝，请确认服务是否已启动（本地模型请检查端口）'
  if (code === 'CERT_HAS_EXPIRED' || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE')
    return 'TLS 证书校验失败，可能被网络中间设备拦截'
  return `网络请求失败：${err?.message ?? String(e)}`
}

/* ------------------------------------------------------------------ */
/*                          模型列表 / 绑定                            */
/* ------------------------------------------------------------------ */

export async function listModels(cfg: LlmEndpointConfig): Promise<ListModelsResult> {
  const endpoint = joinUrl(cfg.baseUrl, 'models')
  try {
    const res = await fetchWithTimeout(
      endpoint,
      { method: 'GET', headers: authHeaders(cfg.apiKey) },
      20000
    )
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, models: [], error: describeHttpError(res.status, text), httpStatus: res.status, endpoint }
    }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, models: [], error: '返回内容不是合法 JSON', httpStatus: res.status, endpoint }
    }
    const parsed = ModelsListSchema.safeParse(json)
    if (!parsed.success) {
      return { ok: false, models: [], error: '无法识别的模型列表格式', httpStatus: res.status, endpoint }
    }
    const raw = parsed.data.data ?? parsed.data.models ?? []
    const models: RemoteModel[] = raw
      .map((m: unknown) => {
        if (typeof m === 'string') return { id: m }
        const o = m as { id?: string; name?: string; owned_by?: string; created?: number }
        return { id: o.id ?? o.name ?? '', ownedBy: o.owned_by, created: o.created }
      })
      .filter((m) => m.id)
    models.sort((a, b) => a.id.localeCompare(b.id))
    return { ok: true, models, httpStatus: res.status, endpoint }
  } catch (e) {
    logger.warn('listModels 失败', e)
    return { ok: false, models: [], error: humanizeFetchError(e), endpoint }
  }
}

export async function testConnection(cfg: LlmEndpointConfig): Promise<ConnectionTestResult> {
  const started = Date.now()
  const models = await listModels(cfg)
  if (models.ok) {
    return {
      ok: true,
      message: `连接成功，发现 ${models.models.length} 个可用模型`,
      latencyMs: Date.now() - started,
      modelsCount: models.models.length,
      httpStatus: models.httpStatus
    }
  }
  // 部分服务不实现 /models，退化为一次极小的对话请求
  const probe = await chatCompletion({
    ...cfg,
    model: cfg.model || '',
    messages: [{ role: 'user', content: 'ping' }],
    maxTokens: 4,
    timeoutMs: 20000
  })
  if (probe.ok) {
    return {
      ok: true,
      message: '连接成功（该服务未提供 /models 列表，已通过对话接口验证）',
      latencyMs: Date.now() - started,
      modelsCount: 0
    }
  }
  return {
    ok: false,
    message: models.error || probe.error || '连接失败',
    latencyMs: Date.now() - started,
    httpStatus: models.httpStatus,
    detail: probe.raw?.slice(0, 300)
  }
}

/* ------------------------------------------------------------------ */
/*                          对话补全                                   */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOptions extends LlmEndpointConfig {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs?: number
  /** 强制 JSON 输出（部分厂商不支持时会自动降级重试） */
  jsonMode?: boolean
  /** 期望的 JSON Schema（json_schema 模式） */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
}

export interface ChatResult {
  ok: boolean
  content: string
  error?: string
  raw?: string
  finishReason?: string
  usedJsonMode?: boolean
}

function extractContent(json: unknown): { content: string; finishReason?: string } | null {
  const parsed = ChatCompletionSchema.safeParse(json)
  if (!parsed.success) return null
  const choice = parsed.data.choices[0]
  const msg = choice.message
  let content = ''
  if (typeof msg?.content === 'string') content = msg.content
  else if (Array.isArray(msg?.content)) {
    content = msg.content
      .map((p: unknown) => {
        const part = p as { text?: string; type?: string }
        return part?.text ?? ''
      })
      .join('')
  } else if (typeof choice.text === 'string') {
    content = choice.text
  }
  if (!content && msg?.reasoning_content) content = msg.reasoning_content
  return { content, finishReason: choice.finish_reason ?? undefined }
}

export async function chatCompletion(opts: ChatOptions): Promise<ChatResult> {
  const endpoint = joinUrl(opts.baseUrl, 'chat/completions')
  const body: Record<string, unknown> = {
    model: opts.model || undefined,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.1,
    stream: false
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens

  if (opts.jsonMode) {
    if (opts.jsonSchema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: false }
      }
    } else {
      body.response_format = { type: 'json_object' }
    }
  }

  const doRequest = async (payload: Record<string, unknown>) => {
    const res = await fetchWithTimeout(
      endpoint,
      { method: 'POST', headers: authHeaders(opts.apiKey), body: JSON.stringify(payload) },
      opts.timeoutMs ?? 120000
    )
    const text = await res.text()
    return { res, text }
  }

  try {
    let { res, text } = await doRequest(body)

    // 某些服务不支持 response_format / json_schema → 降级重试一次
    if (!res.ok && opts.jsonMode && res.status >= 400 && res.status < 500) {
      logger.warn(`服务不支持 JSON 模式（HTTP ${res.status}），降级为纯 Prompt 约束重试`)
      const fallback = { ...body }
      delete fallback.response_format
      const retry = await doRequest(fallback)
      res = retry.res
      text = retry.text
      if (res.ok) {
        const json = safeParse(text)
        const ex = json ? extractContent(json) : null
        return {
          ok: true,
          content: ex?.content ?? '',
          finishReason: ex?.finishReason,
          raw: text,
          usedJsonMode: false
        }
      }
    }

    if (!res.ok) {
      return { ok: false, content: '', error: describeHttpError(res.status, text), raw: text.slice(0, 600) }
    }

    const json = safeParse(text)
    if (!json) return { ok: false, content: '', error: '模型返回不是合法 JSON', raw: text.slice(0, 600) }
    const ex = extractContent(json)
    if (!ex) return { ok: false, content: '', error: '无法解析模型返回结构', raw: text.slice(0, 600) }
    if (!ex.content.trim())
      return { ok: false, content: '', error: '模型返回了空内容', raw: text.slice(0, 600) }
    return { ok: true, content: ex.content, finishReason: ex.finishReason, raw: text, usedJsonMode: !!opts.jsonMode }
  } catch (e) {
    logger.warn('chatCompletion 失败', e)
    return { ok: false, content: '', error: humanizeFetchError(e) }
  }
}

function safeParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------ */
/*                        语音转文字（STT）                            */
/* ------------------------------------------------------------------ */

export interface TranscribeOptions extends LlmEndpointConfig {
  audio: Buffer
  fileName: string
  mimeType: string
  language?: string
  timeoutMs?: number
}

export interface TranscribeResult {
  ok: boolean
  text: string
  error?: string
  raw?: string
}

export async function transcribeAudio(opts: TranscribeOptions): Promise<TranscribeResult> {
  const endpoint = joinUrl(opts.baseUrl, 'audio/transcriptions')
  try {
    const form = new FormData()
    const blob = new Blob([new Uint8Array(opts.audio)], { type: opts.mimeType || 'audio/webm' })
    form.append('file', blob, opts.fileName)
    form.append('model', opts.model || 'whisper-1')
    if (opts.language) form.append('language', opts.language)
    form.append('response_format', 'json')
    form.append('temperature', '0')

    const headers: Record<string, string> = {}
    if (opts.apiKey && opts.apiKey.trim()) headers.Authorization = `Bearer ${opts.apiKey.trim()}`

    const res = await fetchWithTimeout(endpoint, { method: 'POST', headers, body: form }, opts.timeoutMs ?? 180000)
    const text = await res.text()
    if (!res.ok) {
      return { ok: false, text: '', error: describeHttpError(res.status, text), raw: text.slice(0, 600) }
    }
    const json = safeParse(text)
    if (json && typeof json === 'object') {
      const obj = json as { text?: string; segments?: unknown }
      if (typeof obj.text === 'string') return { ok: true, text: obj.text.trim(), raw: text.slice(0, 400) }
    }
    // 有些服务直接返回纯文本
    if (text.trim() && !text.trim().startsWith('{')) return { ok: true, text: text.trim() }
    return { ok: false, text: '', error: '无法解析转写结果', raw: text.slice(0, 600) }
  } catch (e) {
    logger.warn('transcribeAudio 失败', e)
    return { ok: false, text: '', error: humanizeFetchError(e) }
  }
}
