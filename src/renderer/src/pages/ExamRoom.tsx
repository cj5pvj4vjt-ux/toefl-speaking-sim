import React, { useEffect, useMemo, useRef, useState } from 'react'
import { TASK_DIRECTIONS, TASK_META } from '@shared/constants'
import { IconAlert, IconChevron, IconMic } from '../components/icons'
import { Spinner, cx } from '../components/ui'
import { useAppStore } from '../stores/useAppStore'
import { useExamStore } from '../stores/useExamStore'
import { useSettingsStore } from '../stores/useSettingsStore'

/**
 * 考试界面。
 * 设计原则：极简、无干扰、无多余按钮 —— 尽量贴近真实考场。
 * 唯一的手动操作是每道题开始前点击「开始准备」，
 * 这是浏览器/系统要求的安全手势（否则无法自动开启麦克风）。
 */

export default function ExamRoom(): React.JSX.Element {
  const attempt = useExamStore((s) => s.attempt)
  const phase = useExamStore((s) => s.phase)
  const index = useExamStore((s) => s.index)
  const remaining = useExamStore((s) => s.remaining)
  const total = useExamStore((s) => s.totalForPhase)
  const micLevel = useExamStore((s) => s.micLevel)
  const elapsedMs = useExamStore((s) => s.elapsedMs)
  const error = useExamStore((s) => s.error)
  const errorCode = useExamStore((s) => s.errorCode)
  const message = useExamStore((s) => s.message)
  const startPrep = useExamStore((s) => s.startPrep)
  const stopResponse = useExamStore((s) => s.stopResponse)
  const skipQuestion = useExamStore((s) => s.skipQuestion)
  const abort = useExamStore((s) => s.abort)
  const reset = useExamStore((s) => s.reset)
  const navigate = useAppStore((s) => s.navigate)

  const [confirmQuit, setConfirmQuit] = useState(false)

  /**
   * 题目音频状态。
   * 官方规则：所有音频只播一遍，不可重听 —— 因此播完就锁死按钮。
   */
  const [audioState, setAudioState] = useState<'idle' | 'loading' | 'playing' | 'played' | 'unavailable'>('idle')
  const [audioError, setAudioError] = useState('')
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const blobUrlRef = useRef<string | null>(null)

  const item = attempt?.attempts[index] ?? null
  const meta = item ? TASK_META[item.taskType] : null

  // 隐藏式安全退出：⌘/Ctrl + Shift + Backspace，避免考试中误触
  useEffect(
    () => () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
    },
    []
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'Backspace') {
        e.preventDefault()
        setConfirmQuit(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** 全自动推进：播完自动开始作答、时间到自动下一题（官方标准） */
  const autoAdvance = useSettingsStore((st) => st.settings?.exam.autoAdvance ?? true)
  /** 题目语速（对齐官方听力语速） */
  const ttsSpeed = useSettingsStore((st) => st.settings?.tts.speed ?? 1.15)
  /** 自动播放只触发一次，避免重渲染时重复合成 */
  const autoPlayedRef = useRef<string>('')

  const itemId = attempt?.attempts[index]?.questionId ?? ''
  useEffect(() => {
    setAudioState('idle')
    setAudioError('')
    autoPlayedRef.current = ''
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current)
      blobUrlRef.current = null
    }
    audioElRef.current = null
  }, [itemId, index])

  useEffect(() => {
    if (phase === 'done' && attempt) {
      const id = attempt.id
      const t = window.setTimeout(() => navigate({ name: 'report', examId: id }), 700)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [phase, attempt, navigate])

  if (!attempt || !item || !meta) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <div className="text-sm text-slate-400">考试会话不存在</div>
          <button
            className="btn-ghost mt-3"
            onClick={() => {
              reset()
              navigate({ name: 'dashboard' })
            }}
          >
            返回首页
          </button>
        </div>
      </div>
    )
  }

  const isPrep = phase === 'prep'
  const isResponse = phase === 'response'
  const showReading = meta.hasReading && (phase === 'brief' || isPrep)
  const seconds = Math.ceil(remaining)
  const respSeconds = Math.ceil(Math.max(0, (total - remaining)))

  /** 本题要播出的音频文本（跟读题就是那句标准句，面试题就是面试官提问） */
  const promptText = (item.questionSnapshot.listeningText || item.questionSnapshot.questionText || '').trim()
  /** 是否必须先听完音频才能作答 */
  const audioNeeded = meta.hasListening && !!promptText
  /** 跟读题：屏幕上绝不能出现目标句，只显示场景 */
  const isRepeat = item.taskType === 'LISTEN_REPEAT'
  /** 场景（Directions）：官方规定整个题组共用一段场景，屏幕上只显示它 */
  const scenarioText = (item.questionSnapshot.contextText ?? '').trim()
  /** 面试题：提问播完后才显示问题文本 */
  const revealed = !isRepeat && (isPrep || isResponse || phase === 'saving')

  /**
   * 全自动推进：进入一题就自动播放题目音频（官方流程没有「手动点播放」这一步）。
   *
   * Electron 的 autoplayPolicy 默认就是 no-user-gesture-required，
   * 加上考生点过「开始考试」，自动播放不会被浏览器拦截。
   */
  useEffect(() => {
    if (!autoAdvance) return
    if (phase !== 'brief') return
    if (!audioNeeded) return
    if (audioState !== 'idle') return
    if (autoPlayedRef.current === itemId) return
    autoPlayedRef.current = itemId
    void playPrompt()
    // playPrompt 每次渲染都是新函数，这里只依赖触发条件
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, phase, audioNeeded, audioState, itemId])

  /**
   * 播放题目音频。官方规则是「只播一遍」，所以播完后 audioState = 'played'，
   * 按钮随即锁死；合成失败（非 macOS 等）则退化为显示文本，保证考试能继续。
   */
  const playPrompt = async () => {
    if (audioState === 'loading' || audioState === 'playing' || audioState === 'played') return
    if (!promptText) {
      setAudioState('unavailable')
      return
    }
    setAudioState('loading')
    setAudioError('')
    try {
      const synth = await window.toefl.audio.prompt({ text: promptText })
      if (!synth.ok || !synth.audioPath) {
        setAudioError(synth.error ?? '语音合成失败')
        setAudioState('unavailable')
        return
      }
      const file = await window.toefl.audio.readPrompt(synth.audioPath)
      if (!file.ok || !file.data) {
        setAudioError(file.error ?? '读取音频失败')
        setAudioState('unavailable')
        return
      }
      const blob = new Blob([file.data], { type: file.mimeType ?? 'audio/wav' })
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      const url = URL.createObjectURL(blob)
      blobUrlRef.current = url

      const el = new Audio(url)
      // 云端 TTS 的 speed 参数不被模型支持，改在播放端变速；Chromium 默认保持音高
      el.preservesPitch = true
      el.playbackRate = ttsSpeed
      audioElRef.current = el
      el.onended = () => {
        setAudioState('played')
        // 官方流程没有准备时间：句子播完立刻开始作答
        if (autoAdvance) startPrep()
      }
      el.onerror = () => {
        setAudioError('音频播放失败')
        setAudioState('unavailable')
      }
      setAudioState('playing')
      await el.play()
    } catch (e) {
      setAudioError(e instanceof Error ? e.message : String(e))
      setAudioState('unavailable')
    }
  }

  const quit = () => {
    abort()
    reset()
    setConfirmQuit(false)
    navigate({ name: 'dashboard' })
  }

  return (
    <div className="flex h-full flex-col bg-ink-950 select-none">
      {/* 顶栏 */}
      <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-white/[0.06] px-6 pt-1">
        <div className="flex items-baseline gap-3 pl-[68px]">
          <span className="text-[13px] font-semibold tracking-[0.18em] text-slate-300">TOEFL SPEAKING</span>
        </div>
        <div className="flex items-center gap-5">
          <span
            className="rounded-lg border px-2.5 py-1 text-[11px] font-semibold tracking-wider"
            style={{ color: meta.accent, borderColor: `${meta.accent}55`, background: `${meta.accent}14` }}
          >
            {meta.shortLabel.toUpperCase()}
          </span>
          <span className="text-[12px] tabular-nums text-slate-400">
            Question {index + 1} / {attempt.attempts.length}
          </span>
        </div>
      </header>

      {/* 进度条 */}
      <div className="flex h-[3px] shrink-0 gap-px bg-white/[0.04]">
        {attempt.attempts.map((a, i) => (
          <div
            key={a.questionId + i}
            className={cx('flex-1 transition-all', i < index ? 'bg-brand-500/70' : i === index ? 'bg-brand-400' : 'bg-transparent')}
          />
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* 状态区 */}
        <StatusBar
          phase={phase}
          remaining={remaining}
          total={total}
          micLevel={micLevel}
          elapsedMs={elapsedMs}
          accent={meta.accent}
        />

        {/* 内容区 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto max-w-[860px] space-y-5">
            {showReading && item.questionSnapshot.readingText && (
              <MaterialBlock title="Reading" subtitle="阅读材料" tone="cyan" defaultOpen>
                {item.questionSnapshot.readingText}
              </MaterialBlock>
            )}

            {meta.hasListening && <PromptAudioPanel
              isRepeat={item.taskType === 'LISTEN_REPEAT'}
              state={audioState}
              error={audioError}
              fallbackText={promptText}
              accent={meta.accent}
              onPlay={playPrompt}
              revealed={item.taskType === 'INTERVIEW' && (isPrep || isResponse || phase === 'saving')}
            />}

            {/* Directions：官方规定屏幕上只显示场景，不显示跟读题的目标句 */}
            <div className="rounded-2xl border border-white/[0.09] bg-gradient-to-b from-white/[0.05] to-white/[0.015] px-6 py-5">
              <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Question &amp; Directions
              </div>
              <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100">
                {scenarioText || '（本题没有场景文本）'}
              </div>

              {isRepeat ? (
                <p className="mt-3 border-t border-white/[0.07] pt-3 text-[12px] leading-relaxed text-slate-500">
                  {TASK_DIRECTIONS.LISTEN_REPEAT}
                </p>
              ) : (
                <>
                  <p className="mt-3 border-t border-white/[0.07] pt-3 text-[12px] leading-relaxed text-slate-500">
                    {TASK_DIRECTIONS.INTERVIEW}
                  </p>
                  <div className="mt-3 rounded-xl border border-white/[0.08] bg-black/25 px-4 py-3">
                    <div className="mb-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                      Question
                    </div>
                    {revealed ? (
                      <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-100">
                        {item.questionSnapshot.questionText || '（本题没有问题文本）'}
                      </div>
                    ) : (
                      <div className="text-[13px] text-slate-500">
                        提问音频播放结束后显示问题文本
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* 操作区 */}
            {phase === 'brief' && (
              <div className="flex flex-col items-center gap-3 pt-2">
                {autoAdvance ? (
                  /* 全自动推进：没有「手动开始」这一步，音一播立刻进入作答 */
                  <>
                    <div className="flex items-center gap-2.5 text-sm text-slate-300">
                      <Spinner size={16} />
                      {audioNeeded
                        ? audioState === 'loading'
                          ? '正在准备题目音频…'
                          : audioState === 'playing'
                            ? '题目音频播放中…'
                            : '即将开始作答…'
                        : '即将开始作答…'}
                    </div>
                    <p className="text-[11px] text-slate-500">
                      全自动模式：音频只播一遍，播完<strong className="text-slate-300">立即开始录音</strong>，
                      时间到自动进入下一题。
                    </p>
                  </>
                ) : (
                  <>
                    {audioNeeded && audioState !== 'played' && audioState !== 'unavailable' ? (
                      <>
                        <button
                          className="btn-primary px-8 py-3 text-base"
                          onClick={playPrompt}
                          disabled={audioState === 'loading' || audioState === 'playing'}
                        >
                          {audioState === 'loading'
                            ? '正在准备音频…'
                            : audioState === 'playing'
                              ? '正在播放…'
                              : '播放题目音频'}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          官方规则：音频<strong className="text-slate-300">只播一遍</strong>，不可重听。听完才能开始作答。
                        </p>
                      </>
                    ) : (
                      <>
                        <button className="btn-primary px-8 py-3 text-base" onClick={startPrep}>
                          {item.questionSnapshot.preparationTime > 0
                            ? `开始准备（${item.questionSnapshot.preparationTime}s 准备 / ${item.questionSnapshot.responseTime}s 回答）`
                            : `开始作答（${item.questionSnapshot.responseTime}s）`}
                        </button>
                        <p className="text-[11px] text-slate-500">
                          {item.questionSnapshot.preparationTime > 0
                            ? '点击后立即开始倒计时，准备时间结束后自动开始录音'
                            : '本题没有准备时间，点击后立刻开始录音'}
                        </p>
                      </>
                    )}
                  </>
                )}
              </div>
            )}

            {/* 作答中：只能提前结束，不能延后 */}
            {isResponse && (
              <div className="flex flex-col items-center gap-2.5 pt-2">
                <button className="btn-ghost px-6 py-2.5 text-sm" onClick={() => void stopResponse()}>
                  提前结束本题，进入下一题
                </button>
                <p className="text-[11px] text-slate-500">
                  倒计时结束会自动保存并进入下一题；<strong className="text-slate-300">不能延后</strong>，
                  也不能重听题目音频。
                </p>
              </div>
            )}

            {isPrep && (
              <div className="pt-2 text-center text-[12px] text-slate-500">
                准备时间。此时不要回答，可以在脑中组织回答结构。
              </div>
            )}

            {phase === 'saving' && (
              <div className="flex items-center justify-center gap-3 pt-2 text-sm text-slate-400">
                <Spinner /> {message || '正在保存录音…'}
              </div>
            )}

            {phase === 'processing' && (
              <div className="flex flex-col items-center gap-3 pt-2">
                <Spinner size={22} />
                <div className="text-sm text-slate-300">{message || '正在转写并评分…'}</div>
                <div className="text-[11px] text-slate-500">请勿关闭应用，全部结束会自动跳转到评分报告</div>
              </div>
            )}

            {phase === 'error' && (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.07] px-5 py-4">
                <div className="flex items-start gap-2.5">
                  <IconAlert size={17} className="mt-0.5 text-red-300" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-red-200">本题出现异常</div>
                    <p className="mt-1 text-[12px] leading-relaxed text-red-200/80">{error}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          useExamStore.setState({ error: null, errorCode: null, phase: 'brief' })
                        }}
                      >
                        重做本题
                      </button>
                      <button className="btn-ghost btn-sm" onClick={skipQuestion}>
                        跳过本题 <IconChevron size={12} />
                      </button>
                      {errorCode === 'pipeline' && (
                        <button className="btn-primary btn-sm" onClick={() => void useExamStore.getState().runPipeline()}>
                          重试评分
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 底部 */}
      <footer className="flex h-[44px] shrink-0 items-center justify-between border-t border-white/[0.06] px-6 text-[11px] text-slate-500">
        <span>
          {attempt.title} · {attempt.questionSetTitle}
        </span>
        <button
          className="rounded-lg px-2 py-1 transition hover:bg-white/[0.05] hover:text-slate-300"
          onClick={() => setConfirmQuit(true)}
        >
          结束考试（⌘⇧⌫）
        </button>
      </footer>

      {confirmQuit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="card w-[420px] p-6">
            <div className="text-sm font-semibold text-slate-100">确定要结束本次考试吗？</div>
            <p className="mt-2 text-[12px] leading-relaxed text-slate-400">
              已经录制完成的题目会被保留，你可以稍后在历史记录中对它们进行转写与评分。
              未完成的题目将没有作答记录。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmQuit(false)}>
                继续考试
              </button>
              <button className="btn-danger" onClick={quit}>
                结束考试
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function StatusBar({
  phase,
  remaining,
  total,
  micLevel,
  elapsedMs,
  accent
}: {
  phase: string
  remaining: number
  total: number
  micLevel: number
  elapsedMs: number
  accent: string
}): React.JSX.Element {
  const isPrep = phase === 'prep'
  const isResponse = phase === 'response'
  const seconds = Math.max(0, Math.ceil(remaining))
  const elapsed = Math.max(0, Math.ceil(elapsedMs / 1000))
  const ratio = total > 0 ? 1 - remaining / total : 0

  if (!isPrep && !isResponse) {
    return (
      <div className="flex h-[68px] shrink-0 items-center justify-center border-b border-white/[0.05]">
        <div className="text-[11px] uppercase tracking-[0.3em] text-slate-600">
          {phase === 'brief' ? 'Ready' : phase === 'saving' ? 'Saving' : phase === 'processing' ? 'Analyzing' : ''}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-white/[0.05] px-8">
      <div className="flex items-center gap-3">
        <span
          className={cx(
            'text-[11px] font-semibold uppercase tracking-[0.28em]',
            isPrep ? 'text-slate-400' : 'text-red-300'
          )}
        >
          {isPrep ? 'Preparation' : 'Response'}
        </span>
        {isResponse && (
          <span className="flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-red-300">
            <span className="h-1.5 w-1.5 animate-pulseRec rounded-full bg-red-400" /> RECORDING
          </span>
        )}
      </div>

      <div className="flex items-center gap-6">
        {isResponse && (
          <div className="flex items-center gap-[3px]">
            {Array.from({ length: 20 }).map((_, i) => {
              const active = micLevel * 20 > i
              return (
                <span
                  key={i}
                  className={cx('w-[3px] rounded-full transition-all duration-75', active ? 'bg-emerald-400' : 'bg-white/10')}
                  style={{ height: active ? 6 + (i % 5) * 3 : 4 }}
                />
              )
            })}
          </div>
        )}
        <div className="text-right">
          <div className="font-mono text-3xl font-semibold leading-none tabular-nums text-slate-100">
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </div>
          <div className="mt-1 text-[10px] tabular-nums text-slate-500">
            {isResponse ? `已录 ${elapsed}s / ${Math.round(total)}s` : `共 ${Math.round(total)}s`}
          </div>
        </div>
      </div>

      <div className="absolute left-0 right-0" style={{ display: 'none' }}>
        <div style={{ width: `${ratio * 100}%`, background: accent }} />
      </div>
    </div>
  )
}

function MaterialBlock({
  title,
  subtitle,
  tone,
  children,
  defaultOpen = true
}: {
  title: string
  subtitle: string
  tone: 'cyan' | 'emerald'
  children: string
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const colors = tone === 'cyan' ? 'text-cyan-400/80' : 'text-emerald-400/80'
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09] bg-white/[0.02]">
      <button
        className="flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={cx('text-[11px] font-semibold uppercase tracking-[0.2em]', colors)}>{title}</span>
        <span className="text-[11px] text-slate-500">
          {subtitle} · {open ? '收起' : '展开'}
        </span>
      </button>
      {open && (
        <div className="max-h-[38vh] overflow-y-auto border-t border-white/[0.06] px-5 py-4">
          <div className="whitespace-pre-wrap text-[13.5px] leading-[1.75] text-slate-300">{children}</div>
        </div>
      )}
    </div>
  )
}

/**
 * 题目音频播放面板。
 *
 * 官方规则「音频只播一遍」是硬约束，所以这里刻意不提供重听按钮。
 * 跟读题绝不显示文本（显示就等于给出答案）；面试题在开始作答后才把
 * 问题文本放出来，方便考生组织内容，同时不破坏「先听」的流程。
 */
function PromptAudioPanel({
  isRepeat,
  state,
  error,
  fallbackText,
  accent,
  onPlay,
  revealed
}: {
  isRepeat: boolean
  state: 'idle' | 'loading' | 'playing' | 'played' | 'unavailable'
  error: string
  fallbackText: string
  accent: string
  onPlay: () => void
  revealed: boolean
}): React.JSX.Element {
  const label = isRepeat ? 'Listen and Repeat' : 'Interviewer Question'
  const sub = isRepeat ? '听后重复 · 只听不看' : '虚拟面试 · 面试官提问'

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
          {label}
          <span className="text-slate-500">· {sub}</span>
        </div>
        {(state === 'playing' || state === 'played') && (
          <span className="text-[10px] text-slate-500">
            {state === 'playing' ? '正在播放…' : '已播放完毕（官方只播一遍）'}
          </span>
        )}
      </div>

      {state === 'unavailable' ? (
        <div className="mt-2.5">
          <p className="text-[12px] leading-relaxed text-amber-300/80">
            本题音频无法合成（{error || '未知原因'}），已退化为显示文本，请据其作答。
          </p>
          <p className="mt-2 whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-white/[0.03] px-3.5 py-3 text-[14px] leading-relaxed text-slate-100">
            {fallbackText || '（本题没有可用文本）'}
          </p>
        </div>
      ) : isRepeat ? (
        <p className="mt-2.5 text-[12px] leading-relaxed text-slate-400">
          你会听到一句校园或日常场景的英文短句。系统只会播放<strong className="text-slate-300">一遍</strong>，
          听完请立刻原样复述。作答前不会显示任何文本。
        </p>
      ) : (
        <div className="mt-2.5 flex items-center gap-3">
          <p className="text-[12px] leading-relaxed text-slate-400">
            面试官将用英文提问，提问<strong className="text-slate-300">只播一遍</strong>；播放结束后下方会显示问题文本。
          </p>
          {state === 'idle' && (
            <button className="btn-ghost px-3 py-1.5 text-[12px]" onClick={onPlay}>
              播放提问
            </button>
          )}
        </div>
      )}
    </div>
  )
}
