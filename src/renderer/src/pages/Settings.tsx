import React, { useEffect, useMemo, useState } from 'react'
import { LLM_PRESETS, SUPPORTED_STT_MODELS, SYSTEM_TTS_VOICES, TTS_MODELS, TTS_PREVIEW_TEXT, TTS_VOICES } from '@shared/constants'
import type { RemoteModel } from '@shared/types'
import {
  IconAlert,
  IconCheck,
  IconDownload,
  IconKeyboard,
  IconMic,
  IconRefresh,
  IconSpark,
  IconTrash
} from '../components/icons'
import { Badge, Card, ConfirmDialog, Field, SectionHeader, Spinner, Tabs, Toggle, cx } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { listMicrophonesWithPermission, testMicrophone, type MicDevice } from '../lib/recorder'
import { useAppStore } from '../stores/useAppStore'
import { useSettingsStore } from '../stores/useSettingsStore'

type Tab = 'ai' | 'stt' | 'tts' | 'mic' | 'exam' | 'data'

export default function SettingsPage(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('ai')
  const toast = useAppStore((s) => s.toast)

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[900px] px-8 pb-20">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">设置</h1>
          <p className="mt-1 text-sm text-slate-400">
            API Key 使用系统钥匙串加密保存在主进程中，不会写进前端代码、日志或浏览器存储。
          </p>
        </div>

        <div className="mb-5">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'ai', label: 'AI 评分' },
              { value: 'stt', label: '语音转文字' },
              { value: 'tts', label: '题目语音' },
              { value: 'mic', label: '麦克风' },
              { value: 'exam', label: '考试' },
              { value: 'data', label: '数据' }
            ]}
          />
        </div>

        {tab === 'ai' && <AiSettings toast={toast} />}
        {tab === 'stt' && <SttSettingsPanel toast={toast} />}
        {tab === 'tts' && <TtsSettingsPanel toast={toast} />}
        {tab === 'mic' && <MicSettings toast={toast} />}
        {tab === 'exam' && <ExamSettingsPanel toast={toast} />}
        {tab === 'data' && <DataSettings toast={toast} />}
      </div>
    </div>
  )
}

/* ================================================================== */
/*                             AI 评分                                 */
/* ================================================================== */

