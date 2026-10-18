/**
 * 录音封装：MediaRecorder + Web Audio（增益 + 电平检测）
 * 只使用浏览器标准 API，不接触 Node。
 */

export interface MicDevice {
  deviceId: string
  label: string
}

export interface RecordingResult {
  blob: Blob
  mimeType: string
  durationMs: number
  byteLength: number
}

export interface RecordingHandle {
  readonly mimeType: string
  /** 0-1 的实时电平，用于界面音量条 */
  level(): number
  elapsedMs(): number
  stop(): Promise<RecordingResult>
  abort(): void
}

export class MicrophoneError extends Error {
  readonly code: 'denied' | 'notfound' | 'inuse' | 'unknown'
  constructor(code: MicrophoneError['code'], message: string) {
    super(message)
    this.code = code
    this.name = 'MicrophoneError'
  }
}

export function describeMicError(e: unknown): MicrophoneError {
  const err = e as { name?: string; message?: string }
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new MicrophoneError(
        'denied',
        '麦克风权限被拒绝。请在「系统设置 → 隐私与安全性 → 麦克风」中允许本应用，然后重试。'
      )
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new MicrophoneError('notfound', '没有找到可用的麦克风设备，请连接麦克风或选择其他输入设备。')
    case 'NotReadableError':
    case 'AbortError':
      return new MicrophoneError('inuse', '麦克风被其他程序占用，请关闭其他录音/会议软件后重试。')
    default:
      return new MicrophoneError('unknown', `麦克风初始化失败：${err?.message ?? String(e)}`)
  }
}

export async function listMicrophones(): Promise<MicDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    return devices
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `输入设备 ${i + 1}`
      }))
  } catch {
    return []
  }
}

/** 请求权限并列出带名称的设备（标签需要先授权才会显示） */
export async function listMicrophonesWithPermission(): Promise<MicDevice[]> {
  await ensurePermission()
  return listMicrophones()
}

export async function ensurePermission(): Promise<void> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
  } catch (e) {
    throw describeMicError(e)
  }
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const c of candidates) {
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c
    } catch {
      /* ignore */
    }
  }
  return ''
}

export interface StartOptions {
  deviceId?: string
  inputGain?: number
  /** 不经过 MediaRecorder，仅用于试音 */
  monitorOnly?: boolean
}

export async function startRecording(opts: StartOptions = {}): Promise<RecordingHandle> {
  const constraints: MediaStreamConstraints = {
    audio: {
      deviceId: opts.deviceId && opts.deviceId !== 'default' ? { exact: opts.deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1
    },
    video: false
  }

  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints)
  } catch (e) {
    throw describeMicError(e)
  }

  const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AudioCtor()
  try {
    await ctx.resume()
  } catch {
    /* ignore */
  }

  const source = ctx.createMediaStreamSource(stream)
  const gainNode = ctx.createGain()
  gainNode.gain.value = Math.max(0, Math.min(4, opts.inputGain ?? 1))
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.75

  const dest = ctx.createMediaStreamDestination()
  source.connect(gainNode)
  gainNode.connect(analyser)
  if (!opts.monitorOnly) gainNode.connect(dest)

  const mimeType = pickMimeType()
  const recorder = opts.monitorOnly
    ? null
    : new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined)

  const chunks: BlobPart[] = []
  const startedAt = performance.now()

  const analyserData = new Uint8Array(analyser.fftSize)

  recorder?.addEventListener('dataavailable', (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data)
  })

  const recordingStopped = new Promise<void>((resolve) => {
    if (!recorder) return resolve()
    recorder.addEventListener('stop', () => resolve())
  })

  if (recorder) {
    recorder.start(250)
  }

  const cleanup = () => {
    try {
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      /* ignore */
    }
    void ctx.close().catch(() => undefined)
  }

  const handle: RecordingHandle = {
    mimeType: mimeType || 'audio/webm',
    level() {
      analyser.getByteTimeDomainData(analyserData)
      let sum = 0
      for (let i = 0; i < analyserData.length; i++) {
        const v = (analyserData[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / analyserData.length)
      return Math.max(0, Math.min(1, rms * 3.2))
    },
    elapsedMs: () => performance.now() - startedAt,
    async stop() {
      const durationMs = performance.now() - startedAt
      if (recorder && recorder.state !== 'inactive') {
        recorder.requestData()
        recorder.stop()
        await recordingStopped
      }
      const type = mimeType || 'audio/webm'
      const blob = new Blob(chunks, { type })
      cleanup()
      return { blob, mimeType: type, durationMs, byteLength: blob.size }
    },
    abort() {
      try {
        if (recorder && recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      cleanup()
    }
  }

  return handle
}

/** 试音：采样 2.5 秒返回峰值电平 */
export async function testMicrophone(deviceId: string): Promise<{ peak: number; ok: boolean; message: string }> {
  const handle = await startRecording({ deviceId, monitorOnly: true })
  let peak = 0
  const start = performance.now()
  await new Promise<void>((resolve) => {
    const tick = () => {
      peak = Math.max(peak, handle.level())
      if (performance.now() - start > 2500) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  handle.abort()
  if (peak < 0.02) {
    return { peak, ok: false, message: '几乎没有检测到声音，请确认麦克风是否被静音或选错设备。' }
  }
  if (peak > 0.97) {
    return { peak, ok: true, message: '检测到声音，但音量过大可能爆音，建议调低输入增益。' }
  }
  return { peak, ok: true, message: '麦克风工作正常。' }
}
