/** IPC 频道常量（Main / Preload 共用，避免字符串散落） */
export const IPC = {
  appInfo: 'app:info',

  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsSetApiKey: 'settings:setApiKey',
  settingsClearApiKey: 'settings:clearApiKey',
  settingsTestConnection: 'settings:testConnection',
  settingsListModels: 'settings:listModels',
  settingsDiagnoseStt: 'settings:diagnoseStt',
  settingsChooseDataDir: 'settings:chooseDataDir',
  settingsOpenDataDir: 'settings:openDataDir',

  fileOpenPdfDialog: 'file:openPdfDialog',
  fileReadPdf: 'file:readPdf',
  fileReveal: 'file:reveal',
  fileOpenExternal: 'file:openExternal',
  fileSaveDialog: 'file:saveDialog',

  qsList: 'questionsets:list',
  qsGet: 'questionsets:get',
  qsSave: 'questionsets:save',
  qsDelete: 'questionsets:delete',
  qsUpdateQuestion: 'questionsets:updateQuestion',

  examCreate: 'exams:create',
  examSaveRecording: 'exams:saveRecording',
  examFinish: 'exams:finish',
  examGet: 'exams:get',
  examList: 'exams:list',
  examDelete: 'exams:delete',
  examReanalyze: 'exams:reanalyze',
  examDashboard: 'exams:dashboard',
  examClearAll: 'exams:clearAll',
  examProgress: 'exams:progress',

  audioRead: 'audio:read',
  audioDelete: 'audio:delete',
  audioPrompt: 'audio:prompt',
  audioPromptVoices: 'audio:promptVoices',
  audioPromptClearCache: 'audio:promptClearCache',
  audioReadPrompt: 'audio:readPrompt',

  ocrRecognize: 'ocr:recognize',
  pdfParseLlm: 'pdf:parseLlm',
  pdfParseProgress: 'pdf:parseProgress',

  reportExport: 'report:export',
  reportExportTo: 'report:exportTo'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
