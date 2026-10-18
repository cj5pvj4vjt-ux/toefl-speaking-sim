import React from 'react'
import { useAppStore } from '../stores/useAppStore'
import { IconAlert, IconCheck, IconSpark } from './icons'
import { cx } from './ui'

export function Toasts(): React.JSX.Element {
  const toasts = useAppStore((s) => s.toasts)
  const dismiss = useAppStore((s) => s.dismiss)

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[380px] flex-col gap-2">
      {toasts.map((t) => {
        const tone =
          t.kind === 'success'
            ? 'border-emerald-500/30 bg-emerald-500/[0.09]'
            : t.kind === 'error'
              ? 'border-red-500/35 bg-red-500/[0.1]'
              : t.kind === 'warn'
                ? 'border-amber-500/30 bg-amber-500/[0.09]'
                : 'border-white/12 bg-ink-850/95'
        const icon =
          t.kind === 'success' ? (
            <IconCheck size={15} className="text-emerald-300" />
          ) : t.kind === 'error' ? (
            <IconAlert size={15} className="text-red-300" />
          ) : t.kind === 'warn' ? (
            <IconAlert size={15} className="text-amber-300" />
          ) : (
            <IconSpark size={15} className="text-brand-300" />
          )
        return (
          <div
            key={t.id}
            className={cx(
              'pointer-events-auto fade-in flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-card backdrop-blur',
              tone
            )}
          >
            <span className="mt-0.5 shrink-0">{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug text-slate-100">{t.title}</div>
              {t.detail && (
                <div className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-400">
                  {t.detail}
                </div>
              )}
            </div>
            <button
              className="shrink-0 rounded-md px-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"
              onClick={() => dismiss(t.id)}
            >
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
}
