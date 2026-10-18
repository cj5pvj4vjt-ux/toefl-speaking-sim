import React, { useEffect, useState } from 'react'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import type { Question, TaskType } from '@shared/types'
import { Badge, Field, Modal, cx } from './ui'

export function QuestionEditor({
  open,
  question,
  onClose,
  onSave
}: {
  open: boolean
  question: Question | null
  onClose: () => void
  onSave: (q: Question) => void
}): React.JSX.Element | null {
  const [draft, setDraft] = useState<Question | null>(question)

  useEffect(() => {
    setDraft(question)
  }, [question])

  if (!open || !draft) return null

  const meta = TASK_META[draft.taskType]
  const patch = (p: Partial<Question>) => setDraft({ ...draft, ...p })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="修正题目"
      width={760}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" onClick={() => onSave({ ...draft, needsReview: false })}>
            保存并标记为已确认
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="label">Task 类型</label>
          <div className="grid grid-cols-4 gap-2">
            {TASK_TYPES.map((t) => {
              const m = TASK_META[t]
              const active = draft.taskType === t
              return (
                <button
                  key={t}
                  onClick={() =>
                    patch({
                      taskType: t as TaskType,
                      preparationTime: draft.preparationTime || m.prepTime,
                      responseTime: draft.responseTime || m.responseTime
                    })
                  }
                  className={cx(
                    'rounded-xl border px-3 py-2 text-left transition',
                    active ? 'border-brand-500/60 bg-brand-500/12' : 'border-white/10 bg-white/[0.03] hover:border-white/20'
                  )}
                >
                  <div className={cx('text-xs font-semibold', active ? 'text-brand-200' : 'text-slate-300')}>
                    {m.shortLabel}
                  </div>
                  <div className="mt-0.5 truncate text-[10px] text-slate-500">{m.title.split('—')[0]}</div>
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="准备时间（秒）">
            <input
              className="input"
              type="number"
              min={0}
              max={300}
              value={draft.preparationTime}
              onChange={(e) => patch({ preparationTime: clampNum(e.target.value, 0, 300) })}
            />
          </Field>
          <Field label="回答时间（秒）">
            <input
              className="input"
              type="number"
              min={5}
              max={300}
              value={draft.responseTime}
              onChange={(e) => patch({ responseTime: clampNum(e.target.value, 5, 300) })}
            />
          </Field>
          <Field label="来源页码">
            <input
              className="input"
              type="number"
              value={draft.sourcePage ?? ''}
              onChange={(e) => patch({ sourcePage: e.target.value ? Number(e.target.value) : null })}
            />
          </Field>
        </div>

        <Field label="题目 / 指令（Question Prompt）" hint="考试中会显示在屏幕中央">
          <textarea
            className="input h-24 resize-y font-mono text-[12px] leading-relaxed"
            value={draft.questionText}
            onChange={(e) => patch({ questionText: e.target.value })}
          />
        </Field>

        {meta.hasReading && (
          <Field label="阅读材料（Reading）" hint="Task 2/3 需要">
            <textarea
              className="input h-36 resize-y font-mono text-[12px] leading-relaxed"
              value={draft.readingText ?? ''}
              onChange={(e) => patch({ readingText: e.target.value || null })}
            />
          </Field>
        )}

        {meta.hasListening && (
          <Field
            label="听力材料文字稿（Listening Transcript）"
            hint="如果真题只提供音频而 PDF 中没有文字稿，可以留空；考试时仍会提示听力内容已播放。"
          >
            <textarea
              className="input h-36 resize-y font-mono text-[12px] leading-relaxed"
              value={draft.listeningText ?? ''}
              onChange={(e) => patch({ listeningText: e.target.value || null })}
            />
          </Field>
        )}

        <Field label="标签（逗号分隔）">
          <input
            className="input"
            value={draft.tags.join(', ')}
            onChange={(e) =>
              patch({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
            }
          />
        </Field>

        {draft.rawText && (
          <details className="rounded-xl border border-white/10 bg-ink-950/60 p-3">
            <summary className="cursor-pointer text-xs text-slate-400">查看 PDF 原文（用于核对）</summary>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-slate-500">
              {draft.rawText}
            </pre>
          </details>
        )}

        <div className="flex flex-wrap gap-1.5">
          {draft.parseWarnings.map((w, i) => (
            <Badge key={i} tone="warn">
              {w}
            </Badge>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function clampNum(v: string, min: number, max: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, n))
}
