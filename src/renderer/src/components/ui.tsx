import React from 'react'
import { BAND_MAX } from '@shared/constants'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

export function Card({
  children,
  className,
  pad = true
}: {
  children: React.ReactNode
  className?: string
  pad?: boolean
}): React.JSX.Element {
  return <div className={cx('card', pad && 'card-pad', className)}>{children}</div>
}

export function SectionHeader({
  title,
  subtitle,
  right
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Spinner({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-white/25 border-t-white/90"
      style={{ width: size, height: size }}
    />
  )
}

export function Badge({
  children,
  tone = 'default',
  className
}: {
  children: React.ReactNode
  tone?: 'default' | 'brand' | 'good' | 'warn' | 'bad' | 'aqua'
  className?: string
}): React.JSX.Element {
  const tones: Record<string, string> = {
    default: 'border-white/12 bg-white/[0.05] text-slate-300',
    brand: 'border-brand-500/35 bg-brand-500/12 text-brand-300',
    good: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-300',
    warn: 'border-amber-500/35 bg-amber-500/12 text-amber-300',
    bad: 'border-red-500/35 bg-red-500/12 text-red-300',
    aqua: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-300'
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium',
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  )
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'default'
}: {
  label: string
  value: React.ReactNode
  unit?: string
  hint?: string
  tone?: 'default' | 'brand' | 'good' | 'warn'
}): React.JSX.Element {
  const colors: Record<string, string> = {
    default: 'text-slate-100',
    brand: 'text-brand-300',
    good: 'text-emerald-300',
    warn: 'text-amber-300'
  }
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cx('mt-1 flex items-baseline gap-1', colors[tone])}>
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
    </div>
  )
}

export function ProgressBar({
  value,
  max = 1,
  color = '#6366F1',
  height = 8,
  className
}: {
  value: number | null | undefined
  max?: number
  color?: string
  height?: number
  className?: string
}): React.JSX.Element {
  const ratio = value == null ? 0 : Math.max(0, Math.min(1, value / max))
  return (
    <div className={cx('w-full overflow-hidden rounded-full bg-white/[0.06]', className)} style={{ height }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${ratio * 100}%`, background: color }}
      />
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-8 py-14 text-center">
      {icon && <div className="text-3xl opacity-60">{icon}</div>}
      <div>
        <div className="text-sm font-medium text-slate-200">{title}</div>
        {description && <div className="mt-1 max-w-md text-xs text-slate-400">{description}</div>}
      </div>
      {action}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  width?: number
}): React.JSX.Element | null {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm">
      <div className="card fade-in w-full max-w-full overflow-hidden" style={{ width }}>
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button className="no-drag rounded-lg px-2 text-slate-400 hover:bg-white/5 hover:text-slate-200" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4 text-sm text-slate-300">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确认',
  danger = false,
  onConfirm,
  onCancel
}: {
  open: boolean
  title: string
  message: string
  confirmText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width={440}
      footer={
        <>
          <button className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmText}
          </button>
        </>
      }
    >
      <p className="leading-relaxed text-slate-300">{message}</p>
    </Modal>
  )
}

export function Tabs<T extends string>({
  value,
  onChange,
  items
}: {
  value: T
  onChange: (v: T) => void
  items: { value: T; label: string }[]
}): React.JSX.Element {
  return (
    <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'rounded-[10px] px-3.5 py-1.5 text-xs font-medium transition',
            value === it.value ? 'bg-brand-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition disabled:opacity-50',
        checked ? 'border-brand-500/50 bg-brand-500/[0.07]' : 'border-white/[0.09] bg-white/[0.02] hover:border-white/20'
      )}
    >
      <span
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition',
          checked ? 'bg-brand-500' : 'bg-white/15'
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-slate-100">{label}</span>
        {hint && <span className="mt-1 block text-[11.5px] leading-relaxed text-slate-400">{hint}</span>}
      </span>
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  className
}: {
  label: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">{hint}</p>}
    </div>
  )
}

export function ScoreRing({
  score,
  /* 2026 新版托福单项满分是 6（BAND_MAX），这里不能再用旧的分制做默认值，
     否则调用方省略 max 时，报告与看板的分母就是错的。 */
  max = BAND_MAX,
  size = 150,
  label = 'Estimated Score'
}: {
  score: number | null
  max?: number
  size?: number
  label?: string
}): React.JSX.Element {
  const r = size / 2 - 10
  const c = 2 * Math.PI * r
  const ratio = score == null ? 0 : Math.max(0, Math.min(1, score / max))
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={9} />
        <defs>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#818CF8" />
            <stop offset="100%" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ringGrad)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <div className="flex items-baseline gap-1">
          <span className="text-4xl font-semibold tabular-nums text-slate-100">
            {score == null ? '--' : Number.isInteger(score) ? score : score.toFixed(1)}
          </span>
          <span className="text-sm text-slate-500">/ {max}</span>
        </div>
        <div className="mt-0.5 text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      </div>
    </div>
  )
}
