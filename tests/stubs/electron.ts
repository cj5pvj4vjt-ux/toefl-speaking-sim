/**
 * Electron 测试替身。
 * 只实现主进程服务层真正用到的那几个 API：
 *   app.getPath / app.getVersion / app.isPackaged / app.getName
 *   safeStorage.isEncryptionAvailable / encryptString / decryptString
 *
 * 测试可以通过环境变量 TOEFL_TEST_USERDATA 指定一个临时 userData 目录，
 * 从而让 paths.ts / logger.ts 把文件写到沙箱里而不是真实用户目录。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function resolveUserData(): string {
  const dir = process.env.TOEFL_TEST_USERDATA || path.join(os.tmpdir(), 'toefl-sim-test-userdata')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const USER_DATA = resolveUserData()

export const app = {
  getPath(name: string): string {
    if (name === 'userData') return USER_DATA
    const p = path.join(USER_DATA, name)
    fs.mkdirSync(p, { recursive: true })
    return p
  },
  getVersion(): string {
    return '1.0.0-test'
  },
  getName(): string {
    return 'TOEFL Speaking Sim'
  },
  get isPackaged(): boolean {
    return false
  }
}

/** 与 Electron 行为等价的确定性假加密（仅测试用） */
export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return process.env.TOEFL_TEST_NO_ENCRYPTION !== '1'
  },
  encryptString(plain: string): Buffer {
    if (!this.isEncryptionAvailable()) throw new Error('encryption unavailable')
    return Buffer.concat([Buffer.from('TESTCIPHER:'), Buffer.from(plain, 'utf8')])
  },
  decryptString(buf: Buffer): string {
    const s = buf.toString('utf8')
    if (!s.startsWith('TESTCIPHER:')) throw new Error('bad ciphertext')
    return s.slice('TESTCIPHER:'.length)
  }
}

const handlers = new Map<string, (event: unknown, ...args: any[]) => any>()

export const ipcMain = {
  handle(channel: string, fn: (event: unknown, ...args: any[]) => any): void {
    handlers.set(channel, fn)
  },
  removeHandler(channel: string): void {
    handlers.delete(channel)
  }
}

/** 测试用：像渲染进程那样调用一个已注册的 IPC handler */
export async function invokeIpc(channel: string, ...args: unknown[]): Promise<any> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`IPC handler 未注册：${channel}`)
  return await fn({ sender: null }, ...args)
}

export function registeredChannels(): string[] {
  return [...handlers.keys()].sort()
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
  showSaveDialog: async () => ({ canceled: true, filePath: undefined })
}

export const shell = {
  openPath: async () => '',
  showItemInFolder: () => {},
  openExternal: async () => {}
}

export const BrowserWindow = class {}
export const session = { defaultSession: {} }
export const nativeTheme = { shouldUseDarkColors: true }
export const webUtils = { getPathForFile: () => '' }
export const contextBridge = { exposeInMainWorld: () => {} }
export const ipcRenderer = { invoke: async () => undefined, on: () => {}, removeAllListeners: () => {} }
