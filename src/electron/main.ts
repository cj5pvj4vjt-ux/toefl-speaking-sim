import { app, BrowserWindow, session, shell, systemPreferences } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { getDbPath, getDataRoot } from './services/paths'
import { closeDatabase, openDatabase } from '@database/db'
import { loadSettings } from './services/settingsStore'
import { logger } from './services/logger'

/**
 * Electron 主进程入口。
 *
 * 安全基线（不做任何削弱）：
 *   contextIsolation: true
 *   nodeIntegration: false
 *   sandbox: true
 *   webSecurity: true
 *   远程内容一律不加载，新窗口一律拒绝
 */

const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    backgroundColor: '#060A15',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    title: 'TOEFL 口语模考',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      // 考试是限时的：窗口失去焦点/被遮挡时不能让 Chromium 节流计时器，
      // 否则倒计时会变慢甚至停住（与渲染进程的墙钟计时构成双保险）。
      backgroundThrottling: false
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  // 拒绝一切新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // 阻止渲染进程被导航到外部地址
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    logger.warn('已阻止导航到外部地址', url)
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logger.error('渲染进程崩溃', details)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function hardenSession(): void {
  // 只允许本应用使用麦克风
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media')
  })
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media'
  })

  // 禁止加载远程内容（渲染进程完全离线）
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, cb) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const isDevAsset = !!devUrl && details.url.startsWith(devUrl)
    // 本地模型（Ollama）等请求都由主进程发起，渲染进程无需联网
    cb({ cancel: !isDevAsset })
  })
}

async function bootstrap(): Promise<void> {
  app.setName('TOEFL 口语模考')

  try {
    openDatabase(getDbPath())
    logger.info(`数据库已打开：${getDbPath()}`)
  } catch (e) {
    logger.error('数据库初始化失败，将使用内存数据库兜底', e)
    try {
      openDatabase(':memory:')
    } catch (e2) {
      logger.error('内存数据库同样失败', e2)
    }
  }

  try {
    loadSettings()
  } catch (e) {
    logger.error('设置加载失败', e)
  }

  hardenSession()
  registerIpc()
  createWindow()

  if (process.platform === 'darwin') {
    // 首次启动主动请求麦克风权限（未授权时系统会弹窗）
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone')
      if (status === 'not-determined') await systemPreferences.askForMediaAccess('microphone')
    } catch (e) {
      logger.debug('麦克风权限查询失败', e)
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(bootstrap).catch((e) => {
    logger.error('启动失败', e)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    closeDatabase()
    logger.info(`应用退出，数据目录：${getDataRoot()}`)
  })
}

process.on('uncaughtException', (err) => {
  logger.error('未捕获异常', err)
})
process.on('unhandledRejection', (reason) => {
  logger.error('未处理的 Promise 拒绝', reason)
})
