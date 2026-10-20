# TOEFL 口语模考 · TOEFL Speaking 全真模拟考试系统

一个真正能用的 macOS 桌面应用：导入真实 TOEFL Speaking 真题 PDF → 自动解析分类 → 全真模拟考试（倒计时 + 录音）→ 语音转写 → 云端大模型按 ETS 官方量表评分 → 可视化报告 → PDF 导出。

覆盖导入、组卷、考试、评分、报告、导出的完整流程，可直接打包分发。

## 0. 对齐 2026 新托福口语

整套考试 **2 个大题、11 道小题、约 15 分钟**，与官方完全一致：

| 大题 | 题号 | 说明 | 准备 | 作答 |
|---|---|---|---|---|
| **Listen and Repeat** | 1–7 | 屏幕**只显示场景说明**，句子只播一遍，听完立刻复述 | 0 秒 | 8 / 10 / 12 秒（按句子长度分档） |
| **Take an Interview** | 8–11 | 面试官提问只播一遍，随后作答 | 0 秒 | 45 秒 |

- **不能重听**，也**不能延后**：音频只播一遍，倒计时到点自动保存并进入下一题，考生只能提前结束本题。
- 面试题在提问播完后才显示问题文本。
- 评分按 ETS 三个维度（Delivery / Language Use / Topic Development）1–6 分档、0.5 步长，总分取平均。
- **专项练习**：可选只考 Listen and Repeat（7 题）或只考 Take an Interview（4 题）。
- 出题按**整套**抽题

---

## 1. 打包产物

| 文件 | 说明 |
|---|---|
| `TOEFL-Speaking-Sim-1.0.0-arm64.dmg` | arm64，拖拽安装 |
| `release/mac-arm64/TOEFL 口语模考.app` | 解包后可直接运行 |

安装：双击 DMG → 把 App 拖进 Applications。首次启动需在「系统设置 → 隐私与安全性 → 麦克风」中授权。

未做代码签名（`identity: null`），所以首次打开会被 Gatekeeper 拦下，右键 →「打开」即可。

---

## 2. 技术栈

Electron 44 · TypeScript 5 · React 19 · Vite 7 · electron-vite · electron-builder
Zustand 5（状态）· Tailwind 3.4（样式）· Recharts 3（图表）· Zod 4（校验）
pdfjs-dist 6（PDF 解析）· pdfkit（报告生成）· tesseract.js 7（扫描版 OCR）
**`node:sqlite`**（Node 内置，零原生依赖、无需 ABI 重编译）

---

## 3. 目录结构

```
src/
├── electron/                 主进程
│   ├── main.ts               窗口 / 麦克风权限 / 安全策略
│   ├── preload.ts            contextBridge，唯一的 IPC 出口
│   ├── ipc/index.ts          所有 IPC handler
│   └── services/
│       ├── settingsStore.ts  safeStorage 加密的配置存储
│       ├── llm/openaiCompatible.ts  OpenAI 兼容客户端（/models、/chat/completions、/audio/transcriptions）
│       ├── scoring/engine.ts 评分引擎：ETS Prompt + 宽松 JSON 解析 + Zod 校验 + 修复重试
│       ├── exam/pipeline.ts  转写 → 评分 → 总结 的流水线
│       ├── reports/pdfReport.ts     中文 PDF 报告
│       ├── stt/  ocr/  audioStorage.ts  paths.ts  logger.ts
├── renderer/src/             渲染进程
│   ├── pages/                Dashboard / Import / Library / ExamSetup / ExamRoom / Report / History / Settings
│   ├── components/  stores/  lib/
├── shared/                   主进程与渲染进程共用
│   ├── types/  schemas/  constants/
│   ├── pdf/parseQuestions.ts PDF 文本 → 结构化题目（Task 分类 / 时间 / 阅读 / 听力）
│   ├── scoring/prompts.ts    ETS 官方评分 Prompt
│   └── scoring/convert.ts    原始分聚合与分档
└── database/                 node:sqlite 封装 + 仓储层
```

---

## 4. 安全设计

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`
- 渲染进程**完全离线**：`session.webRequest` 拦截并取消渲染进程发出的所有 `http(s)`（dev server 除外）；所有网络请求（LLM / STT / OCR）都经主进程
- 单实例锁、`setWindowOpenHandler` 一律 deny、`will-navigate` 拦截、权限处理器只放行 `media`
- **API Key 只在主进程**：`safeStorage` 加密（`enc1:`）后落盘，渲染进程只能拿到 `apiKeySet: boolean` 与掩码预览（`Ltx••••••10F2`）。不进前端代码、不进 localStorage、不进日志

---

## 5. 评分设计

严格遵循 ETS 官方量表（2026 新版托福）：

- **每道题整体分 0–6**，同时给出三个维度：Delivery / Language Use / Topic Development（各 0–6）
- **每个任务的单项分 = 该任务下所有回答的平均分**，报 **1–6**、0.5 递增
- 报告中的 `Raw Total` 是全部回答的**平均原始分**（0–6），与单项分同口径
- 模型被强制返回固定 JSON：

```json
{ "task": 1, "score": 0, "delivery": 0, "language_use": 0,
  "topic_development": 0, "feedback": "", "confidence": 0,
  "revised_response": "" }
