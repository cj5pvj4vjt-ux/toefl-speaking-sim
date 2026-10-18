import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from './ipc/channels'
import type { TofeApi, PipelineProgressEvent, SettingsPatch } from '@shared/types/ipc'
import type { Question, QuestionSet } from '@shared/types'

/**
 * Preload：唯一的 Main ↔ Renderer 桥梁。
 *
 * 安全约定：
 *  - contextIsolation: true，nodeIntegration: false，sandbox: true
 *  - 只暴露白名单方法，不暴露 ipcRenderer / require / process
 *  - API Key 从不由 Renderer 读取，只能「写入」或「清除」
 */

const api: TofeApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),

  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    save: (patch: SettingsPatch) => ipcRenderer.invoke(IPC.settingsSave, patch),
    setApiKey: (which: 'llm' | 'stt', apiKey: string) =>
      ipcRenderer.invoke(IPC.settingsSetApiKey, which, apiKey),
    clearApiKey: (which: 'llm' | 'stt') => ipcRenderer.invoke(IPC.settingsClearApiKey, which),
    testConnection: (req) => ipcRenderer.invoke(IPC.settingsTestConnection, req),
    listModels: (req) => ipcRenderer.invoke(IPC.settingsListModels, req),
    diagnoseStt: () => ipcRenderer.invoke(IPC.settingsDiagnoseStt),
    chooseDataDir: () => ipcRenderer.invoke(IPC.settingsChooseDataDir),
    openDataDir: () => ipcRenderer.invoke(IPC.settingsOpenDataDir)
  },

  file: {
    openPdfDialog: () => ipcRenderer.invoke(IPC.fileOpenPdfDialog),
    readPdf: (p: string) => ipcRenderer.invoke(IPC.fileReadPdf, p),
    reveal: (p: string) => ipcRenderer.invoke(IPC.fileReveal, p),
    openExternal: (p: string) => ipcRenderer.invoke(IPC.fileOpenExternal, p),
    saveDialog: (defaultName: string, data: ArrayBuffer) =>
      ipcRenderer.invoke(IPC.fileSaveDialog, defaultName, data),
    /** 获取拖拽文件的真实路径（Electron 32+ 使用 webUtils） */
    pathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },

  questionSets: {
    list: () => ipcRenderer.invoke(IPC.qsList),
    get: (id: string) => ipcRenderer.invoke(IPC.qsGet, id),
    save: (set: QuestionSet) => ipcRenderer.invoke(IPC.qsSave, set),
    delete: (id: string) => ipcRenderer.invoke(IPC.qsDelete, id),
    updateQuestion: (setId: string, question: Question) =>
      ipcRenderer.invoke(IPC.qsUpdateQuestion, setId, question)
  },

  exams: {
    create: (req) => ipcRenderer.invoke(IPC.examCreate, req),
    saveRecording: (req) => ipcRenderer.invoke(IPC.examSaveRecording, req),
    finish: (examId: string) => ipcRenderer.invoke(IPC.examFinish, examId),
    get: (id: string) => ipcRenderer.invoke(IPC.examGet, id),
    list: (limit?: number) => ipcRenderer.invoke(IPC.examList, limit),
    delete: (id: string) => ipcRenderer.invoke(IPC.examDelete, id),
    reanalyze: (req) => ipcRenderer.invoke(IPC.examReanalyze, req),
    dashboard: () => ipcRenderer.invoke(IPC.examDashboard),
    clearAll: () => ipcRenderer.invoke(IPC.examClearAll),
    onProgress: (cb: (e: PipelineProgressEvent) => void) => {
      const listener = (_e: unknown, payload: PipelineProgressEvent) => cb(payload)
      ipcRenderer.on(IPC.examProgress, listener)
      return () => ipcRenderer.removeListener(IPC.examProgress, listener)
    }
  },

  pdf: {
    parseLlm: (pages: { page: number; text: string }[], concurrency?: number) =>
      ipcRenderer.invoke(IPC.pdfParseLlm, { pages, concurrency }),
    onParseProgress: (cb: (e: { done: number; total: number; message: string }) => void) => {
      const listener = (_e: unknown, payload: { done: number; total: number; message: string }) => cb(payload)
      ipcRenderer.on(IPC.pdfParseProgress, listener)
      return () => ipcRenderer.removeListener(IPC.pdfParseProgress, listener)
    }
  },

  audio: {
    read: (p: string) => ipcRenderer.invoke(IPC.audioRead, p),
    delete: (p: string) => ipcRenderer.invoke(IPC.audioDelete, p),
    prompt: (req: { text: string; voice?: string; rate?: number }) => ipcRenderer.invoke(IPC.audioPrompt, req),
    readPrompt: (p: string) => ipcRenderer.invoke(IPC.audioReadPrompt, p),
    promptVoices: () => ipcRenderer.invoke(IPC.audioPromptVoices),
    clearPromptCache: () => ipcRenderer.invoke(IPC.audioPromptClearCache)
  },

  ocr: {
    recognize: (image: ArrayBuffer, lang?: string) => ipcRenderer.invoke(IPC.ocrRecognize, image, lang ?? 'eng')
  },

  report: {
    export: (examId: string, studentName?: string) =>
      ipcRenderer.invoke(IPC.reportExport, examId, studentName),
    exportTo: (examId: string, filePath: string, studentName?: string) =>
      ipcRenderer.invoke(IPC.reportExportTo, examId, filePath, studentName)
  }
}

contextBridge.exposeInMainWorld('toefl', api)
