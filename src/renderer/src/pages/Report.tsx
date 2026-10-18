import React, { useCallback, useEffect, useState } from 'react'
import { AI_DIMENSIONS, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '@shared/constants'
import { estimateLevel } from '@shared/scoring/convert'
import type { ExamAttempt, QuestionAttempt } from '@shared/types'
import { AudioPlayer } from '../components/AudioPlayer'
import { DimensionBars, DimensionRadar, TaskBarChart, TaskRadarChart } from '../components/charts'
import {
  IconAlert,
  IconBack,
  IconChevron,
  IconDownload,
  IconRefresh,
  IconSpark
} from '../components/icons'
import { Badge, Card, ProgressBar, ScoreRing, SectionHeader, Spinner, Stat, cx } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAppStore } from '../stores/useAppStore'
import { useHistoryStore } from '../stores/useHistoryStore'

export default function Report({ examId }: { examId: string }): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const toast = useAppStore((s) => s.toast)
  const get = useHistoryStore((s) => s.get)

  const [attempt, setAttempt] = useState<ExamAttempt | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [reanalyzing, setReanalyzing] = useState(false)

  const refresh = useCallback(async () => {
    const a = await get(examId)
    setAttempt(a)
    setLoading(false)
    return a
  }, [examId, get])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await api.report.export(examId)
      if (res.ok && res.filePath) {
        toast({ kind: 'success', title: '报告已导出', detail: res.filePath })
        void api.file.reveal(res.filePath)
      } else {
        toast({ kind: 'error', title: '导出失败', detail: res.error })
      }
    } catch (e) {
      toast({ kind: 'error', title: '导出失败', detail: errorMessage(e) })
    } finally {
      setExporting(false)
    }
  }

  const reanalyze = async () => {
    setReanalyzing(true)
    try {
      const res = await api.exams.reanalyze({ examId, regenerateSummary: true })
      if (res.ok && res.attempt) {
        setAttempt(res.attempt)
        toast({ kind: 'success', title: '已重新分析完成' })
      } else {
        toast({ kind: 'error', title: '重新分析失败', detail: res.ok ? '主进程未返回考试内容' : res.error })
        await refresh()
      }
    } catch (e) {
      toast({ kind: 'error', title: '重新分析失败', detail: errorMessage(e) })
    } finally {
      setReanalyzing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  }

  if (!attempt) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="drag-region h-[46px]" />
        <div className="mx-auto max-w-[900px] px-8 py-10">
          <Card>
            <div className="text-sm text-slate-300">找不到该考试记录</div>
            <button className="btn-ghost mt-3" onClick={() => navigate({ name: 'history' })}>
              返回历史记录
            </button>
          </Card>
        </div>
      </div>
    )
  }

  const dims = {
    delivery: avg(attempt.taskScores.map((t) => t.delivery)),
    languageUse: avg(attempt.taskScores.map((t) => t.languageUse)),
    topicDevelopment: avg(attempt.taskScores.map((t) => t.topicDevelopment))
  }
  const scored = attempt.attempts.filter((a) => a.score)
  const isEmpty = scored.length === 0

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1100px] px-8 pb-20">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <button className="btn-ghost btn-sm mb-3" onClick={back}>
              <IconBack size={13} /> 返回
            </button>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">AI 评分报告</h1>
            <p className="mt-1 text-sm text-slate-400">
              {new Date(attempt.date).toLocaleString('zh-CN')} · {modeLabel(attempt.mode)} ·{' '}
              {attempt.questionSetTitle || '未命名题库'}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={reanalyze} disabled={reanalyzing}>
              {reanalyzing ? <Spinner /> : <IconRefresh size={14} />} 重新分析
            </button>
            <button className="btn-primary" onClick={exportPdf} disabled={exporting}>
              {exporting ? <Spinner /> : <IconDownload size={14} />} 导出 PDF 报告
            </button>
          </div>
        </div>

        {attempt.pendingErrors.length > 0 && (
          <Card className="mb-5 border-amber-500/25 bg-amber-500/[0.06]">
            <div className="flex items-start gap-2.5">
              <IconAlert size={16} className="mt-0.5 text-amber-300" />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-amber-200">
                  本次评分有 {attempt.pendingErrors.length} 处未成功
                </div>
                <ul className="mt-1.5 space-y-0.5 text-[11px] leading-relaxed text-amber-200/75">
                  {attempt.pendingErrors.slice(0, 5).map((e, i) => (
                    <li key={i}>· {e}</li>
                  ))}
                </ul>
                <p className="mt-2 text-[11px] text-amber-200/60">
                  录音与文字稿都已保存在本地，配置好 API 后点击「重新分析」即可补全评分。
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* 总分 */}
        <Card className="mb-5">
          <div className="grid gap-8 lg:grid-cols-[auto_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-3">
              <ScoreRing score={attempt.overallScore} size={168} />
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">水平定位</div>
                <div className="mt-0.5 text-[13px] font-medium text-brand-300">
                  {attempt.summary?.estimated_level || estimateLevel(attempt.overallScore)}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-5">
                <Stat label="原始平均分" value={fmt(attempt.rawTotal)} unit="/ 6" />
                <Stat label="已完成题目" value={scored.length} unit={`/ ${attempt.attempts.length}`} />
                <Stat label="考试用时" value={Math.round(attempt.durationMs / 60000)} unit="分钟" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {TASK_TYPES.map((t) => {
                  const entry = attempt.taskScores.find((s) => s.taskType === t)
                  const meta = TASK_META[t]
                  return (
                    <div key={t} className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold" style={{ color: meta.accent }}>
                          {meta.shortLabel}
                        </span>
                        <span className="text-[10px] text-slate-500">{meta.index}</span>
                      </div>
                      <div className="mt-1.5 flex items-baseline gap-1">
                        <span className="text-xl font-semibold tabular-nums text-slate-100">{fmt(entry?.rawScore)}</span>
                        <span className="text-[10px] text-slate-500">/ 6</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-500">单项分 {fmt(entry?.band)} / 6</div>
                      <div className="mt-2">
                        <ProgressBar value={entry?.rawScore ?? 0} max={MAX_RESPONSE_SCORE} color={meta.accent} height={5} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </Card>

        {isEmpty && (
          <Card className="mb-5 border-amber-500/25 bg-amber-500/[0.06]">
            <div className="text-[13px] text-amber-200">
              本次考试还没有任何评分结果。可能原因：未配置 AI 评分、网络中断，或回答没有产生文字稿。
              录音与文字稿都已保存在本地，你可以点击右上角「重新分析」补全评分。
            </div>
          </Card>
        )}

        {/* 维度 */}
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <SectionHeader title="评分维度" subtitle="ETS 官方三维度（0-6 分）" />
            <DimensionBars
              delivery={dims.delivery}
              languageUse={dims.languageUse}
              topicDevelopment={dims.topicDevelopment}
            />
            <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3 text-[11px] leading-relaxed text-slate-400">
              {AI_DIMENSIONS.map((d) => (
                <div key={d.key} className="flex gap-2">
                  <span className="w-32 shrink-0 text-slate-300">{d.label}</span>
                  <span>
                    {d.key === 'delivery'
                      ? '表达是否清晰、流利，语速与停顿是否影响理解'
                      : d.key === 'language_use'
                        ? '语法与词汇的准确性、丰富度与自动化程度'
                        : '内容是否切题、是否充分展开并具有逻辑连贯性'}
                  </span>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader title="维度雷达" subtitle="三维度得分分布" />
            <DimensionRadar
              delivery={dims.delivery}
              languageUse={dims.languageUse}
              topicDevelopment={dims.topicDevelopment}
              height={250}
            />
          </Card>
        </div>

        {/* Task 图表 */}
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <SectionHeader title="任务对比" subtitle="各任务原始分（0-6）" />
            <TaskBarChart taskScores={attempt.taskScores} />
          </Card>
          <Card>
            <SectionHeader title="Task 均衡度" subtitle="看哪一类任务拖后腿" />
            <TaskRadarChart taskScores={attempt.taskScores} />
          </Card>
        </div>

        {/* AI 总结 */}
        <Card className="mb-5">
          <SectionHeader
            title="AI 总结"
            subtitle={attempt.summary ? '基于本题组全部回答的整体诊断' : '本次没有生成 AI 总结'}
            right={<IconSpark size={16} className="text-brand-300" />}
          />
          {attempt.summary ? (
            <div className="space-y-5">
              <div className="rounded-xl border border-brand-500/20 bg-brand-500/[0.06] px-4 py-3.5 text-[13px] leading-[1.8] text-slate-200">
                {attempt.summary.overall_feedback}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <HighlightList title="优势 Strengths" items={attempt.summary.strengths} tone="good" />
                <HighlightList title="主要问题 Weaknesses" items={attempt.summary.weaknesses} tone="bad" />
                <HighlightList title="改进建议 Suggestions" items={attempt.summary.suggestions} tone="brand" />
              </div>
              {attempt.summary.recommended_practice?.length > 0 && (
                <div>
                  <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">
                    Recommended Practice Areas · 推荐练习方向
                  </div>
                  <div className="space-y-1.5">
                    {attempt.summary.recommended_practice.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5"
                      >
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-brand-500/20 text-[10px] font-semibold text-brand-300">
                          {i + 1}
                        </span>
                        <span className="text-[12.5px] leading-relaxed text-slate-300">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-[12px] text-slate-500">点击「重新分析」可以生成 AI 总结。</div>
          )}
        </Card>

        {/* 逐题 */}
        <div className="space-y-3">
          <div className="section-title px-1">逐题分析</div>
          {attempt.attempts.map((a, i) => (
            <QuestionAnalysis key={a.questionId + i} item={a} index={i} />
          ))}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function QuestionAnalysis({ item, index }: { item: QuestionAttempt; index: number }): React.JSX.Element {
  const [open, setOpen] = useState(index === 0)
  const meta = TASK_META[item.taskType]
  const score = item.score

  return (
    <Card pad={false} className="overflow-hidden">
      <button
        className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-white/[0.02]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="w-14 shrink-0">
          <span className="text-[11px] font-semibold" style={{ color: meta.accent }}>
            {meta.shortLabel}
          </span>
          <span className="block text-[10px] text-slate-600">#{index + 1}</span>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-slate-300">
            {item.questionSnapshot.questionText.slice(0, 110) || '（无题干文本）'}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.audioPath ? <Badge tone="good">录音 ✓</Badge> : <Badge tone="bad">无录音</Badge>}
            {item.transcript ? <Badge>文字稿 ✓</Badge> : <Badge tone="warn">无文字稿</Badge>}
            {score && <Badge tone="aqua">置信度 {Math.round((score.confidence ?? 0) * 100)}%</Badge>}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className={cx('text-lg font-semibold tabular-nums', score ? 'text-slate-100' : 'text-slate-600')}>
            {score ? fmt(score.score) : '--'}
          </span>
          <span className="text-[10px] text-slate-500"> / 6</span>
        </span>

        <IconChevron size={15} className={cx('shrink-0 text-slate-500 transition', open && 'rotate-90')} />
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <div className="space-y-4">
            {item.questionSnapshot.readingText && (
              <Collapsible title="Reading 阅读材料" text={item.questionSnapshot.readingText} />
            )}
            {item.questionSnapshot.listeningText && (
              <Collapsible title="Listening 听力文字稿" text={item.questionSnapshot.listeningText} />
            )}

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-wider text-slate-500">你的回答 · Transcript</span>
                <AudioPlayer audioPath={item.audioPath} durationMs={item.durationMs} compact />
              </div>
              {item.transcript ? (
                <div className="rounded-xl border border-white/[0.06] bg-ink-950/60 px-4 py-3 text-[13px] leading-[1.75] text-slate-300">
                  {item.transcript}
                </div>
              ) : (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 text-[12px] text-amber-200/80">
                  {item.sttError || '暂无文字稿。可以在「设置」中配置语音转文字后重新分析。'}
                </div>
              )}
            </div>

            {score?.revised_response?.trim() ? (
              <div>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wider text-emerald-300/80">
                    AI 修改后的回答 · Revised Version
                  </span>
                  <span className="text-[10px] text-slate-500">保留你的原意，只改进语言与结构</span>
                </div>
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3 text-[13px] leading-[1.75] text-slate-200">
                  {score.revised_response}
                </div>
              </div>
            ) : null}

            {score ? (
              <>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-slate-500">AI Analysis</span>
                    <span className="text-[11px] text-slate-400">
                      {meta.shortLabel} Score: <span className="font-semibold text-slate-200">{fmt(score.score)} / 6</span>
                    </span>
                  </div>
                  <DimensionBars
                    delivery={score.delivery}
                    languageUse={score.language_use}
                    topicDevelopment={score.topic_development}
                  />
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-[13px] leading-[1.8] text-slate-300">
                  {score.feedback}
                </div>

                <div className="grid gap-4 md:grid-cols-3">
                  <HighlightList title="Strengths" items={score.strengths} tone="good" />
                  <HighlightList title="Weaknesses" items={score.weaknesses} tone="bad" />
                  <HighlightList title="Suggestions" items={score.suggestions} tone="brand" />
                </div>
              </>
            ) : (
              item.scoreError && (
                <div className="rounded-xl border border-red-500/25 bg-red-500/[0.06] px-4 py-3 text-[12px] text-red-200/85">
                  本题未获得评分：{item.scoreError}
                </div>
              )
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

function Collapsible({ title, text }: { title: string; text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <button
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="text-[11px] uppercase tracking-wider text-slate-500">{title}</span>
        <span className="text-[11px] text-slate-500">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-white/[0.06] px-4 py-3">
          <div className="whitespace-pre-wrap text-[12.5px] leading-[1.75] text-slate-400">{text}</div>
        </div>
      )}
    </div>
  )
}

function HighlightList({
  title,
  items,
  tone
}: {
  title: string
  items: string[]
  tone: 'good' | 'bad' | 'brand'
}): React.JSX.Element {
  const colors: Record<string, { text: string; dot: string }> = {
    good: { text: 'text-emerald-300', dot: 'bg-emerald-400' },
    bad: { text: 'text-red-300', dot: 'bg-red-400' },
    brand: { text: 'text-brand-300', dot: 'bg-brand-400' }
  }
  const c = colors[tone]
  if (!items?.length) {
    return (
      <div>
        <div className={cx('mb-1.5 text-[11px] font-semibold uppercase tracking-wider', c.text)}>{title}</div>
        <div className="text-[12px] text-slate-600">—</div>
      </div>
    )
  }
  return (
    <div>
      <div className={cx('mb-1.5 text-[11px] font-semibold uppercase tracking-wider', c.text)}>{title}</div>
      <ul className="space-y-1.5">
        {items.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-relaxed text-slate-300">
            <span className={cx('mt-[7px] h-1 w-1 shrink-0 rounded-full', c.dot)} />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function avg(list: (number | null)[]): number | null {
  const v = list.filter((x): x is number => x != null && Number.isFinite(x))
  if (!v.length) return null
  return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function modeLabel(mode: ExamAttempt['mode']): string {
  if (mode === 'FULL') return '完整模拟考试'
  if (mode === 'CUSTOM') return '自定义考试'
  return `${TASK_META[mode as keyof typeof TASK_META]?.shortLabel ?? mode} 专项`
}
