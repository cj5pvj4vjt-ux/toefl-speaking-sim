import React, { useEffect, useMemo, useState } from 'react'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import { pickExamQuestions } from '@shared/pdf/parseQuestions'
import type { ExamMode, Question, TaskType } from '@shared/types'
import { IconAlert, IconCheck, IconMic, IconPlay } from '../components/icons'
import { Badge, Card, EmptyState, Field, SectionHeader, Spinner, cx } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { listMicrophonesWithPermission, testMicrophone, type MicDevice } from '../lib/recorder'
import { useAppStore } from '../stores/useAppStore'
import { useExamStore } from '../stores/useExamStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { isConfigured, useSettingsStore } from '../stores/useSettingsStore'

const MODES: { value: ExamMode; label: string; desc: string }[] = [
  { value: 'FULL', label: '完整模拟考试', desc: '完整 2026 新版托福口语：7 题听后重复 + 4 题虚拟面试' },
  { value: 'LISTEN_REPEAT', label: 'Listen & Repeat 专项', desc: '跟读题：听一句，原样复述一遍' },
  { value: 'INTERVIEW', label: 'Virtual Interview 专项', desc: '面试题：听提问，限时作答' },
  { value: 'CUSTOM', label: '自定义考试', desc: '自由选择要考的任务组合' }
]

