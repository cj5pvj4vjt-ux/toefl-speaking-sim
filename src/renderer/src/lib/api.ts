import type { TofeApi } from '@shared/types/ipc'

/**
 * Renderer 访问主进程的唯一入口。
 * 任何情况下都不直接使用 Node.js API。
 */

function getApi(): TofeApi {
  const api = (globalThis as unknown as { toefl?: TofeApi }).toefl
  if (!api) {
    throw new Error('Preload 未加载：无法访问主进程 API')
  }
  return api
}

export const api: TofeApi = new Proxy({} as TofeApi, {
  get(_t, prop: string) {
    return (getApi() as unknown as Record<string, unknown>)[prop]
  }
})

export function hasApi(): boolean {
  return !!(globalThis as unknown as { toefl?: unknown }).toefl
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
