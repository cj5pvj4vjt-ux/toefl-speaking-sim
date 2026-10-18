import React from 'react'
import { useAppStore, type Route } from '../stores/useAppStore'
import {
  IconHistory,
  IconHome,
  IconLibrary,
  IconPlay,
  IconSettings,
  IconUpload
} from './icons'
import { cx } from './ui'
import appIcon from '../assets/icon.png'

interface NavItem {
  key: string
  label: string
  hint?: string
  icon: React.ReactNode
  route?: Route
  action?: () => void
}

export function Sidebar(): React.JSX.Element {
  const route = useAppStore((s) => s.route)
  const navigate = useAppStore((s) => s.navigate)
  const appInfo = useAppStore((s) => s.appInfo)

  const isActive = (r?: Route): boolean => {
    if (!r) return false
    if (r.name === route.name) return true
    if (r.name === 'library' && route.name === 'library-detail') return true
    return false
  }

  const items: NavItem[] = [
    { key: 'dashboard', label: '首页', hint: 'Dashboard', icon: <IconHome size={17} />, route: { name: 'dashboard' } },
    {
      key: 'start',
      label: '开始模拟考试',
      hint: 'Mock Exam',
      icon: <IconPlay size={17} />,
      action: () => navigate({ name: 'setup' })
    },
    {
      key: 'import',
      label: '导入真题 PDF',
      hint: 'Import',
      icon: <IconUpload size={17} />,
      route: { name: 'import' }
    },
    {
      key: 'library',
      label: '题库',
      hint: 'Library',
      icon: <IconLibrary size={17} />,
      route: { name: 'library' }
    },
    {
      key: 'history',
      label: '历史记录',
      hint: 'History',
      icon: <IconHistory size={17} />,
      route: { name: 'history' }
    }
  ]

  return (
    <aside className="flex w-[228px] shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/80">
      <div className="drag-region h-[46px] shrink-0" />
      <div className="px-4 pb-4">
        <div className="flex items-center gap-2.5">
          <img
            src={appIcon}
            alt=""
            className="h-10 w-10 shrink-0 select-none"
            draggable={false}
          />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-slate-100">TOEFL 口语模考</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Mock Exam Sim</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-2.5">
        {items.map((it) => {
          const active = isActive(it.route)
          return (
            <button
              key={it.key}
              onClick={() => {
                if (it.action) it.action()
                else if (it.route) navigate(it.route)
              }}
              className={cx(
                'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all',
                active
                  ? 'bg-brand-600/15 text-brand-200 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.28)]'
                  : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
              )}
            >
              <span className={cx('shrink-0', active ? 'text-brand-300' : 'text-slate-500 group-hover:text-slate-300')}>
                {it.icon}
              </span>
              <span className="flex-1 truncate text-[13px] font-medium">{it.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="space-y-1 border-t border-white/[0.06] px-2.5 py-3">
        <button
          onClick={() => navigate({ name: 'settings' })}
          className={cx(
            'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all',
            route.name === 'settings'
              ? 'bg-brand-600/15 text-brand-200'
              : 'text-slate-400 hover:bg-white/[0.05] hover:text-slate-200'
          )}
        >
          <IconSettings size={17} className="text-slate-500" />
          <span className="text-[13px] font-medium">设置</span>
        </button>
        <div className="px-3 pt-1 text-[10px] text-slate-600">
          v{appInfo?.version ?? '—'} · {appInfo?.arch ?? ''}
        </div>
      </div>
    </aside>
  )
}
