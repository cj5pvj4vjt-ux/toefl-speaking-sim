import React, { useCallback, useMemo, useRef, useState } from 'react'
import { TASK_META, TASK_TYPES } from '@shared/constants'
import { newId, parseQuestionsFromPages } from '@shared/pdf/parseQuestions'
import type { ImportStats, Question, QuestionSet, TaskType } from '@shared/types'
import { QuestionEditor } from '../components/QuestionEditor'
import { IconAlert, IconCheck, IconEdit, IconFile, IconSpark, IconTrash, IconUpload } from '../components/icons'
import { Badge, Card, EmptyState, ProgressBar, SectionHeader, Spinner, cx } from '../components/ui'
import { api } from '../lib/api'
import { closePdf, extractText, loadPdf, renderPageToPng, type PdfDocHandle } from '../lib/pdf'
import { useAppStore } from '../stores/useAppStore'
import { useLibraryStore } from '../stores/useLibraryStore'

type Stage = 'idle' | 'reading' | 'extracting' | 'parsing' | 'ai' | 'ocr' | 'review' | 'saving'

/** 解析方式：规则解析快、零成本；AI 智能解析能啃下各种奇怪版式 */
type ParseMode = 'rule' | 'ai'

interface ImportState {
  stage: Stage
  fileName: string
  filePath: string
  progress: number
  progressLabel: string
  questions: Question[]
  warnings: string[]
  stats: ImportStats | null
  title: string
  likelyScanned: boolean
  error: string | null
  /** 实际使用的解析方式 */
  usedMode: ParseMode | null
  /** 本页文字（AI 解析用） */
  pages: { page: number; text: string }[]
}

const initial: ImportState = {
  stage: 'idle',
  fileName: '',
  filePath: '',
  progress: 0,
  progressLabel: '',
  questions: [],
  warnings: [],
  stats: null,
  title: '',
  likelyScanned: false,
  error: null,
  usedMode: null,
  pages: []
}

