import React, { useEffect } from 'react'
import { BAND_MAX, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '@shared/constants'
import { DimensionRadar, TrendChart } from '../components/charts'
import { IconChevron, IconPlay, IconUpload } from '../components/icons'
import { Badge, Card, EmptyState, ProgressBar, ScoreRing, SectionHeader, Stat, cx } from '../components/ui'
import { useAppStore } from '../stores/useAppStore'
import { useHistoryStore } from '../stores/useHistoryStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import { useSettingsStore, isConfigured } from '../stores/useSettingsStore'
import type { ExamAttempt } from '@shared/types'

export default function Dashboard(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const dashboard = useHistoryStore((s) => s.dashboard)
  const attempts = useHistoryStore((s) => s.attempts)
  const loadDashboard = useHistoryStore((s) => s.loadDashboard)
  const load = useHistoryStore((s) => s.load)
  const sets = useLibraryStore((s) => s.sets)
  const settings = useSettingsStore((s) => s.settings)

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  const latest = dashboard?.latest ?? null
  const recent = (dashboard?.recent ?? attempts.slice(0, 5)).slice(0, 5)
  const cfg = isConfigured(settings)
  const hasQuestions = sets.some((s) => s.questions.length > 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1200px] px-8 pb-16">
        {/* 顶部 */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">TOEFL Speaking 模拟考试</h1>
            <p className="mt-1 text-sm text-slate-400">
              高度还原真实考试流程 · 自动录音 · 语音转写 · AI 结构化评分
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => navigate({ name: 'import' })}>
              <IconUpload size={15} /> 导入真题 PDF
            </button>
            <button className="btn-primary" onClick={() => navigate({ name: 'setup' })}>
              <IconPlay size={14} /> 开始模拟考试
            </button>
          </div>
        </div>

        {/* 配置提示 */}
        {(!cfg.llmReady || !cfg.sttReady || !hasQuestions) && (
          <Card className="mb-5 border-amber-500/20 bg-amber-500/[0.05]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium text-amber-200">开始之前还需要完成：</span>
                <ul className="mt-1.5 space-y-0.5 text-xs text-amber-200/70">
                  {!hasQuestions && <li>· 导入一份 TOEFL Speaking 真题 PDF（拖拽到「导入」页面即可）</li>}
                  {!cfg.llmReady && <li>· 在「设置 → AI 评分」中填写 Base URL / API Key 并选择模型</li>}
                  {!cfg.sttReady && <li>· 在「设置 → 语音转文字」中配置 STT（或选择本地 Whisper）</li>}
                </ul>
              </div>
              <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'settings' })}>
                前往设置 <IconChevron size={13} />
              </button>
            </div>
          </Card>
        )}

        {!latest ? (
          <EmptyState
            icon={<IconPlay size={30} />}
            title="还没有考试记录"
            description="先导入一份真题 PDF 建立题库，然后点击「开始模拟考试」，系统会自动计时、录音、转写并评分。"
            action={
              <div className="mt-1 flex gap-2">
                <button className="btn-ghost" onClick={() => navigate({ name: 'import' })}>
                  导入真题 PDF
                </button>
                <button className="btn-primary" onClick={() => navigate({ name: 'setup' })}>
                  开始模拟考试
                </button>
              </div>
            }
          />
        ) : (
          <div className="space-y-5">
            {/* 最新成绩 */}
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <Card>
                <SectionHeader
                  title="最近一次模拟考试"
                  subtitle={new Date(latest.date).toLocaleString('zh-CN')}
                  right={
                    <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'report', examId: latest.id })}>
                      查看报告 <IconChevron size={13} />
                    </button>
                  }
                />
                <div className="flex items-center gap-7">
                  <ScoreRing score={latest.overallScore} max={BAND_MAX} />
                  <div className="min-w-0 flex-1 space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="brand">{modeLabel(latest.mode)}</Badge>
                      <Badge>{latest.questionSetTitle || '未命名题库'}</Badge>
                      {latest.rawTotal != null && <Badge tone="aqua">Raw {fmt(latest.rawTotal)} / 6</Badge>}
                    </div>
                    <div className="space-y-2">
                      {TASK_TYPES.map((t) => {
                        const entry = latest.taskScores.find((s) => s.taskType === t)
                        return (
                          <div key={t} className="flex items-center gap-3">
                            <span className="w-14 shrink-0 text-[11px] text-slate-400">{TASK_META[t].shortLabel}</span>
                            <ProgressBar value={entry?.rawScore ?? 0} max={MAX_RESPONSE_SCORE} color={TASK_META[t].accent} height={7} />
                            <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-slate-400">
                              {fmt(entry?.rawScore)} / {MAX_RESPONSE_SCORE}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <SectionHeader title="三维度表现" subtitle="ETS 官方评分维度（最近一次）" />
                <DimensionRadar
                  delivery={avgDim(latest, 'delivery')}
                  languageUse={avgDim(latest, 'languageUse')}
                  topicDevelopment={avgDim(latest, 'topicDevelopment')}
                  height={260}
                />
              </Card>
            </div>

            {/* 统计 */}
            <Card>
              <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
                <Stat
                  label="平均分"
                  value={dashboard?.averageScore ?? '--'}
                  unit={`/ ${BAND_MAX}`}
                  tone="brand"
                  hint={`共 ${dashboard?.totalExams ?? 0} 次考试`}
                />
                <Stat label="最高分" value={dashboard?.bestScore ?? '--'} unit={`/ ${BAND_MAX}`} tone="good" />
                <Stat label="连续练习" value={dashboard?.streakDays ?? 0} unit="天" tone="warn" />
                <Stat
                  label="题库规模"
                  value={sets.reduce((a, s) => a + s.questions.length, 0)}
                  unit="题"
                  hint={`${sets.length} 个题库`}
                />
              </div>
            </Card>

            {/* 趋势 */}
            <Card>
              <SectionHeader title="成绩趋势" subtitle="最近 20 次考试的估算分变化" />
              <TrendChart trend={dashboard?.trend ?? []} />
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              {/* 最近 5 次 */}
              <Card>
                <SectionHeader
                  title="最近 5 次成绩"
                  right={
                    <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'history' })}>
                      全部记录 <IconChevron size={13} />
                    </button>
                  }
                />
                <div className="space-y-2">
                  {recent.map((a) => (
                    <AttemptRow key={a.id} attempt={a} onClick={() => navigate({ name: 'report', examId: a.id })} />
                  ))}
                </div>
              </Card>

              {/* Task 表现 */}
              <Card>
                <SectionHeader title="任务表现" subtitle={`全部考试的平均分（0-${MAX_RESPONSE_SCORE} 制）`} />
                <div className="space-y-3.5">
                  {TASK_TYPES.map((t) => {
                    const v = dashboard?.taskAverages?.[t] ?? null
                    const meta = TASK_META[t]
                    return (
                      <div key={t}>
                        <div className="mb-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-slate-300">{meta.shortLabel}</span>
                            <span className="text-[10px] text-slate-500">{meta.title}</span>
                          </div>
                          <span className="text-[11px] tabular-nums text-slate-400">{fmt(v)} / 6</span>
                        </div>
                        <ProgressBar value={v ?? 0} max={MAX_RESPONSE_SCORE} color={meta.accent} height={7} />
                      </div>
                    )
                  })}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AttemptRow({ attempt, onClick }: { attempt: ExamAttempt; onClick: () => void }): React.JSX.Element {
  const d = new Date(attempt.date)
  const score = attempt.overallScore
  const tone =
    score == null
      ? 'text-slate-500'
      : score >= 4.5
        ? 'text-emerald-300'
        : score >= 3.5
          ? 'text-cyan-300'
          : 'text-amber-300'
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-left transition hover:border-white/15 hover:bg-white/[0.05]"
    >
      <div className="w-14 shrink-0">
        <div className="text-[11px] font-medium text-slate-300">
          {d.getMonth() + 1}/{d.getDate()}
        </div>
        <div className="text-[10px] text-slate-500">
          {String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-slate-300">{modeLabel(attempt.mode)}</div>
        <div className="truncate text-[10px] text-slate-500">{attempt.questionSetTitle || '—'}</div>
      </div>
      <div className={cx('shrink-0 text-right tabular-nums', tone)}>
        <span className="text-lg font-semibold">{score == null ? '--' : fmt(score)}</span>
        <span className="text-[10px] text-slate-500"> / {BAND_MAX}</span>
      </div>
      <IconChevron size={14} className="shrink-0 text-slate-600" />
    </button>
  )
}

function modeLabel(mode: ExamAttempt['mode']): string {
  if (mode === 'FULL') return '完整模拟考试'
  if (mode === 'CUSTOM') return '自定义考试'
  return `${TASK_META[mode as keyof typeof TASK_META]?.shortLabel ?? mode} 专项`
}

function avgDim(
  attempt: ExamAttempt,
  key: 'delivery' | 'languageUse' | 'topicDevelopment'
): number | null {
  const nums = attempt.taskScores.map((t) => t[key]).filter((n): n is number => n != null)
  if (!nums.length) return null
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}