export default function ExamSetup(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const toast = useAppStore((s) => s.toast)
  const sets = useLibraryStore((s) => s.sets)
  const loadSets = useLibraryStore((s) => s.load)
  const settings = useSettingsStore((s) => s.settings)
  const saveSettings = useSettingsStore((s) => s.save)
  const begin = useExamStore((s) => s.begin)

  const [setId, setSetId] = useState<string>('')
  const [mode, setMode] = useState<ExamMode>('FULL')
  const [customTasks, setCustomTasks] = useState<TaskType[]>(['LISTEN_REPEAT', 'INTERVIEW'])
  const [advanced, setAdvanced] = useState(false)
  const [prepOverride, setPrepOverride] = useState(0)
  const [respOverride, setRespOverride] = useState(0)
  const [mics, setMics] = useState<MicDevice[]>([])
  const [micState, setMicState] = useState<'unknown' | 'ok' | 'error' | 'testing'>('unknown')
  const [micMessage, setMicMessage] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (sets.length === 0) void loadSets()
  }, [sets.length, loadSets])

  useEffect(() => {
    if (!setId && sets.length > 0) setSetId(sets[0].id)
  }, [sets, setId])

  const selectedSet = sets.find((s) => s.id === setId) ?? null
  const cfg = isConfigured(settings)

  const planned: Question[] = useMemo(() => {
    if (!selectedSet) return []
    try {
      return pickExamQuestions(selectedSet.questions, mode as never, customTasks)
    } catch {
      return []
    }
  }, [selectedSet, mode, customTasks])

  const checkMic = async () => {
    setMicState('testing')
    setMicMessage('正在请求麦克风权限…')
    try {
      const list = await listMicrophonesWithPermission()
      setMics(list)
      const preferred = settings?.microphone.deviceId && settings.microphone.deviceId !== 'default' ? settings.microphone.deviceId : list[0]?.deviceId
      if (!preferred) throw new Error('没有找到音频输入设备')
      setMicMessage('正在采样 2.5 秒，请说一句话…')
      const res = await testMicrophone(preferred)
      setMicState(res.ok ? 'ok' : 'error')
      setMicMessage(res.message)
    } catch (e) {
      setMicState('error')
      setMicMessage(errorMessage(e))
    }
  }

  const start = async () => {
    if (!selectedSet) {
      toast({ kind: 'warn', title: '请先选择题库' })
      return
    }
    setCreating(true)
    try {
      const res = await api.exams.create({
        questionSetId: selectedSet.id,
        mode,
        customTaskTypes: mode === 'CUSTOM' ? customTasks : undefined,
        preparationTime: prepOverride,
        responseTime: respOverride
      })
      if (!res.ok) {
        toast({ kind: 'error', title: '无法开始考试', detail: res.error })
        return
      }
      if (!res.attempt) {
        toast({ kind: 'error', title: '无法开始考试', detail: '主进程未返回考试内容' })
        return
      }
      begin(res.attempt)
      navigate({ name: 'exam' })
    } catch (e) {
      toast({ kind: 'error', title: '无法开始考试', detail: errorMessage(e) })
    } finally {
      setCreating(false)
    }
  }

  if (sets.length === 0) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="drag-region h-[46px]" />
        <div className="mx-auto max-w-[900px] px-8 py-8">
          <h1 className="mb-5 text-2xl font-semibold tracking-tight text-slate-100">开始模拟考试</h1>
          <EmptyState
            title="还没有题库"
            description="请先导入一份 TOEFL Speaking 真题 PDF，导入后即可开始模拟考试。"
            action={
              <button className="btn-primary mt-1" onClick={() => navigate({ name: 'import' })}>
                导入真题 PDF
              </button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1000px] px-8 pb-20">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-100">开始模拟考试</h1>
          <p className="mt-1 text-sm text-slate-400">考试开始后会自动计时、自动录音，全程无需手动操作。</p>
        </div>

        <div className="space-y-5">
          {/* 题库 */}
          <Card>
            <SectionHeader title="1 · 选择题库" subtitle={`共 ${sets.length} 个题库`} />
            <div className="grid gap-2.5 md:grid-cols-2">
              {sets.map((s) => {
                const active = s.id === setId
                const counts = TASK_TYPES.map((t) => s.questions.filter((q) => q.taskType === t).length)
                return (
                  <button
                    key={s.id}
                    onClick={() => setSetId(s.id)}
                    className={cx(
                      'rounded-xl border px-4 py-3 text-left transition',
                      active ? 'border-brand-500/60 bg-brand-500/[0.08]' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={cx('truncate text-[13px] font-medium', active ? 'text-brand-100' : 'text-slate-200')}>
                        {s.title}
                      </span>
                      {active && <IconCheck size={14} className="shrink-0 text-brand-300" />}
                    </div>
                    <div className="mt-1.5 flex gap-1">
                      {counts.map((n, i) => (
                        <span
                          key={i}
                          className={cx(
                            'rounded px-1.5 py-0.5 text-[10px] tabular-nums',
                            n > 0 ? 'bg-white/[0.07] text-slate-300' : 'bg-white/[0.03] text-slate-600'
                          )}
                        >
                          T{i + 1}:{n}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 模式 */}
          <Card>
            <SectionHeader title="2 · 选择考试模式" />
            <div className="grid gap-2.5 md:grid-cols-3">
              {MODES.map((m) => {
                const active = mode === m.value
                return (
                  <button
                    key={m.value}
                    onClick={() => setMode(m.value)}
                    className={cx(
                      'rounded-xl border px-4 py-3 text-left transition',
                      active ? 'border-brand-500/60 bg-brand-500/[0.08]' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/20'
                    )}
                  >
                    <div className={cx('text-[13px] font-medium', active ? 'text-brand-100' : 'text-slate-200')}>{m.label}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{m.desc}</div>
                  </button>
                )
              })}
            </div>

            {mode === 'CUSTOM' && (
              <div className="mt-4">
                <label className="label">选择要考的 Task</label>
                <div className="flex flex-wrap gap-2">
                  {TASK_TYPES.map((t) => {
                    const active = customTasks.includes(t)
                    return (
                      <button
                        key={t}
                        onClick={() =>
                          setCustomTasks((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t].sort()))
                        }
                        className={cx(
                          'rounded-xl border px-3.5 py-2 text-xs transition',
                          active ? 'border-brand-500/60 bg-brand-500/12 text-brand-100' : 'border-white/10 text-slate-400 hover:border-white/25'
                        )}
                      >
                        {TASK_META[t].shortLabel}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </Card>

          {/* 考前检查 */}
          <Card>
            <SectionHeader title="3 · 考前检查" />
            <div className="space-y-3">
              <CheckRow
                ok={!!selectedSet && planned.length > 0}
                title={planned.length > 0 ? `已生成 ${planned.length} 道题` : '无法生成试卷'}
                detail={
                  planned.length > 0
                    ? planned.map((q) => TASK_META[q.taskType].shortLabel).join(' → ')
                    : mode === 'FULL'
                      ? '该题库缺少部分 Task，无法组成完整考试，请改用专项模式或补充题目。'
                      : '该题库中没有对应 Task 的题目。'
                }
              />
              <CheckRow
                ok={cfg.llmReady}
                title={cfg.llmReady ? `AI 评分已就绪（${settings?.llm.model}）` : 'AI 评分未配置'}
                detail={cfg.llmReady ? settings?.llm.baseUrl ?? '' : '考试结束后无法评分，但仍会保存录音与文字稿，可稍后重新评分。'}
                action={
                  !cfg.llmReady ? (
                    <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'settings' })}>
                      去配置
                    </button>
                  ) : undefined
                }
              />
              <CheckRow
                ok={cfg.sttReady}
                title={cfg.sttReady ? '语音转文字已配置' : '语音转文字未配置'}
                detail={cfg.sttReady ? '' : '录音仍会完整保存，配置后可随时重新转写。'}
                action={
                  !cfg.sttReady ? (
                    <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'settings' })}>
                      去配置
                    </button>
                  ) : undefined
                }
              />
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <IconMic size={16} className={micState === 'ok' ? 'text-emerald-300' : 'text-slate-400'} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-slate-200">
                      {micState === 'ok' ? '麦克风正常' : micState === 'error' ? '麦克风异常' : '麦克风检查'}
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      {micMessage || (settings?.microphone.deviceLabel ? `当前设备：${settings.microphone.deviceLabel}` : '建议先试音，确认可以录到声音')}
                    </div>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={checkMic} disabled={micState === 'testing'}>
                    {micState === 'testing' ? <Spinner /> : null} 测试麦克风
                  </button>
                </div>
                {mics.length > 0 && (
                  <div className="mt-3">
                    <label className="label">输入设备</label>
                    <select
                      className="input"
                      value={settings?.microphone.deviceId ?? 'default'}
                      onChange={(e) => {
                        const dev = mics.find((m) => m.deviceId === e.target.value)
                        void saveSettings({
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
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* 高级 */}
          <Card>
            <button
              className="flex w-full items-center justify-between text-left"
              onClick={() => setAdvanced((v) => !v)}
            >
              <div>
                <div className="section-title">4 · 时间设置（可选）</div>
                <div className="mt-0.5 text-[11px] text-slate-500">
                  默认使用 TOEFL 官方时间，留 0 表示不覆盖
                </div>
              </div>
              <span className="text-xs text-slate-500">{advanced ? '收起' : '展开'}</span>
            </button>
            {advanced && (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="统一准备时间（秒）" hint="0 = 使用每道题在题库中的设定">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={300}
                    value={prepOverride}
                    onChange={(e) => setPrepOverride(Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
                  />
                </Field>
                <Field label="统一回答时间（秒）" hint="0 = 使用每道题在题库中的设定">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={300}
                    value={respOverride}
                    onChange={(e) => setRespOverride(Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
                  />
                </Field>
              </div>
            )}
          </Card>

          {/* 试卷预览 */}
          {planned.length > 0 && (
            <Card>
              <SectionHeader title="试卷预览" subtitle="考试开始后题目不可修改" />
              <div className="space-y-2">
                {planned.map((q, i) => (
                  <div key={q.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
                    <span className="text-[11px] tabular-nums text-slate-500">{i + 1}</span>
                    <Badge tone="brand">{TASK_META[q.taskType].shortLabel}</Badge>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-slate-400">
                      {q.questionText.slice(0, 90) || '（无题干）'}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {q.preparationTime}s / {q.responseTime}s
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* 开始 */}
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-brand-500/25 bg-brand-500/[0.06] px-5 py-4">
            <div className="text-[12px] leading-relaxed text-slate-300">
              点击开始后立即进入考试流程：准备倒计时 → 自动录音 → 自动停止 → 下一题。
              <br />
              <span className="text-slate-500">考试过程中不会出现任何可误触的按钮。</span>
            </div>
            <button className="btn-primary shrink-0 px-6 py-2.5" onClick={start} disabled={creating || planned.length === 0}>
              {creating ? <Spinner /> : <IconPlay size={15} />} 开始考试
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CheckRow({
  ok,
  title,
  detail,
  action
}: {
  ok: boolean
  title: string
  detail?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3',
        ok ? 'border-emerald-500/20 bg-emerald-500/[0.05]' : 'border-amber-500/25 bg-amber-500/[0.05]'
      )}
    >
      <span className={cx('shrink-0', ok ? 'text-emerald-300' : 'text-amber-300')}>
        {ok ? <IconCheck size={16} /> : <IconAlert size={16} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-slate-200">{title}</div>
        {detail && <div className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{detail}</div>}
      </div>
      {action}
    </div>
  )
}
