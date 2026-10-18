import React, { useEffect, useMemo, useState } from 'react'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import type { Question, QuestionSet, TaskType } from '@shared/types'
import { QuestionEditor } from '../components/QuestionEditor'
import { IconBack, IconChevron, IconEdit, IconPlay, IconSearch, IconTrash } from '../components/icons'
import { Badge, Card, EmptyState, SectionHeader, Spinner, Tabs, cx } from '../components/ui'
import { useAppStore } from '../stores/useAppStore'
import { useLibraryStore } from '../stores/useLibraryStore'

export default function LibraryDetail({ setId }: { setId: string }): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const back = useAppStore((s) => s.back)
  const toast = useAppStore((s) => s.toast)
  const get = useLibraryStore((s) => s.get)
  const updateQuestion = useLibraryStore((s) => s.updateQuestion)

  const [set, setSet] = useState<QuestionSet | null>(null)
  const [loading, setLoading] = useState(true)
  type FilterValue = 'ALL' | TaskType | 'REVIEW'
  const [filter, setFilter] = useState<FilterValue>('ALL')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Question | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void get(setId).then((s) => {
      if (!alive) return
      setSet(s)
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [get, setId])

  const filtered = useMemo(() => {
    if (!set) return []
    return set.questions.filter((q) => {
      if (filter === 'REVIEW' && !q.needsReview) return false
      if (filter !== 'ALL' && filter !== 'REVIEW' && q.taskType !== filter) return false
      if (query.trim()) {
        const hay = `${q.questionText}\n${q.readingText ?? ''}\n${q.listeningText ?? ''}`.toLowerCase()
        if (!hay.includes(query.trim().toLowerCase())) return false
      }
      return true
    })
  }, [set, filter, query])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={22} />
      </div>
    )
  }

  if (!set) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="drag-region h-[46px]" />
        <div className="mx-auto max-w-[900px] px-8 py-10">
          <EmptyState title="题库不存在" description="它可能已经被删除。" action={<button className="btn-ghost" onClick={() => navigate({ name: 'library' })}>返回题库</button>} />
        </div>
      </div>
    )
  }

  const reviewCount = set.questions.filter((q) => q.needsReview).length

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1100px] px-8 pb-20">
        <button className="btn-ghost btn-sm mb-4" onClick={back}>
          <IconBack size={13} /> 返回
        </button>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-100">{set.title}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {set.questions.length} 道题 · 创建于 {new Date(set.createdAt).toLocaleString('zh-CN')}
            </p>
          </div>
          <button className="btn-primary" onClick={() => navigate({ name: 'setup' })}>
            <IconPlay size={14} /> 用此题库开始考试
          </button>
        </div>

        <Card className="mb-5">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              value={filter}
              onChange={(v) => setFilter(v as FilterValue)}
              items={[
                { value: 'ALL', label: `全部 ${set.questions.length}` },
                ...TASK_TYPES.map((t) => ({
                  value: t as FilterValue,
                  label: `${TASK_META[t].shortLabel} ${set.questions.filter((q) => q.taskType === t).length}`
                })),
                { value: 'REVIEW', label: `待确认 ${reviewCount}` }
              ]}
            />
            <div className="relative min-w-[200px] flex-1">
              <IconSearch size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input pl-9"
                placeholder="搜索题目内容…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
        </Card>

        {filtered.length === 0 ? (
          <EmptyState title="没有匹配的题目" description="试试切换筛选条件或清空搜索关键词。" />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((q, i) => (
              <Card key={q.id} className={cx('transition', q.needsReview && 'border-amber-500/25')} pad={false}>
                <div className="flex items-start gap-3 p-4">
                  <div className="w-9 shrink-0 pt-0.5 text-center">
                    <div className="text-[11px] font-semibold" style={{ color: TASK_META[q.taskType].accent }}>
                      T{TASK_META[q.taskType].index}
                    </div>
                    <div className="text-[10px] text-slate-600">#{i + 1}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="brand">{TASK_META[q.taskType].title}</Badge>
                      <Badge>
                        {q.preparationTime}s 准备 / {q.responseTime}s 回答
                      </Badge>
                      {q.sourcePage && <Badge>P{q.sourcePage}</Badge>}
                      {q.needsReview && <Badge tone="warn">待确认</Badge>}
                    </div>
                    <div className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-slate-300">
                      {q.questionText || <span className="text-red-300/80">（题目文本为空，请修正）</span>}
                    </div>
                    {(q.readingText || q.listeningText) && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-300">
                          查看阅读 / 听力材料
                        </summary>
                        <div className="mt-2 space-y-3">
                          {q.readingText && (
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-cyan-400/70">Reading</div>
                              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950/60 p-3 text-[11.5px] leading-relaxed text-slate-400">
                                {q.readingText}
                              </pre>
                            </div>
                          )}
                          {q.listeningText && (
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-emerald-400/70">Listening</div>
                              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-950/60 p-3 text-[11.5px] leading-relaxed text-slate-400">
                                {q.listeningText}
                              </pre>
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col gap-1.5">
                    <button className="btn-ghost btn-sm" onClick={() => setEditing(q)}>
                      <IconEdit size={13} /> 修正
                    </button>
                    <button
                      className="btn-ghost btn-sm text-red-300/80 hover:text-red-200"
                      onClick={async () => {
                        if (!set) return
                        const updated: QuestionSet = {
                          ...set,
                          questions: set.questions.filter((x) => x.id !== q.id)
                        }
                        const saved = await useLibraryStore.getState().save(updated)
                        if (saved) {
                          setSet(saved)
                          toast({ kind: 'info', title: '已删除该题目' })
                        }
                      }}
                    >
                      <IconTrash size={13} /> 删除
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <QuestionEditor
        open={!!editing}
        question={editing}
        onClose={() => setEditing(null)}
        onSave={async (q) => {
          setEditing(null)
          await updateQuestion(set.id, q)
          const fresh = await get(set.id)
          setSet(fresh)
          toast({ kind: 'success', title: '题目已更新' })
        }}
      />
    </div>
  )
}
