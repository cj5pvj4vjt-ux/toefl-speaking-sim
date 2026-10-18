import React, { useEffect, useMemo, useState } from 'react'
import { BAND_MAX, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '@shared/constants'
import type { ExamAttempt } from '@shared/types'
import { AudioPlayer } from '../components/AudioPlayer'
import { HistoryBarChart, TrendChart } from '../components/charts'
import { IconAlert, IconDownload, IconHistory, IconRefresh, IconTrash } from '../components/icons'
import { Badge, Card, ConfirmDialog, EmptyState, SectionHeader, Spinner, cx } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAppStore } from '../stores/useAppStore'
import { useHistoryStore } from '../stores/useHistoryStore'

export default function HistoryPage(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const toast = useAppStore((s) => s.toast)
  const attempts = useHistoryStore((s) => s.attempts)
  const dashboard = useHistoryStore((s) => s.dashboard)
  const loading = useHistoryStore((s) => s.loading)
  const load = useHistoryStore((s) => s.load)
  const loadDashboard = useHistoryStore((s) => s.loadDashboard)
  const remove = useHistoryStore((s) => s.remove)
  const clearAll = useHistoryStore((s) => s.clearAll)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ExamAttempt | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    void load()
    void loadDashboard()
  }, [load, loadDashboard])

  const stats = useMemo(() => {
    const scored = attempts.filter((a) => a.overallScore != null)
    return {
      count: attempts.length,
      average: scored.length ? Math.round((scored.reduce((a, x) => a + (x.overallScore ?? 0), 0) / scored.length) * 10) / 10 : null,
      best: scored.length ? Math.max(...scored.map((a) => a.overallScore ?? 0)) : null
    }
  }, [attempts])

  const doExport = async (id: string) => {
    setBusy(`export:${id}`)
    try {
      const res = await api.report.export(id)
      if (res.ok && res.filePath) {
        toast({ kind: 'success', title: '报告已导出', detail: res.filePath })
        void api.file.reveal(res.filePath)
      } else {
        toast({ kind: 'error', title: '导出失败', detail: res.error })
      }
    } finally {
      setBusy(null)
    }
  }

  const doReanalyze = async (id: string) => {
    setBusy(`re:${id}`)
    try {
      const res = await api.exams.reanalyze({ examId: id, regenerateSummary: true })
      if (res.ok) {
        toast({ kind: 'success', title: '重新分析完成' })
        await load()
        await loadDashboard()
      } else {
        toast({ kind: 'error', title: '重新分析失败', detail: res.error })
      }
    } catch (e) {
      toast({ kind: 'error', title: '重新分析失败', detail: errorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1100px] px-8 pb-20">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">历史记录</h1>
            <p className="mt-1 text-sm text-slate-400">
              共 {stats.count} 次考试 · 平均 {stats.average ?? '--'} / {BAND_MAX} · 最高 {stats.best ?? '--'} / {BAND_MAX}
            </p>
          </div>
          {attempts.length > 0 && (
            <button className="btn-ghost text-red-300/80 hover:text-red-200" onClick={() => setConfirmClear(true)}>
              <IconTrash size={14} /> 清空全部记录
            </button>
          )}
        </div>

        {attempts.length === 0 && !loading ? (
          <EmptyState
            icon={<IconHistory size={28} />}
            title="还没有考试记录"
            description="完成一次模拟考试后，成绩、录音、文字稿和 AI 评分都会保存在这里。"
            action={
              <button className="btn-primary mt-1" onClick={() => navigate({ name: 'setup' })}>
                开始模拟考试
              </button>
            }
          />
        ) : (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <SectionHeader title="成绩趋势" />
                <TrendChart trend={dashboard?.trend ?? []} height={200} />
              </Card>
              <Card>
                <SectionHeader title="最近成绩" subtitle="按考试时间排序" />
                <HistoryBarChart attempts={attempts.slice(0, 10)} height={200} />
              </Card>
            </div>

            <div className="space-y-3">
              {attempts.map((a) => {
                const open = expanded === a.id
                const scoredCount = a.attempts.filter((x) => x.score).length
                return (
                  <Card key={a.id} pad={false} className="overflow-hidden">
                    <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <div className="w-16 shrink-0">
                        <div className="text-[12px] font-medium text-slate-300">
                          {new Date(a.date).getMonth() + 1}/{new Date(a.date).getDate()}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {String(new Date(a.date).getHours()).padStart(2, '0')}:
                          {String(new Date(a.date).getMinutes()).padStart(2, '0')}
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium text-slate-200">{modeLabel(a.mode)}</span>
                          <Badge>{a.questionSetTitle || '未命名题库'}</Badge>
                          {a.status === 'PARTIAL' && <Badge tone="warn">部分完成</Badge>}
                          {a.status === 'DRAFT' && <Badge tone="bad">未评分</Badge>}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-slate-500">
                          <span>
                            评分 {scoredCount}/{a.attempts.length} 题
                          </span>
                          <span>原始平均分 {fmt(a.rawTotal)} / 6</span>
                          <span>用时 {Math.round(a.durationMs / 60000)} 分钟</span>
                        </div>
                      </div>

                      <div className="shrink-0 text-right">
                        <div
                          className={cx(
                            'text-2xl font-semibold tabular-nums',
                            a.overallScore == null
                              ? 'text-slate-600'
                              : a.overallScore >= 4.5
                                ? 'text-emerald-300'
                                : a.overallScore >= 3.5
                                  ? 'text-cyan-300'
                                  : 'text-amber-300'
                          )}
                        >
                          {a.overallScore == null ? '--' : fmt(a.overallScore)}
                        </div>
                        <div className="text-[10px] text-slate-500">/ {BAND_MAX}</div>
                      </div>

                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        <button className="btn-ghost btn-sm" onClick={() => navigate({ name: 'report', examId: a.id })}>
                          报告
                        </button>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => doReanalyze(a.id)}
                          disabled={busy === `re:${a.id}`}
                        >
                          {busy === `re:${a.id}` ? <Spinner size={12} /> : <IconRefresh size={12} />}
                        </button>
                        <button
                          className="btn-ghost btn-sm"
                          onClick={() => doExport(a.id)}
                          disabled={busy === `export:${a.id}`}
                        >
                          {busy === `export:${a.id}` ? <Spinner size={12} /> : <IconDownload size={12} />}
                        </button>
                        <button
                          className="btn-ghost btn-sm text-red-300/80 hover:text-red-200"
                          onClick={() => setPendingDelete(a)}
                        >
                          <IconTrash size={12} />
                        </button>
                        <button className="btn-ghost btn-sm" onClick={() => setExpanded(open ? null : a.id)}>
                          {open ? '收起' : '详情'}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div className="space-y-3 border-t border-white/[0.06] px-5 py-4">
                        {a.pendingErrors.length > 0 && (
                          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3.5 py-2.5">
                            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-200">
                              <IconAlert size={13} /> {a.pendingErrors.length} 处未成功
                            </div>
                            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-200/70">
                              {a.pendingErrors.slice(0, 3).map((e, i) => (
                                <li key={i}>· {e}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {a.attempts.map((item, i) => (
                          <div
                            key={item.questionId + i}
                            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[11px] font-semibold" style={{ color: TASK_META[item.taskType].accent }}>
                                {TASK_META[item.taskType].shortLabel}
                              </span>
                              <span className="text-[11px] text-slate-500">#{i + 1}</span>
                              <div className="flex-1" />
                              <span className="text-[11px] tabular-nums text-slate-400">
                                {item.score ? `${fmt(item.score.score)} / ${MAX_RESPONSE_SCORE}` : '未评分'}
                              </span>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <AudioPlayer audioPath={item.audioPath} durationMs={item.durationMs} compact />
                              {TASK_TYPES.length > 0 && null}
                            </div>
                            {item.transcript && (
                              <div className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-slate-400">
                                {item.transcript}
                              </div>
                            )}
                            {!item.transcript && item.sttError && (
                              <div className="mt-2 text-[11px] text-amber-300/70">{item.sttError}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空全部历史记录"
        message="所有考试记录、评分结果都会被删除。录音文件仍会保留在数据目录中。此操作不可撤销。"
        confirmText="清空记录"
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={async () => {
          setConfirmClear(false)
          await clearAll()
          toast({ kind: 'info', title: '历史记录已清空' })
        }}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除这条考试记录"
        message={`确定要删除 ${pendingDelete ? new Date(pendingDelete.date).toLocaleString('zh-CN') : ''} 的考试记录吗？对应的录音文件也会一并删除。`}
        confirmText="删除"
        danger
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) {
            await remove(target.id)
            toast({ kind: 'info', title: '已删除该记录' })
          }
        }}
      />
    </div>
  )
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
