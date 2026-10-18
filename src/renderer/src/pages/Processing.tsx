import React, { useEffect, useRef, useState } from 'react'
import { IconAlert, IconCheck, IconSpark } from '../components/icons'
import { Card, ProgressBar, SectionHeader, Spinner } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAppStore } from '../stores/useAppStore'
import { useHistoryStore } from '../stores/useHistoryStore'

/**
 * 重新分析页：对已有考试补做「语音转写 / AI 评分 / 总结」。
 * 用于网络中断、未配置 API Key、或想重新评分的情况。
 */

export default function Processing({ examId }: { examId: string }): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const [message, setMessage] = useState('准备中…')
  const [index, setIndex] = useState(0)
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const off = api.exams.onProgress((p) => {
      setMessage(p.message)
      setIndex(p.itemIndex)
      setTotal(p.itemTotal)
    })

    void (async () => {
      try {
        const res = await api.exams.reanalyze({ examId })
        if (res.ok) {
          setDone(true)
          setMessage('处理完成')
          await useHistoryStore.getState().loadDashboard()
          await useHistoryStore.getState().load()
          window.setTimeout(() => navigate({ name: 'report', examId }), 900)
        } else {
          setError(res.error ?? '处理失败')
        }
      } catch (e) {
        setError(errorMessage(e))
      } finally {
        off()
      }
    })()

    return () => {
      off()
    }
  }, [examId, navigate])

  const ratio = total > 0 ? index / total : done ? 1 : 0.08

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[720px] px-8 py-10">
        <Card>
          <SectionHeader
            title="重新分析"
            subtitle="正在对录音进行语音转写与 AI 评分，请勿关闭应用"
            right={done ? <IconCheck size={18} className="text-emerald-300" /> : <Spinner size={18} />}
          />
          <div className="mb-4">
            <ProgressBar value={ratio} max={1} />
          </div>
          <div className="flex items-center gap-2 text-[13px] text-slate-300">
            <IconSpark size={15} className="text-brand-300" />
            {message}
          </div>
          {total > 0 && (
            <div className="mt-1.5 text-[11px] text-slate-500">
              第 {Math.min(index + 1, total)} / {total} 题
            </div>
          )}

          {error && (
            <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/[0.07] px-4 py-3">
              <div className="flex items-start gap-2">
                <IconAlert size={15} className="mt-0.5 text-red-300" />
                <div className="flex-1">
                  <div className="text-[13px] font-medium text-red-200">处理未完全成功</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-red-200/80">{error}</p>
                  <p className="mt-2 text-[11px] text-red-200/60">
                    录音已经安全保存在本地。你可以到「设置」检查 API Key / 网络后再次尝试。
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => navigate({ name: 'history' })}>
              返回历史记录
            </button>
            <button className="btn-primary" onClick={() => navigate({ name: 'report', examId })} disabled={!done && !error}>
              查看当前报告
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