function AiSettings({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const clearApiKey = useSettingsStore((s) => s.clearApiKey)
  const load = useSettingsStore((s) => s.load)

  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [temperature, setTemperature] = useState(0.1)
  const [useJsonSchema, setUseJsonSchema] = useState(true)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [models, setModels] = useState<RemoteModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null)
  const [autoBind, setAutoBind] = useState(true)

  useEffect(() => {
    if (!settings) return
    setBaseUrl(settings.llm.baseUrl)
    setModel(settings.llm.model)
    setTemperature(settings.llm.temperature)
    setUseJsonSchema(settings.llm.useJsonSchema)
  }, [settings])

  const knownModels = useMemo(
    () => models.map((m) => m.id).filter(Boolean),
    [models]
  )

  /** 拉取模型列表并自动绑定第一个可用模型 */
  const fetchModels = async (quiet = false) => {
    setLoadingModels(true)
    setTestResult(null)
    try {
      const res = await api.settings.listModels({
        baseUrl,
        apiKey: apiKeyInput.trim() || undefined
      })
      if (!res.ok) {
        if (!quiet) {
          toast({
            kind: 'error',
            title: '获取模型列表失败',
            detail: res.error ?? '请检查 Base URL 与 API Key'
          } as never)
        }
        setModels([])
        return []
      }
      setModels(res.models)
      if (!quiet) {
        toast({
          kind: 'success',
          title: `已获取 ${res.models.length} 个可用模型`,
          detail: '请在下拉框中选择用于评分的模型'
        } as never)
      }
      // 自动绑定：若尚未选择模型，或当前模型不在列表中，则自动选一个
      const current = model.trim()
      const stillValid = current && res.models.some((m) => m.id === current)
      if (autoBind && !stillValid && res.models.length > 0) {
        const preferred = pickPreferredModel(res.models.map((m) => m.id))
        setModel(preferred)
        await save({ llm: { model: preferred } })
      }
      return res.models
    } catch (e) {
      toast({ kind: 'error', title: '获取模型列表失败', detail: errorMessage(e) } as never)
      return []
    } finally {
      setLoadingModels(false)
    }
  }

  const doTest = async () => {
    setTesting(true)
    setTestResult(null)
    // 先保存 Base URL，主进程才能带上已存密钥
    await save({ llm: { baseUrl: baseUrl.trim(), model: model.trim(), temperature, useJsonSchema } })
    try {
      const res = await api.settings.testConnection({
        baseUrl: baseUrl.trim(),
        apiKey: apiKeyInput.trim() || undefined,
        model: model.trim() || undefined
      })
      setTestResult({ ok: res.ok, message: res.message, latencyMs: res.latencyMs })
      if (res.ok && autoBind) await fetchModels(true)
    } catch (e) {
      setTestResult({ ok: false, message: errorMessage(e) })
    } finally {
      setTesting(false)
    }
  }

  const saveKey = async () => {
    const key = apiKeyInput.trim()
    if (!key) {
      toast({ kind: 'warn', title: '请输入 API Key' } as never)
      return
    }
    const ok = await setApiKey('llm', key)
    if (ok) {
      setApiKeyInput('')
      toast({ kind: 'success', title: 'API Key 已加密保存到系统钥匙串' } as never)
    } else {
      toast({ kind: 'error', title: '保存失败' } as never)
    }
  }

  const persistLlm = async (extra: Partial<{ model: string; baseUrl: string }> = {}) => {
    const ok = await save({
      llm: {
        baseUrl: (extra.baseUrl ?? baseUrl).trim(),
        model: (extra.model ?? model).trim(),
        temperature,
        useJsonSchema
      }
    })
    if (ok) toast({ kind: 'success', title: '已保存' } as never)
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader
          title="云端大模型（OpenAI 兼容接口）"
          subtitle="不绑定任何厂商，只要兼容 /chat/completions 即可"
          right={
            settings?.llm.apiKeySet ? (
              <Badge tone="good">
                <IconCheck size={11} /> 密钥已保存 {settings.llm.apiKeyPreview}
              </Badge>
            ) : (
              <Badge tone="warn">未配置密钥</Badge>
            )
          }
        />

        <div className="space-y-4">
          <div>
            <label className="label">快速选择服务商</label>
            <div className="flex flex-wrap gap-2">
              {LLM_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={async () => {
                    if (!p.baseUrl) return
                    const presetUrl: string = p.baseUrl
                    setBaseUrl(presetUrl)
                    setModels([])
                    const firstModel: string | undefined = p.models[0]
                    if (firstModel && !model) setModel(firstModel)
                    await save({ llm: { baseUrl: presetUrl, provider: p.id } })
                  }}
                  className={cx(
                    'rounded-lg border px-2.5 py-1.5 text-[11px] transition',
                    settings?.llm.provider === p.id
                      ? 'border-brand-500/60 bg-brand-500/12 text-brand-200'
                      : 'border-white/10 text-slate-400 hover:border-white/25 hover:text-slate-200'
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <Field label="Base URL" hint="例如 https://api.openai.com/v1、https://api.deepseek.com/v1">
            <input
              className="input font-mono text-[12.5px]"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              onBlur={() => void save({ llm: { baseUrl: baseUrl.trim() } })}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </Field>

          <Field label="API Key" hint="只写入、不回读；已保存的密钥不会显示明文，也不会进入日志。">
            <div className="flex gap-2">
              <input
                className="input font-mono text-[12.5px]"
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={settings?.llm.apiKeySet ? `已保存 ${settings.llm.apiKeyPreview}（输入新值可覆盖）` : 'sk-...'}
                spellCheck={false}
                autoComplete="off"
              />
              <button className="btn-ghost shrink-0" onClick={saveKey}>
                保存密钥
              </button>
              {settings?.llm.apiKeySet && (
                <button
                  className="btn-ghost shrink-0 text-red-300/80 hover:text-red-200"
                  onClick={async () => {
                    await clearApiKey('llm')
                    toast({ kind: 'info', title: '已清除 AI 评分密钥' } as never)
                  }}
                >
                  清除
                </button>
              )}
            </div>
          </Field>

          {/* 模型绑定 */}
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[13px] font-medium text-slate-200">模型绑定</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  测试连接成功后会自动拉取可用模型；也可以手动填写模型名称。
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-ghost btn-sm" onClick={doTest} disabled={testing}>
                  {testing ? <Spinner size={12} /> : <IconCheck size={12} />} 测试连接
                </button>
                <button className="btn-ghost btn-sm" onClick={() => fetchModels(false)} disabled={loadingModels}>
                  {loadingModels ? <Spinner size={12} /> : <IconDownload size={12} />} 获取模型列表
                </button>
              </div>
            </div>

            {testResult && (
              <div
                className={cx(
                  'mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-[11.5px]',
                  testResult.ok
                    ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200'
                    : 'border-red-500/30 bg-red-500/[0.07] text-red-200'
                )}
              >
                {testResult.ok ? <IconCheck size={13} className="mt-0.5" /> : <IconAlert size={13} className="mt-0.5" />}
                <span className="flex-1 leading-relaxed">
                  {testResult.message}
                  {testResult.latencyMs != null && `（${testResult.latencyMs} ms）`}
                </span>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                {models.length > 0 ? (
                  <select className="input font-mono text-[12.5px]" value={model} onChange={(e) => setModel(e.target.value)}>
                    <option value="">（请选择模型）</option>
                    {knownModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {model && !knownModels.includes(model) && <option value={model}>{model}（自定义）</option>}
                  </select>
                ) : (
                  <input
                    className="input font-mono text-[12.5px]"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="例如 gpt-4o / deepseek-chat / qwen-plus"
                    spellCheck={false}
                    list="llm-model-suggestions"
                  />
                )}
                <datalist id="llm-model-suggestions">
                  {knownModels.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <button className="btn-primary" onClick={() => void persistLlm()} disabled={!model.trim()}>
                绑定此模型
              </button>
            </div>

            {models.length > 0 && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
                <span>已加载 {models.length} 个模型</span>
                {model && <span>· 当前绑定：<span className="font-mono text-brand-300">{model}</span></span>}
                <button
                  className="ml-auto text-slate-500 underline decoration-dotted hover:text-slate-300"
                  onClick={() => {
                    setModels([])
                    setAutoBind(false)
                  }}
                >
                  切换为手动输入
                </button>
              </div>
            )}

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11.5px] text-slate-400">
              <input
                type="checkbox"
                checked={autoBind}
                onChange={(e) => setAutoBind(e.target.checked)}
                className="h-3.5 w-3.5 accent-indigo-500"
              />
              测试连接成功后自动绑定一个可用模型
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Temperature" hint="评分要求低随机性，建议 0 - 0.2">
              <input
                className="input"
                type="number"
                step={0.05}
                min={0}
                max={2}
                value={temperature}
                onChange={(e) => setTemperature(Math.max(0, Math.min(2, Number(e.target.value) || 0)))}
                onBlur={() => void save({ llm: { temperature } })}
              />
            </Field>
            <Field label="JSON 输出模式" hint="优先使用 response_format，服务不支持时会自动降级">
              <label className="flex h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-ink-950/60 px-3.5 text-[12.5px] text-slate-300">
                <input
                  type="checkbox"
                  checked={useJsonSchema}
                  onChange={(e) => {
                    setUseJsonSchema(e.target.checked)
                    void save({ llm: { useJsonSchema: e.target.checked } })
                  }}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                强制模型返回结构化 JSON
              </label>
            </Field>
          </div>
        </div>
      </Card>

      <Card className="border-white/[0.06]">
        <div className="flex items-start gap-2.5">
          <IconKeyboard size={16} className="mt-0.5 text-slate-500" />
          <div className="text-[11.5px] leading-relaxed text-slate-500">
            评分 Prompt 由 App 内部固定维护（严格遵循 2026 新托福口语 0-6 分评分量表与
            Delivery / Language Use / Topic Development 三维度），你无需也不能修改它，
            以保证每次评分的标准一致可比。
          </div>
        </div>
      </Card>
    </div>
  )
}

/* ================================================================== */
/*                          语音转文字                                 */
/* ================================================================== */

function SttSettingsPanel({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const clearApiKey = useSettingsStore((s) => s.clearApiKey)
  const load = useSettingsStore((s) => s.load)

  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('whisper-1')
  const [language, setLanguage] = useState('en')
  const [keyInput, setKeyInput] = useState('')
  const [binaryPath, setBinaryPath] = useState('')
  const [modelPath, setModelPath] = useState('')
  const [diag, setDiag] = useState<{ ok: boolean; message: string; detail?: string } | null>(null)

  useEffect(() => {
    if (!settings) return
    setBaseUrl(settings.stt.baseUrl)
    setModel(settings.stt.model)
    setLanguage(settings.stt.language)
    setBinaryPath(settings.stt.localBinaryPath)
    setModelPath(settings.stt.localModelPath)
  }, [settings])

  const provider = settings?.stt.provider ?? 'openai-compatible'

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader
          title="语音转文字引擎"
          subtitle="考试结束后对所有回答自动转写"
          right={
            settings?.stt.apiKeySet ? (
              <Badge tone="good">密钥已保存 {settings.stt.apiKeyPreview}</Badge>
            ) : provider === 'local-whisper' ? (
              <Badge tone="aqua">本地离线</Badge>
            ) : (
              <Badge tone="warn">未配置密钥</Badge>
            )
          }
        />

        <div className="grid gap-2.5 md:grid-cols-3">
          {[
            { id: 'openai-compatible', label: '云端 OpenAI 兼容', desc: 'whisper-1 / gpt-4o-transcribe' },
            { id: 'local-whisper', label: '本地 Whisper', desc: '完全离线，需 whisper.cpp' },
            { id: 'none', label: '不转写', desc: '只保存录音' }
          ].map((p) => (
            <button
              key={p.id}
              onClick={async () => {
                await save({ stt: { provider: p.id as never } })
                setDiag(null)
              }}
              className={cx(
                'rounded-xl border px-4 py-3 text-left transition',
                provider === p.id
                  ? 'border-brand-500/60 bg-brand-500/[0.08]'
                  : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
              )}
            >
              <div className={cx('text-[13px] font-medium', provider === p.id ? 'text-brand-100' : 'text-slate-200')}>
                {p.label}
              </div>
              <div className="mt-0.5 text-[11px] text-slate-500">{p.desc}</div>
            </button>
          ))}
        </div>

        {provider === 'openai-compatible' && (
          <div className="mt-5 space-y-4">
            <Field label="Base URL" hint="支持 OpenAI、Groq、硅基流动等所有兼容 /audio/transcriptions 的服务">
              <input
                className="input font-mono text-[12.5px]"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                onBlur={() => void save({ stt: { baseUrl: baseUrl.trim() } })}
                spellCheck={false}
              />
            </Field>
            <Field label="API Key">
              <div className="flex gap-2">
                <input
                  className="input font-mono text-[12.5px]"
                  type="password"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder={settings?.stt.apiKeySet ? `已保存 ${settings.stt.apiKeyPreview}` : 'sk-...'}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button
                  className="btn-ghost shrink-0"
                  onClick={async () => {
                    if (!keyInput.trim()) return
                    const ok = await setApiKey('stt', keyInput.trim())
                    if (ok) {
                      setKeyInput('')
                      toast({ kind: 'success', title: 'STT 密钥已保存' } as never)
                    }
                  }}
                >
                  保存密钥
                </button>
                {settings?.stt.apiKeySet && (
                  <button
                    className="btn-ghost shrink-0 text-red-300/80"
                    onClick={async () => {
                      await clearApiKey('stt')
                      toast({ kind: 'info', title: '已清除 STT 密钥' } as never)
                    }}
                  >
                    清除
                  </button>
                )}
              </div>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="模型">
                <input
                  className="input font-mono text-[12.5px]"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() => void save({ stt: { model: model.trim() } })}
                  list="stt-model-suggestions"
                  spellCheck={false}
                />
                <datalist id="stt-model-suggestions">
                  {SUPPORTED_STT_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </Field>
              <Field label="识别语言" hint="托福口语用英语回答，建议 en">
                <select
                  className="input"
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value)
                    void save({ stt: { language: e.target.value } })
                  }}
                >
                  <option value="en">en — 英语</option>
                  <option value="zh">zh — 中文</option>
                  <option value="auto">自动识别</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {provider === 'local-whisper' && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/[0.05] px-4 py-3 text-[11.5px] leading-relaxed text-cyan-100/80">
              本地模式完全离线、不产生任何费用。需要先安装：
              <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">brew install whisper-cpp ffmpeg</code>
              然后下载一个 ggml 模型（例如 ggml-base.en.bin）并在这里指定路径。
            </div>
            <Field label="whisper.cpp 可执行文件路径" hint="留空则自动在 PATH 中查找 whisper-cli / whisper-cpp">
              <input
                className="input font-mono text-[12.5px]"
                value={binaryPath}
                onChange={(e) => setBinaryPath(e.target.value)}
                onBlur={() => void save({ stt: { localBinaryPath: binaryPath.trim() } })}
                placeholder="/opt/homebrew/bin/whisper-cli"
                spellCheck={false}
              />
            </Field>
            <Field label="模型文件路径（ggml-*.bin）">
              <input
                className="input font-mono text-[12.5px]"
                value={modelPath}
                onChange={(e) => setModelPath(e.target.value)}
                onBlur={() => void save({ stt: { localModelPath: modelPath.trim() } })}
                placeholder="/Users/you/models/ggml-base.en.bin"
                spellCheck={false}
              />
            </Field>
            <Field label="识别语言">
              <select
                className="input"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value)
                  void save({ stt: { language: e.target.value } })
                }}
              >
                <option value="en">en — 英语</option>
                <option value="zh">zh — 中文</option>
              </select>
            </Field>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            className="btn-ghost"
            onClick={async () => {
              await load()
              const res = await api.settings.diagnoseStt()
              setDiag(res)
            }}
          >
            <IconRefresh size={14} /> 诊断引擎可用性
          </button>
        </div>

        {diag && (
          <div
            className={cx(
              'mt-3 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed',
              diag.ok
                ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200'
                : 'border-amber-500/25 bg-amber-500/[0.06] text-amber-200'
            )}
          >
            {diag.ok ? <IconCheck size={14} className="mt-0.5" /> : <IconAlert size={14} className="mt-0.5" />}
            <div>
              <div>{diag.message}</div>
              {diag.detail && <div className="mt-1 font-mono text-[11px] opacity-70">{diag.detail}</div>}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

/* ================================================================== */
/*                            麦克风                                   */
/* ================================================================== */

function MicSettings({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const [mics, setMics] = useState<MicDevice[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'testing' | 'ok' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const detect = async () => {
    setState('loading')
    setMessage('正在请求麦克风权限…')
    try {
      const list = await listMicrophonesWithPermission()
      setMics(list)
      setState('idle')
      setMessage(`检测到 ${list.length} 个输入设备`)
      if (list.length === 0) {
        setState('error')
        setMessage('没有检测到任何麦克风设备')
      }
    } catch (e) {
      setState('error')
      setMessage(errorMessage(e))
    }
  }

  const test = async () => {
    setState('testing')
    setMessage('请对着麦克风说一句话（采样 2.5 秒）…')
    try {
      const deviceId = settings?.microphone.deviceId ?? 'default'
      const res = await testMicrophone(deviceId === 'default' && mics[0] ? mics[0].deviceId : deviceId)
      setState(res.ok ? 'ok' : 'error')
      setMessage(`${res.message}（峰值 ${(res.peak * 100).toFixed(0)}%）`)
    } catch (e) {
      setState('error')
      setMessage(errorMessage(e))
    }
  }

  return (
    <Card>
      <SectionHeader title="麦克风" subtitle="考试会自动使用这里选择的输入设备" />
      <div className="space-y-4">
        {mics.length === 0 ? (
          <button className="btn-primary" onClick={detect} disabled={state === 'loading'}>
            {state === 'loading' ? <Spinner /> : <IconMic size={15} />} 请求权限并检测设备
          </button>
        ) : (
          <Field label="输入设备">
            <select
              className="input"
              value={settings?.microphone.deviceId ?? 'default'}
              onChange={(e) => {
                const dev = mics.find((m) => m.deviceId === e.target.value)
                void save({
                  microphone: {
                    deviceId: e.target.value,
                    deviceLabel: dev?.label ?? '',
                    inputGain: settings?.microphone.inputGain ?? 1
                  }
                })
              }}
            >
              {mics.map((m) => (
                <option key={m.deviceId} value={m.deviceId}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label="输入增益" hint="1.0 为原始音量；声音偏小时可以调到 1.5 - 2.0">
          <input
            className="input"
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={settings?.microphone.inputGain ?? 1}
            onChange={(e) => {
              const v = Number(e.target.value)
              void save({
                microphone: {
                  deviceId: settings?.microphone.deviceId ?? 'default',
                  deviceLabel: settings?.microphone.deviceLabel ?? '',
                  inputGain: v
                }
              })
            }}
          />
          <div className="mt-1 text-[11px] text-slate-500">当前增益：{(settings?.microphone.inputGain ?? 1).toFixed(1)}×</div>
        </Field>

        <div className="flex gap-2">
          <button className="btn-ghost" onClick={detect}>
            {state === 'loading' ? <Spinner size={13} /> : <IconRefresh size={14} />} 重新检测设备
          </button>
          <button className="btn-primary" onClick={test} disabled={state === 'testing'}>
            {state === 'testing' ? <Spinner size={13} /> : <IconMic size={14} />} 测试麦克风
          </button>
        </div>

        {message && (
          <div
            className={cx(
              'flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[12px] leading-relaxed',
              state === 'ok'
                ? 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-200'
                : state === 'error'
                  ? 'border-red-500/30 bg-red-500/[0.07] text-red-200'
                  : 'border-white/10 bg-white/[0.03] text-slate-300'
            )}
          >
            {state === 'error' ? <IconAlert size={14} className="mt-0.5" /> : <IconMic size={14} className="mt-0.5" />}
            <span>{message}</span>
          </div>
        )}

        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11.5px] leading-relaxed text-slate-500">
          如果始终无法录音，请打开「系统设置 → 隐私与安全性 → 麦克风」，确认本应用已被勾选。
          录音格式为 WebM/Opus，保存在数据目录的 recordings/ 下，每题一个文件。
        </div>
      </div>
    </Card>
  )
}

/* ================================================================== */
/*                             考试                                    */
/* ================================================================== */

function ExamSettingsPanel({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const [prep, setPrep] = useState(0)
  const [resp, setResp] = useState(0)

  useEffect(() => {
    if (!settings) return
    setPrep(settings.exam.defaultPreparationTime)
    setResp(settings.exam.defaultResponseTime)
  }, [settings])

  return (
    <Card>
      <SectionHeader title="考试" subtitle="默认使用 TOEFL 官方时间；这里的设置会覆盖题库中的时间" />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="默认准备时间（秒）" hint="留 0 表示使用题库中每道题自带的准备时间">
          <input
            className="input"
            type="number"
            min={0}
            max={300}
            value={prep}
            onChange={(e) => setPrep(Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
            onBlur={() => void save({ exam: { defaultPreparationTime: prep } })}
          />
        </Field>
        <Field label="默认回答时间（秒）" hint="留 0 表示使用题库中每道题自带的回答时间">
          <input
            className="input"
            type="number"
            min={0}
            max={300}
            value={resp}
            onChange={(e) => setResp(Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
            onBlur={() => void save({ exam: { defaultResponseTime: resp } })}
          />
        </Field>
      </div>
      <div className="mt-4">
        <Toggle
          checked={settings?.exam.autoAdvance ?? true}
          onChange={(v) => void save({ exam: { autoAdvance: v } })}
          label="全自动推进（推荐，接近官方）"
          hint="开启后：题目音频自动播放 → 播完立即开始录音 → 时间到自动进入下一题。考生只能提前结束本题，不能延后，也不能重听。"
        />
      </div>
      <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11.5px] leading-relaxed text-slate-500">
        2026 新托福口语官方时间：Listen &amp; Repeat 每题 <strong className="text-slate-300">0 秒准备 / 8–12 秒作答</strong>
        （随句子长度递增）；Take an Interview 每题 <strong className="text-slate-300">0 秒准备 / 45 秒作答</strong>。
        整套 11 题约 15 分钟。考试过程中不允许暂停，时间结束会自动停止录音并进入下一题。
      </div>
    </Card>
  )
}


/* ================================================================== */
/*                          题目语音（TTS）                             */
/* ================================================================== */

function TtsSettingsPanel({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const save = useSettingsStore((s) => s.save)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const clearApiKey = useSettingsStore((s) => s.clearApiKey)

  const [keyInput, setKeyInput] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null)

  const provider = settings?.tts.provider ?? 'cloud'
  const voice = settings?.tts.voice ?? 'Serena'
  const model = settings?.tts.model ?? 'qwen3-tts-flash'
  const speed = settings?.tts.speed ?? 1

  useEffect(() => {
    if (!settings) return
    setBaseUrl(settings.tts.baseUrl)
  }, [settings])

  /** 试听：直接走真实的合成链路，听到的就是考试里会播的声音 */
  const preview = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const synth = await window.toefl.audio.prompt({ text: TTS_PREVIEW_TEXT })
      if (!synth.ok || !synth.audioPath) {
        setTestResult({ ok: false, message: synth.error ?? '合成失败' })
        return
      }
      const file = await window.toefl.audio.readPrompt(synth.audioPath)
      if (!file.ok || !file.data) {
        setTestResult({ ok: false, message: file.error ?? '读取音频失败' })
        return
      }
      const url = URL.createObjectURL(new Blob([file.data], { type: file.mimeType ?? 'audio/wav' }))
      const el = new Audio(url)
      el.preservesPitch = true
      el.playbackRate = settings?.tts.speed ?? 1.15
      el.onended = () => URL.revokeObjectURL(url)
      await el.play()
      setTestResult({
        ok: true,
        message: `正在播放示例句（${provider === 'cloud' ? `${model} · ${voice}` : '系统语音'} · ${(settings?.tts.speed ?? 1.15).toFixed(2)}×）`
      })
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader
          title="题目语音引擎"
          subtitle="Listen & Repeat 的句子要靠「听」，音色直接影响练习体验"
          right={
            provider === 'cloud' ? (
              <Badge tone="good">云端 TTS</Badge>
            ) : (
              <Badge tone="aqua">系统语音（离线）</Badge>
            )
          }
        />

        <div className="space-y-3">
          <div className="grid gap-2.5 md:grid-cols-2">
            {[
              {
                id: 'cloud',
                label: '云端 TTS（推荐）',
                desc: '神经网络音色，接近真人朗读；沿用 AI 模型的地址与密钥'
              },
              {
                id: 'system',
                label: '系统语音（离线）',
                desc: 'macOS 自带 say，不联网、零延迟，但机械感较强'
              }
            ].map((p) => (
              <button
                key={p.id}
                onClick={() => void save({ tts: { provider: p.id as 'system' | 'cloud' } })}
                className={cx(
                  'rounded-xl border px-4 py-3 text-left transition',
                  provider === p.id
                    ? 'border-brand-500/60 bg-brand-500/[0.08]'
                    : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                )}
              >
                <div className={cx('text-[13px] font-medium', provider === p.id ? 'text-brand-100' : 'text-slate-200')}>
                  {p.label}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{p.desc}</div>
              </button>
            ))}
          </div>

          {provider === 'cloud' && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="合成模型" hint="平台上的 TTS 模型名，可手填">
                  <input
                    className="input"
                    list="tts-models"
                    value={model}
                    onChange={(e) => void save({ tts: { model: e.target.value } })}
                  />
                  <datalist id="tts-models">
                    {TTS_MODELS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field label="音色" hint="不同音色差别很大，建议逐个试听">
                  <select className="input" value={voice} onChange={(e) => void save({ tts: { voice: e.target.value } })}>
                    {TTS_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label={`语速（${speed.toFixed(2)}× ≈ ${Math.round(135 * speed)} wpm）`}
                hint="官方听力材料约 150–165 wpm。模型本身约 135 wpm（speed 参数无效），所以这里在播放端提速，Chromium 会保持音高。改完点「试听示例句」对比。"
              >
                <input
                  className="w-full accent-brand-500"
                  type="range"
                  min={0.8}
                  max={1.5}
                  step={0.05}
                  value={speed}
                  onChange={(e) => void save({ tts: { speed: Number(e.target.value) } })}
                />
              </Field>

              <div className="grid gap-4 md:grid-cols-2">
                <Field label="服务地址（可选）" hint="留空则沿用「AI 评分」里配置的地址">
                  <input
                    className="input"
                    value={baseUrl}
                    placeholder={settings?.llm.baseUrl || 'https://.../v1'}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    onBlur={() => void save({ tts: { baseUrl: baseUrl.trim() } })}
                  />
                </Field>
                <Field
                  label="独立 API Key（可选）"
                  hint={
                    settings?.tts.apiKeySet
                      ? `已保存 ${settings.tts.apiKeyPreview}`
                      : '留空则沿用「AI 评分」里的密钥'
                  }
                >
                  <div className="flex gap-2">
                    <input
                      className="input flex-1"
                      type="password"
                      value={keyInput}
                      placeholder="不填则沿用 AI 模型的密钥"
                      onChange={(e) => setKeyInput(e.target.value)}
                    />
                    <button
                      className="btn-ghost px-4"
                      disabled={!keyInput.trim()}
                      onClick={async () => {
                        const ok = await setApiKey('tts', keyInput.trim())
                        setKeyInput('')
                        toast({ kind: ok ? 'success' : 'error', title: ok ? '语音密钥已保存' : '保存失败' } as never)
                      }}
                    >
                      保存
                    </button>
                    {settings?.tts.apiKeySet && (
                      <button
                        className="btn-ghost px-4"
                        onClick={async () => {
                          await clearApiKey('tts')
                          toast({ kind: 'info', title: '已清除独立语音密钥' } as never)
                        }}
                      >
                        清除
                      </button>
                    )}
                  </div>
                </Field>
              </div>
            </>
          )}

          {provider === 'system' && (
            <Field label="系统音色" hint="仅在 macOS 上可用；想更好听请下载「高级」语音或改用云端 TTS">
              <select
                className="input"
                value={settings?.tts.systemVoice ?? 'Samantha'}
                onChange={(e) => void save({ tts: { systemVoice: e.target.value } })}
              >
                {SYSTEM_TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button className="btn-primary px-5 py-2.5 text-sm" onClick={() => void preview()} disabled={testing}>
              {testing ? '正在合成…' : '试听示例句'}
            </button>
            {testResult && (
              <span className={testResult.ok ? 'text-[12px] text-emerald-300' : 'text-[12px] text-red-300'}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title="音频缓存" subtitle="同一句只合成一次，缓存命中后播放零延迟" />
        <div className="flex items-center gap-3">
          <button
            className="btn-ghost px-4 py-2.5 text-sm"
            onClick={async () => {
              const r = await window.toefl.audio.clearPromptCache()
              toast({ kind: r.ok ? 'success' : 'error', title: r.ok ? `已清理 ${r.removed} 个缓存音频` : '清理失败' } as never)
            }}
          >
            清空题目音频缓存
          </button>
          <span className="text-[11.5px] text-slate-500">
            换了音色或模型后，旧的缓存不会被复用，无需手动清理。
          </span>
        </div>
      </Card>
    </div>
  )
}

/* ================================================================== */
/*                             数据                                    */
/* ================================================================== */

function DataSettings({ toast }: { toast: (t: never) => string }): React.JSX.Element {
  const appInfo = useAppStore((s) => s.appInfo)
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)
  const loadHistory = useAppStore((s) => s.navigate)
  const [confirmClear, setConfirmClear] = useState(false)

  return (
    <div className="space-y-5">
      <Card>
        <SectionHeader title="数据存储位置" subtitle="数据库、录音、报告都保存在这里" />
        <div className="space-y-3">
          <div className="rounded-xl border border-white/[0.07] bg-ink-950/60 px-3.5 py-3">
            <div className="font-mono text-[11.5px] break-all text-slate-300">{appInfo?.dataDir ?? '—'}</div>
            <div className="mt-2 space-y-0.5 text-[10.5px] text-slate-500">
              <div>数据库：toefl-speaking.db</div>
              <div>录音：recordings/&lt;考试 ID&gt;/task1.webm + task1.json</div>
              <div>报告：reports/</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-ghost" onClick={() => void api.settings.openDataDir()}>
              在访达中打开
            </button>
            <button
              className="btn-ghost"
              onClick={async () => {
                const res = await api.settings.chooseDataDir()
                if (res.ok && res.path) {
                  toast({
                    kind: 'warn',
                    title: '数据目录已更改，重启后生效',
                    detail: `新目录：${res.path}`
                  } as never)
                } else if (res.error) {
                  toast({ kind: 'error', title: '设置失败', detail: res.error } as never)
                }
              }}
            >
              更改数据目录
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title="危险操作" subtitle="请谨慎操作" />
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-danger" onClick={() => setConfirmClear(true)}>
            <IconTrash size={14} /> 清空全部历史记录
          </button>
          <span className="text-[11px] text-slate-500">只删除考试记录与评分，录音文件仍保留在数据目录中。</span>
        </div>
      </Card>

      <Card>
        <SectionHeader title="运行环境" />
        <div className="grid grid-cols-2 gap-3 text-[11.5px] md:grid-cols-3">
          {[
            ['应用版本', appInfo?.version],
            ['Electron', appInfo?.electron],
            ['Chromium', appInfo?.chrome],
            ['Node.js', appInfo?.node],
            ['平台', `${appInfo?.platform} / ${appInfo?.arch}`],
            ['密钥加密', appInfo?.encryptionAvailable ? '已启用（系统钥匙串）' : '不可用']
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{k}</div>
              <div className="mt-0.5 truncate text-slate-300">{v ?? '—'}</div>
            </div>
          ))}
        </div>
        <button className="btn-ghost btn-sm mt-3" onClick={() => void loadAppInfo()}>
          <IconRefresh size={12} /> 刷新
        </button>
      </Card>

      <ConfirmDialog
        open={confirmClear}
        title="清空全部历史记录"
        message="所有考试记录与评分结果会被删除，此操作不可撤销。"
        confirmText="清空"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false)
          await api.exams.clearAll()
          await loadAppInfo()
          toast({ kind: 'info', title: '历史记录已清空' } as never)
          loadHistory({ name: 'dashboard' })
        }}
      />
    </div>
  )
}

/* ================================================================== */

function pickPreferredModel(ids: string[]): string {
  const prefer = [
    /^gpt-4o$/i,
    /^gpt-4o(?!-mini)/i,
    /^gpt-4\.1$/i,
    /^gpt-4/i,
    /deepseek-chat/i,
    /qwen-max/i,
    /qwen-plus/i,
    /glm-4-plus/i,
    /^claude/i,
    /^gemini/i
  ]
  for (const re of prefer) {
    const found = ids.find((id) => re.test(id))
    if (found) return found
  }
  // 排除明显的非对话模型
  const usable = ids.filter((id) => !/(embedding|whisper|tts|dall-e|moderation|rerank|image)/i.test(id))
  return (usable[0] ?? ids[0]) as string
}
