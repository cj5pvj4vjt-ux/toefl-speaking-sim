import React, { useEffect, useRef, useState } from 'react'
import { IconAlert, IconPlay } from './icons'
import { Spinner, cx } from './ui'
import { api } from '../lib/api'

/**
 * 播放本地录音。
 * 音频字节由主进程读取（Renderer 不接触文件系统），转成 Blob URL 播放。
 */
export function AudioPlayer({
  audioPath,
  durationMs,
  compact = false
}: {
  audioPath: string | null | undefined
  durationMs?: number
  compact?: boolean
}): React.JSX.Element | null {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    return () => {
      alive = false
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current)
        urlRef.current = null
      }
    }
  }, [])

  const load = async () => {
    if (!audioPath || url) return
    setLoading(true)
    setError(null)
    try {
      const res = await api.audio.read(audioPath)
      if (!res.ok || !res.data) throw new Error(res.error ?? '读取录音失败')
      const blob = new Blob([res.data], { type: mimeFromPath(audioPath) })
      const objectUrl = URL.createObjectURL(blob)
      urlRef.current = objectUrl
      setUrl(objectUrl)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (!audioPath) {
    return compact ? null : <div className="text-[11px] text-slate-500">本题没有录音文件</div>
  }

  if (error) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-red-300/80">
        <IconAlert size={12} /> {error}
      </div>
    )
  }

  if (!url) {
    return (
      <button className={cx('btn-ghost btn-sm', compact && 'px-2 py-1')} onClick={load} disabled={loading}>
        {loading ? <Spinner size={12} /> : <IconPlay size={12} />} 播放录音
        {durationMs ? <span className="text-slate-500">· {Math.round(durationMs / 1000)}s</span> : null}
      </button>
    )
  }

  return (
    <audio
      controls
      autoPlay
      src={url}
      className={cx('h-9 w-full', compact ? 'max-w-[280px]' : 'max-w-[420px]')}
      style={{ colorScheme: 'dark' }}
    />
  )
}

function mimeFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'webm':
      return 'audio/webm'
    case 'ogg':
      return 'audio/ogg'
    case 'wav':
      return 'audio/wav'
    case 'mp3':
      return 'audio/mpeg'
    case 'm4a':
      return 'audio/mp4'
    default:
      return 'audio/webm'
  }
}