export default function ImportPage(): React.JSX.Element {
  const navigate = useAppStore((s) => s.navigate)
  const toast = useAppStore((s) => s.toast)
  const saveSet = useLibraryStore((s) => s.save)

  const [state, setState] = useState<ImportState>(initial)
  const [dragging, setDragging] = useState(false)
  const [mode, setMode] = useState<ParseMode>('rule')
  const [editing, setEditing] = useState<Question | null>(null)
  const handleRef = useRef<PdfDocHandle | null>(null)
  const lastBytesRef = useRef<ArrayBuffer | null>(null)

  const update = (p: Partial<ImportState>) => setState((s) => ({ ...s, ...p }))

  /* ---------------- AI 解析进度（主进程主动推送） ---------------- */
  React.useEffect(() => {
    if (!api.pdf?.onParseProgress) return
    return api.pdf.onParseProgress((e) => {
      setState((prev) => {
        if (prev.stage !== 'ai') return prev
        return {
          ...prev,
          progress: e.total ? e.done / e.total : 0,
          progressLabel: e.message || `AI 正在整理题目…（${e.done}/${e.total}）`
        }
      })
    })
  }, [])

  /* ------------------------- 载入与解析 ------------------------- */

  const runParse = useCallback(
    async (data: ArrayBuffer, fileName: string, filePath: string, useMode: ParseMode = mode) => {
      lastBytesRef.current = data
      update({ stage: 'extracting', fileName, filePath, progress: 0, progressLabel: '正在读取 PDF…', error: null })

      try {
        await closePdf(handleRef.current)
        const handle = await loadPdf(data)
        handleRef.current = handle

        update({ progressLabel: `解析 ${handle.totalPages} 页文本…` })
        const outcome = await extractText(handle, (done, total) => {
          update({ progress: total ? done / total : 0 })
        })

        let questions: Question[] = []
        let warnings: string[] = []
        let needsReview = 0
        let autoSwitched = false

        if (useMode === 'ai') {
          /* ---------------- AI 智能解析 ---------------- */
          const pages = outcome.pages.map((p) => ({ page: p.page, text: p.text }))
          const withText = pages.filter((p) => p.text.replace(/\s/g, '').length >= 20)
          if (withText.length === 0) {
            throw new Error('这份 PDF 几乎没有可提取的文字，请先用「OCR 识别」把页面转成文字。')
          }
          update({ stage: 'ai', progress: 0, progressLabel: 'AI 正在阅读并整理题目…' })
          const res = await api.pdf.parseLlm(withText)
          if (!res.ok) throw new Error(res.error ?? 'AI 解析失败')
          questions = (res.questions ?? []) as Question[]
          warnings = res.warnings ?? []
          needsReview = questions.filter((q) => q.needsReview).length
          if (res.failedChunks) {
            warnings = [...warnings, `有 ${res.failedChunks} 个分块未能解析成功，可能漏题。可以重试，或改用规则解析后手动补齐。`]
          }
        } else {
          /* ---------------- 规则解析 ---------------- */
          update({ stage: 'parsing', progressLabel: '识别题目结构…' })
          const parsed = parseQuestionsFromPages(outcome.pages)
          questions = parsed.questions
          warnings = parsed.warnings
          needsReview = parsed.stats.needsReview

          // 规则解析没认出题、或者明显不完整时，提示改用 AI
          const groups = new Set(questions.map((q) => q.tags.find((t) => t.startsWith('group:')) ?? ''))
          const incomplete = [...groups].some((g) => {
            const inG = questions.filter((q) => q.tags.includes(g))
            return inG.length !== 11
          })
          if (questions.length > 0 && (incomplete || questions.length < 11)) {
            warnings = [
              ...warnings,
              '规则解析发现题组不完整。建议切换到「AI 智能解析」——它更能应付排版不统一的 PDF。'
            ]
            autoSwitched = true
          }
        }

        const stats: ImportStats = {
          totalPages: outcome.totalPages,
          pagesWithText: outcome.pagesWithText,
          detected: questions.length,
          parsed: questions.length,
          needsReview,
          warnings: [...outcome.warnings, ...warnings],
          usedOcr: false
        }

        const title =
          outcome.title ||
          fileName.replace(/\.pdf$/i, '').slice(0, 80) ||
          `题库 ${new Date().toLocaleDateString('zh-CN')}`

        update({
          stage: 'review',
          questions,
          warnings: stats.warnings,
          stats,
          title,
          likelyScanned: outcome.likelyScanned,
          progress: 1,
          progressLabel: '',
          usedMode: useMode,
          pages: outcome.pages.map((p) => ({ page: p.page, text: p.text }))
        })
        if (autoSwitched) setMode('ai')

        if (questions.length === 0) {
          toast({
            kind: 'warn',
            title: '未能自动识别出题目',
            detail: outcome.likelyScanned
              ? '这份 PDF 很可能是扫描件。可以点击「OCR 识别」尝试，或直接手动录入题目。'
              : 'PDF 版式可能不常见。你可以在下方手动新增题目，或检查文件是否包含文字层。'
          })
        } else {
          toast({
            kind: 'success',
            title: `已识别 ${questions.length} 道题`,
            detail: needsReview > 0 ? `其中 ${needsReview} 道需要人工确认` : undefined
          })
        }
      } catch (e) {
        update({
          stage: 'idle',
          error: (e as Error).message,
          progressLabel: ''
        })
        toast({ kind: 'error', title: 'PDF 解析失败', detail: (e as Error).message })
      }
    },
    [toast]
  )

  const pickFile = async () => {
    const res = await api.file.openPdfDialog()
    if (!res.ok) {
      if (!res.canceled) toast({ kind: 'error', title: '无法打开文件', detail: res.error })
      return
    }
    if (!res.data) return
    await runParse(res.data, res.fileName ?? 'document.pdf', res.filePath ?? '')
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (!/\.pdf$/i.test(file.name)) {
      toast({ kind: 'error', title: '只支持 PDF 文件', detail: `收到的是 ${file.name}` })
      return
    }
    let path = ''
    try {
      path = api.file.pathForFile(file)
    } catch {
      path = ''
    }
    try {
      const data = await file.arrayBuffer()
      await runParse(data, file.name, path)
    } catch (err) {
      toast({ kind: 'error', title: '读取文件失败', detail: (err as Error).message })
    }
  }

  /* ----------------------------- OCR ----------------------------- */

  const runOcr = async () => {
    const handle = handleRef.current
    if (!handle) return
    update({ stage: 'ocr', progress: 0, progressLabel: '正在 OCR 识别（首次运行需下载语言包）…' })
    try {
      const pages: { page: number; text: string }[] = []
      const limit = Math.min(handle.totalPages, 40)
      for (let i = 1; i <= limit; i++) {
        update({
          progress: (i - 1) / limit,
          progressLabel: `OCR 识别第 ${i} / ${limit} 页…`
        })
        const png = await renderPageToPng(handle, i, 2)
        const res = await api.ocr.recognize(png.buffer.slice(0) as ArrayBuffer, 'eng')
        if (!res.ok) throw new Error(res.error ?? 'OCR 失败')
        pages.push({ page: i, text: res.text })
      }
      update({ progress: 1, progressLabel: '整理 OCR 结果…' })
      const parsed = parseQuestionsFromPages(pages)
      update({
        stage: 'review',
        questions: parsed.questions,
        warnings: [
          `已对前 ${limit} 页执行 OCR 识别，OCR 文本可能存在字符误差，请务必逐题核对。`,
          ...parsed.warnings
        ],
        stats: {
          totalPages: handle.totalPages,
          pagesWithText: limit,
          detected: parsed.stats.detected,
          parsed: parsed.stats.parsed,
          needsReview: parsed.stats.needsReview,
          warnings: parsed.warnings,
          usedOcr: true
        },
        likelyScanned: true,
        progress: 1,
        progressLabel: ''
      })
      toast({
        kind: parsed.questions.length ? 'success' : 'warn',
        title: `OCR 完成，识别出 ${parsed.questions.length} 道题`,
        detail: 'OCR 结果可能有错字，请逐题检查后再保存。'
      })
    } catch (e) {
      update({ stage: 'review', progressLabel: '', error: null })
      toast({ kind: 'error', title: 'OCR 识别失败', detail: (e as Error).message })
    }
  }

  /* ---------------------------- 编辑 ---------------------------- */

  const addManual = () => {
    const q: Question = {
      id: newId('q'),
      taskType: 'LISTEN_REPEAT',
      questionText: '',
      contextText: null,
      readingText: null,
      listeningText: null,
      referenceAnswer: null,
      preparationTime: TASK_META.LISTEN_REPEAT.prepTime,
      responseTime: TASK_META.LISTEN_REPEAT.responseTime,
      sourcePage: null,
      tags: ['manual'],
      parseWarnings: ['手动录入'],
      needsReview: true,
      rawText: ''
    }
    setState((s) => ({ ...s, stage: 'review', questions: [...s.questions, q] }))
    setEditing(q)
  }

  const applyEdit = (q: Question) => {
    setState((s) => ({ ...s, questions: s.questions.map((x) => (x.id === q.id ? q : x)) }))
    setEditing(null)
  }

  const removeQuestion = (id: string) => {
    setState((s) => ({ ...s, questions: s.questions.filter((q) => q.id !== id) }))
  }

  /* ---------------------------- 保存 ---------------------------- */

  const doSave = async () => {
    if (state.questions.length === 0) {
      toast({ kind: 'warn', title: '题库为空', detail: '请至少添加一道题目' })
      return
    }
    update({ stage: 'saving' })
    const set: QuestionSet = {
      id: newId('set'),
      title: state.title.trim() || '未命名题库',
      sourcePdf: state.filePath || state.fileName,
      createdAt: Date.now(),
      questions: state.questions,
      importStats: state.stats ?? undefined
    }
    const saved = await saveSet(set)
    if (saved) {
      toast({
        kind: 'success',
        title: `题库已保存：${saved.title}`,
        detail: `共 ${saved.questions.length} 道题，可立即开始模拟考试。`
      })
      setState(initial)
      await closePdf(handleRef.current)
      handleRef.current = null
      navigate({ name: 'library-detail', setId: saved.id })
    } else {
      update({ stage: 'review' })
      toast({ kind: 'error', title: '保存失败', detail: useLibraryStore.getState().error ?? '' })
    }
  }

  const reset = async () => {
    await closePdf(handleRef.current)
    handleRef.current = null
    setState(initial)
  }

  /* ---------------------------- 统计 ---------------------------- */

  /** 题组结构自检：官方一套固定 7 跟读 + 4 面试 */
  const groupStats = useMemo(() => {
    const m = new Map<string, { r: number; i: number }>()
    for (const q of state.questions) {
      const g = q.tags.find((t) => t.startsWith('group:')) ?? 'group:未分组'
      const c = m.get(g) ?? { r: 0, i: 0 }
      if (q.taskType === 'LISTEN_REPEAT') c.r += 1
      else c.i += 1
      m.set(g, c)
    }
    const complete = [...m.values()].filter((v) => v.r === 7 && v.i === 4).length
    return { total: m.size, complete }
  }, [state.questions])

  const counts = useMemo(() => {
    const map: Record<TaskType, number> = { LISTEN_REPEAT: 0, INTERVIEW: 0 }
    for (const q of state.questions) map[q.taskType]++
    return map
  }, [state.questions])

  const busy =
    state.stage === 'reading' ||
    state.stage === 'extracting' ||
    state.stage === 'parsing' ||
    state.stage === 'ai' ||
    state.stage === 'ocr'

  /** 换一种方式重新解析（AI ↔ 规则），不用重新选文件 */
  const reparseWith = async (m: ParseMode): Promise<void> => {
    if (!lastBytesRef.current) return
    setMode(m)
    await runParse(lastBytesRef.current, state.fileName, state.filePath, m)
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="drag-region h-[46px]" />
      <div className="mx-auto max-w-[1100px] px-8 pb-20">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-100">导入真题 PDF</h1>
            <p className="mt-1 text-sm text-slate-400">
              把包含多套 2026 新托福口语真题的 PDF 拖进来，App 会自动识别题组、场景与作答时间
              （每套 7 道 Listen &amp; Repeat + 4 道 Take an Interview）。
            </p>
          </div>
          {state.stage === 'review' && (
            <button className="btn-ghost" onClick={reset}>
              重新导入
            </button>
          )}
        </div>

        {/* 解析方式 */}
        {(state.stage === 'idle' || state.stage === 'review') && (
          <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">
              <IconSpark size={13} />
              解析方式
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    id: 'rule' as ParseMode,
                    title: '规则解析',
                    desc: '本地秒级完成、不花钱。适合版式统一的 PDF。',
                    tone: 'brand'
                  },
                  {
                    id: 'ai' as ParseMode,
                    title: 'AI 智能解析',
                    desc: '交给云端模型理解版式，能处理参考答案干扰、题号错乱、文字损坏甚至图片页。',
                    tone: 'aqua'
                  }
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => (state.stage === 'review' ? void reparseWith(m.id) : setMode(m.id))}
                  disabled={busy}
                  className={cx(
                    'rounded-xl border px-4 py-3 text-left transition disabled:opacity-50',
                    mode === m.id
                      ? 'border-brand-500/60 bg-brand-500/[0.09]'
                      : 'border-white/[0.09] bg-white/[0.02] hover:border-white/20'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-slate-100">{m.title}</span>
                    {state.usedMode === m.id && <Badge tone="brand">已使用</Badge>}
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-400">{m.desc}</p>
                </button>
              ))}
            </div>
            {mode === 'ai' && (
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                AI 解析会调用「设置 → AI 评分」里绑定的云端模型，按分块并发处理，速度取决于模型与页数。
              </p>
            )}
          </div>
        )}

        {/* 拖拽区 */}
        {(state.stage === 'idle' || busy) && (
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 text-center transition',
              dragging ? 'border-brand-500/70 bg-brand-500/[0.07]' : 'border-white/12 bg-white/[0.02]'
            )}
          >
            {busy ? (
              <>
                <Spinner size={26} />
                <div className="text-sm text-slate-200">{state.progressLabel || '处理中…'}</div>
                <div className="w-72">
                  <ProgressBar value={state.progress} max={1} />
                </div>
                <div className="text-[11px] text-slate-500">正在解析：{state.fileName}</div>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.05] text-slate-300">
                  <IconFile size={26} />
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-200">把 PDF 拖到这里</div>
                  <div className="mt-1 text-xs text-slate-500">支持几十到几百道题的合集文件，单个文件最大 200MB</div>
                </div>
                <button className="btn-primary" onClick={pickFile}>
                  <IconUpload size={15} /> 选择 PDF 文件
                </button>
              </>
            )}
          </div>
        )}

        {state.error && (
          <Card className="mt-4 border-red-500/30 bg-red-500/[0.07]">
            <div className="flex items-start gap-2.5">
              <IconAlert size={16} className="mt-0.5 text-red-300" />
              <div className="text-sm text-red-200">{state.error}</div>
            </div>
          </Card>
        )}

        {/* 结果 */}
        {state.stage !== 'idle' && state.stats && (
          <div className="mt-5 space-y-5">
            <Card>
              <SectionHeader
                title="解析结果"
                subtitle={`来源：${state.fileName}　·　${state.stats.totalPages} 页（${state.stats.pagesWithText} 页含文字层）`}
                right={
                  <Badge tone={state.usedMode === 'ai' ? 'aqua' : state.stats.usedOcr ? 'warn' : 'brand'}>
                    {state.usedMode === 'ai' ? 'AI 智能解析' : '文字层解析'}
                  </Badge>
                }
              />
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Metric label="识别题目" value={state.stats.detected} />
                <Metric label="可自动解析" value={state.stats.parsed} tone="good" />
                <Metric label="需要人工确认" value={state.stats.needsReview} tone={state.stats.needsReview ? 'warn' : 'default'} />
                <Metric label="当前题库" value={state.questions.length} tone="brand" />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {TASK_TYPES.map((t) => (
                  <Badge key={t} tone="default">
                    {TASK_META[t].shortLabel}: {counts[t]}
                  </Badge>
                ))}
                {groupStats.total > 0 && (
                  <Badge tone={groupStats.complete === groupStats.total ? 'good' : 'warn'}>
                    题组 {groupStats.total} 套 · 结构与官方一致 {groupStats.complete} 套
                  </Badge>
                )}
              </div>

              {state.warnings.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5">
                  <div className="mb-1.5 flex items-center gap-2 text-xs font-medium text-amber-200">
                    <IconAlert size={14} /> 解析提示（{state.warnings.length}）
                  </div>
                  {/* 以前只显示 8 条，其余被静默丢掉，看起来像「一堆问题又说不清」*/}
                  <ul className="max-h-52 space-y-1 overflow-y-auto pr-1 text-[11px] leading-relaxed text-amber-200/75">
                    {state.warnings.map((w, i) => (
                      <li key={i}>· {w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {state.likelyScanned && (
                  <button className="btn-ghost" onClick={runOcr} disabled={busy}>
                    <IconSpark size={15} /> {state.stats.usedOcr ? '重新 OCR 识别' : 'OCR 识别（扫描件）'}
                  </button>
                )}
                <button className="btn-ghost" onClick={addManual}>
                  + 手动新增题目
                </button>
                <div className="flex-1" />
                <button className="btn-primary" onClick={doSave} disabled={state.stage === 'saving'}>
                  {state.stage === 'saving' ? <Spinner /> : <IconCheck size={15} />} 保存为题库
                </button>
              </div>

              <div className="mt-3">
                <label className="label">题库名称</label>
                <input className="input" value={state.title} onChange={(e) => update({ title: e.target.value })} />
              </div>
            </Card>

            {/* 题目列表 */}
            {state.questions.length === 0 ? (
              <EmptyState
                icon={<IconFile size={28} />}
                title="没有识别到题目"
                description="可以点击「OCR 识别」尝试扫描件，或手动新增题目后保存。"
                action={
                  <button className="btn-ghost" onClick={addManual}>
                    手动新增题目
                  </button>
                }
              />
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1">
                  <div className="section-title">题目列表</div>
                  <div className="text-[11px] text-slate-500">
                    标黄的题目需要人工确认，点击「修正」可以直接编辑
                  </div>
                </div>
                {state.questions.map((q, i) => (
                  <QuestionRow
                    key={q.id}
                    index={i + 1}
                    question={q}
                    onEdit={() => setEditing(q)}
                    onRemove={() => removeQuestion(q.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <QuestionEditor open={!!editing} question={editing} onClose={() => setEditing(null)} onSave={applyEdit} />
    </div>
  )
}

function Metric({
  label,
  value,
  tone = 'default'
}: {
  label: string
  value: number
  tone?: 'default' | 'good' | 'warn' | 'brand'
}): React.JSX.Element {
  const colors: Record<string, string> = {
    default: 'text-slate-100',
    good: 'text-emerald-300',
    warn: 'text-amber-300',
    brand: 'text-brand-300'
  }
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={cx('mt-1 text-xl font-semibold tabular-nums', colors[tone])}>{value}</div>
    </div>
  )
}

function QuestionRow({
  index,
  question,
  onEdit,
  onRemove
}: {
  index: number
  question: Question
  onEdit: () => void
  onRemove: () => void
}): React.JSX.Element {
  const meta = TASK_META[question.taskType]
  const preview = question.questionText || question.readingText || question.listeningText || '（内容为空）'
  return (
    <div
      className={cx(
        'flex items-center gap-3 rounded-xl border px-3.5 py-3 transition',
        question.needsReview ? 'border-amber-500/25 bg-amber-500/[0.04]' : 'border-white/[0.07] bg-white/[0.02]'
      )}
    >
      <div className="w-8 shrink-0 text-center text-[11px] tabular-nums text-slate-500">{index}</div>
      <div className="w-16 shrink-0">
        <div className="text-[11px] font-semibold" style={{ color: meta.accent }}>
          {meta.shortLabel}
        </div>
        <div className="text-[10px] text-slate-500">
          {question.preparationTime}/{question.responseTime}s
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] text-slate-300">{preview}</div>
        <div className="mt-0.5 flex gap-1.5">
          {question.readingText && <span className="text-[10px] text-cyan-400/70">阅读 ✓</span>}
          {question.listeningText && <span className="text-[10px] text-emerald-400/70">听力稿 ✓</span>}
          {question.needsReview && <span className="text-[10px] text-amber-400/80">待确认</span>}
          {question.sourcePage && <span className="text-[10px] text-slate-600">P{question.sourcePage}</span>}
        </div>
      </div>
      <button className="btn-ghost btn-sm shrink-0" onClick={onEdit}>
        <IconEdit size={13} /> 修正
      </button>
      <button className="btn-ghost btn-sm shrink-0 text-red-300/80 hover:text-red-200" onClick={onRemove}>
        <IconTrash size={13} />
      </button>
    </div>
  )
}
