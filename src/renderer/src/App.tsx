import React, { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toasts } from './components/Toasts'
import { Spinner } from './components/ui'
import { useAppStore } from './stores/useAppStore'
import { useHistoryStore } from './stores/useHistoryStore'
import { useLibraryStore } from './stores/useLibraryStore'
import { useSettingsStore } from './stores/useSettingsStore'
import Dashboard from './pages/Dashboard'
import ExamRoom from './pages/ExamRoom'
import HistoryPage from './pages/History'
import ImportPage from './pages/Import'
import LibraryDetail from './pages/LibraryDetail'
import LibraryPage from './pages/Library'
import Processing from './pages/Processing'
import Report from './pages/Report'
import SettingsPage from './pages/Settings'
import ExamSetup from './pages/ExamSetup'

export default function App(): React.JSX.Element {
  const route = useAppStore((s) => s.route)
  const bootError = useAppStore((s) => s.bootError)
  const loadAppInfo = useAppStore((s) => s.loadAppInfo)

  useEffect(() => {
    void loadAppInfo()
    void useSettingsStore.getState().load()
    void useLibraryStore.getState().load()
    void useHistoryStore.getState().loadDashboard()
    void useHistoryStore.getState().load()
  }, [loadAppInfo])

  if (bootError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="text-lg font-semibold text-red-300">应用初始化失败</div>
        <p className="max-w-lg text-sm text-slate-400">{bootError}</p>
        <p className="text-xs text-slate-500">请重启应用。若问题持续，请检查数据目录权限。</p>
      </div>
    )
  }

  const fullBleed = route.name === 'exam'

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!fullBleed && <Sidebar />}
      <main className="relative flex-1 overflow-hidden">
        {fullBleed && <div className="drag-region absolute inset-x-0 top-0 z-40 h-[46px]" />}
        <RouteView />
      </main>
      <Toasts />
    </div>
  )
}

function RouteView(): React.JSX.Element {
  const route = useAppStore((s) => s.route)
  switch (route.name) {
    case 'dashboard':
      return <Dashboard />
    case 'library':
      return <LibraryPage />
    case 'library-detail':
      return <LibraryDetail setId={route.setId} />
    case 'import':
      return <ImportPage />
    case 'setup':
      return <ExamSetup />
    case 'exam':
      return <ExamRoom />
    case 'processing':
      return <Processing examId={route.examId} />
    case 'report':
      return <Report examId={route.examId} />
    case 'history':
      return <HistoryPage />
    case 'settings':
      return <SettingsPage />
    default:
      return (
        <div className="flex h-full items-center justify-center">
          <Spinner size={22} />
        </div>
      )
  }
}
