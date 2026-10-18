import React, { useEffect, useState } from 'react'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import { IconChevron, IconLibrary, IconPlay, IconTrash, IconUpload } from '../components/icons'
import { Badge, Card, ConfirmDialog, EmptyState, SectionHeader, cx } from '../components/ui'
import { useAppStore } from '../stores/useAppStore'
import { useLibraryStore } from '../stores/useLibraryStore'
import type { QuestionSet } from '@shared/types'

export default function LibraryPage(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const sets = useLibraryStore((s) => s.sets)
  const loading = useLibraryStore((s) => s.loading)
  const load = useLibraryStore((s) => s.load)
  const remove = useLibraryStore((s) => s.remove)
  const toast = useAppStore((s) => s.toast)
  const [pending, setPending] = useState<QuestionSet | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1100px] px-8 pb-20">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">题库</h1>
            <p className="mt-1 text-sm text-slate-400">
              {sets.length} 个题库 · 共 {sets.reduce((a, s) => a + s.questions.length, 0)} 道题
            </p>
          </div>
          <button className="btn-primary" onClick={() => navigate({ name: 'import' })}>
            <IconUpload size={15} /> 导入真题 PDF
          </button>
        </div>

        {sets.length === 0 && !loading ? (
          <EmptyState
            icon={<IconLibrary size={28} />}
            title="还没有题库"
            description="导入一份 TOEFL Speaking 真题 PDF，系统会自动识别 Task 类型与题目结构。"
            action={
              <button className="btn-primary mt-1" onClick={() => navigate({ name: 'import' })}>
                导入真题 PDF
              </button>
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sets.map((s) => (
              <SetCard
                key={s.id}
                set={s}
                onOpen={() => navigate({ name: 'library-detail', setId: s.id })}
                onStart={() => navigate({ name: 'setup' })}
                onDelete={() => setPending(s)}
              />
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!pending}
        title="删除题库"
        message={`确定要删除「${pending?.title ?? ''}」吗？该题库中的 ${pending?.questions.length ?? 0} 道题将被移除（已有的考试记录不受影响）。`}
        confirmText="删除题库"
        danger
        onCancel={() => setPending(null)}
        onConfirm={async () => {
          const target = pending
          setPending(null)
          if (target) {
            await remove(target.id)
            toast({ kind: 'info', title: `已删除题库「${target.title}」` })
          }
        }}
      />
    </div>
  )
}

function SetCard({
  set,
  onOpen,
  onStart,
  onDelete
}: {
  set: QuestionSet
  onOpen: () => void
  onStart: () => void
  onDelete: () => void
}): React.JSX.Element {
  const counts = TASK_TYPES.map((t) => ({ t, n: set.questions.filter((q) => q.taskType === t).length }))
  const needsReview = set.questions.filter((q) => q.needsReview).length
  const canFull = counts.every((c) => c.n > 0)

  return (
    <Card className="flex flex-col transition hover:border-white/15">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-100">{set.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">
            {new Date(set.createdAt).toLocaleString('zh-CN')}
            {set.sourcePdf ? ` · ${basename(set.sourcePdf)}` : ''}
          </div>
        </div>
        <button
          className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-300"
          onClick={onDelete}
          title="删除题库"
        >
          <IconTrash size={15} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-2">
        {counts.map(({ t, n }) => (
          <div key={t} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-center">
            <div className="text-[10px] text-slate-500">{TASK_META[t].shortLabel}</div>
            <div className={cx('text-sm font-semibold tabular-nums', n > 0 ? 'text-slate-200' : 'text-slate-600')}>{n}</div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 text-[11px]">
        <span className="text-slate-500">共 {set.questions.length} 题</span>
        {needsReview > 0 && <Badge tone="warn">{needsReview} 题待确认</Badge>}
        {set.importStats?.usedOcr && <Badge tone="aqua">OCR</Badge>}
        {!canFull && <Badge>无法组成完整考试</Badge>}
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn-ghost btn-sm flex-1" onClick={onOpen}>
          查看题目 <IconChevron size={12} />
        </button>
        <button className="btn-primary btn-sm flex-1" onClick={onStart} disabled={set.questions.length === 0}>
          <IconPlay size={12} /> 开始考试
        </button>
      </div>
    </Card>
  )
}

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}
