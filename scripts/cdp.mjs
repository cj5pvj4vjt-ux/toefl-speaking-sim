#!/usr/bin/env node
/**
 * 本地验证工具：通过 Chrome DevTools Protocol 连接正在运行的 Electron 渲染进程。
 * 用途：在无法使用屏幕录制权限时，读取真实 DOM、点击按钮、截取渲染画面。
 *
 * 用法：
 *   node scripts/cdp.mjs text
 *   node scripts/cdp.mjs eval "document.title"
 *   node scripts/cdp.mjs click "button:has-text(导入)"
 *   node scripts/cdp.mjs shot /tmp/a.png
 */
import fs from 'node:fs'

const PORT = process.env.CDP_PORT || 9222
const BASE = `http://127.0.0.1:${PORT}`

async function findPage() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('找不到可调试的页面目标')
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pending = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`CDP 超时: ${method}`))
        }
      }, Number(process.env.CDP_TIMEOUT_MS || 60000))
    })
  }
  async evaluate(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true
    })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails))
    }
    return r.result?.value
  }
}

async function connect() {
  const page = await findPage()
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const cdp = new Cdp(ws)
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  return { cdp, ws, page }
}

const [cmd, ...rest] = process.argv.slice(2)
const { cdp, ws } = await connect()

try {
  switch (cmd) {
    case 'text': {
      console.log(await cdp.evaluate('document.body.innerText'))
      break
    }
    case 'html': {
      console.log(await cdp.evaluate('document.body.innerHTML'))
      break
    }
    case 'evalfile': {
      // 从文件读取表达式，避免把密钥写进命令行；
      // 文件里用 __INJECT__ 占位，由环境变量 CDP_INJECT 替换。
      const expr = fs
        .readFileSync(rest[0], 'utf8')
        .replace(/__INJECT__/g, process.env.CDP_INJECT ?? '')
      const v = await cdp.evaluate(expr)
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
      break
    }
    case 'eval': {
      const v = await cdp.evaluate(rest.join(' '))
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
      break
    }
    case 'click': {
      const sel = JSON.stringify(rest.join(' '))
      const out = await cdp.evaluate(`(() => {
        const norm = (s) => (s || '').replace(/\\s+/g, '');
        const all = Array.from(document.querySelectorAll('button, a, [role="button"], option'));
        const target = all.find((el) => norm(el.textContent).includes(norm(${sel})));
        if (!target) return 'NOT_FOUND: ' + ${sel};
        target.click();
        return 'CLICKED: ' + (target.textContent || '').trim().slice(0, 60);
      })()`)
      console.log(out)
      break
    }
    case 'shot': {
      const path = rest[0] || '/tmp/cdp-shot.png'
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
      fs.writeFileSync(path, Buffer.from(r.data, 'base64'))
      console.log('SAVED ' + path)
      break
    }
    case 'console': {
      const logs = await cdp.evaluate('JSON.stringify(window.__smokeLogs || [])')
      console.log(logs)
      break
    }
    default:
      console.log('未知命令: ' + cmd)
  }
} finally {
  ws.close()
}