```

其中 `revised_response` 是 **AI 修改后的回答**：保留考生原本的观点与个人细节，
只改进语法、用词、句子结构与组织方式，在报告页和 PDF 里与「你的回答」并排展示。

工程上的三重保障：

1. **宽松 JSON 解析** —— 剥代码围栏、找第一个平衡的 `{...}`、修复尾随逗号/单引号
2. **Zod 严格校验** —— 分数域裁剪、四舍五入到 0.5、空反馈拒绝；`task` 字段由 App 侧强制覆盖，模型写错也不会污染数据
3. **修复重试** —— 校验失败时带着错误原因重试；重试轮自动放开 `json_schema` 约束（部分厂商的约束解码会截断输出）

报告里的估算分标注为 **Estimated**，表示这是模型按官方量表给出的估分，不等同于 ETS 官方成绩。

---

## 6. 云端模型绑定

App 内直接完成，无需改代码：

设置 → AI 评分 → 填 Base URL → 填 API Key → 保存密钥 → **测试连接 / 获取模型列表** → 选择模型 → 绑定。

任何 OpenAI 兼容端点都能用（OpenAI / DeepSeek / Moonshot / 阿里云百炼 / 智谱 / SiliconFlow / OpenRouter / 本地 Ollama / 自定义）。内置常见服务商一键填充。

STT 同样支持云端 OpenAI 兼容接口与本地 Whisper 离线转写。

### 题目语音（TTS）

Listen and Repeat 靠「听」出题，音色直接决定练习质量，所以默认走**云端 TTS**，而不是系统机械音：

设置 → 题目语音 → 选**云端 TTS** → 选模型（`qwen3-tts-flash`）→ 选音色（Serena / Ethan / Cherry …）→ **试听示例句** → 调语速。

- 云端地址与密钥**默认沿用「AI 评分」那一套**，不用重复填；也可以单独指定。
- 云端不可用时**自动回退**到 macOS `say`，考试流程不会被网络问题卡死。
- **语速**：实测该模型在 `speed=1.0` 时只有约 135 wpm（且 `speed` 参数被忽略），
  官方听力材料约 150–165 wpm，因此改在**播放端变速**（Chromium 保持音高，不会变怪声）。
  默认 `1.15× ≈ 155 wpm`，设置页可实时试听微调。
- 合成结果按「音源 + 文本 + 音色 + 语速」哈希缓存，同一句只合成一次。

---

## 7. 开发

```bash
npm install
npm run dev          # 开发模式
npm run typecheck    # 主进程 + 渲染进程类型检查
npm test             # 单元 + 端到端测试
npm run dist:mac     # 打包 arm64 DMG
```

生成样例 PDF 与端到端联调（需要你自己的 API Key）：

```bash
node scripts/make-sample-pdf.mjs

TOEFL_LIVE_LLM=1 \
TOEFL_LLM_BASE_URL=https://api.modelverse.cn/v1 \
TOEFL_LLM_API_KEY=sk-xxx \
TOEFL_LLM_MODEL=deepseek-v4.1-flash \
npx vitest run tests/live-llm.test.ts
```

真实云端联调测试默认跳过，不会在 `npm test` 时消耗额度；Key 只从环境变量读取。

---

## 8. 测试

覆盖 PDF 解析与组卷、评分引擎与 JSON 修复、原始分聚合、数据库、录音落盘、PDF 报告、IPC 契约与端到端流程；真实云端联调默认跳过，不消耗额度。


---

## 9. 数据位置

```
~/Library/Application Support/toefl-speaking-sim/data/
├── toefl-speaking.db          题库 / 考试记录
├── settings.json              配置（API Key 为 safeStorage 密文）
├── recordings/<examId>/       每题一个 .webm + .json
├── reports/                   导出的 PDF 报告
└── logs/
```

---

## 10. 已知限制

- 未做代码签名与公证，首次启动需手动放行
- 扫描版 PDF 的 OCR 依赖 tesseract.js 运行时从 CDN 下载英文语言包，首次使用需联网
- 整场总结在少数情况下需要 1–2 次重试（推理型模型偶尔不按 JSON 输出），已有自动修复兜底

---

## 11. 安装包下载

`v1.0.0` 的 DMG 已作为 [GitHub Release](https://github.com/cj5pvj4vjt-ux/toefl-speaking-sim/releases) 附件发布，无需 clone 仓库即可下载：

- **文件**：`TOEFL-Speaking-Sim-1.0.0-arm64.dmg`（macOS arm64）
- **SHA-256**：`373dbbd3fc378ad21a5fea78317ea3a0b43892e31a0c51281dc1fb14eb5fa400`
- 未签名，首次打开需右键 →「打开」放行；麦克风权限在「系统设置 → 隐私与安全性」中授予

安装包不进入 git 历史（`*.dmg` 已在 `.gitignore` 中排除），只作为 Release 附件分发。

---

## 12. 许可证

[MIT](./LICENSE) © 2026 TOEFL Sim
