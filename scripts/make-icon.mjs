#!/usr/bin/env node
/**
 * 从白底图标里抠出透明背景，并生成 macOS .icns。
 *
 * 为什么需要这个脚本：图像生成服务返回的是 JPEG，没有 alpha 通道，
 * 而 macOS 的 App 图标必须是「圆角矩形 + 外部完全透明」。
 * 直接对白色做 colorkey 会把麦克风（也是白色）一起打穿，
 * 所以这里用「从四边洪水填充 + 边缘反走样还原」的方式只抠外部背景。
 *
 * 用法：node scripts/make-icon.mjs <输入图片> [输出目录]
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const input = process.argv[2]
const outDir = process.argv[3] || path.join(root, 'resources')

if (!input || !fs.existsSync(input)) {
  console.error('用法：node scripts/make-icon.mjs <输入图片> [输出目录]')
  process.exit(1)
}

const SIZE = 1024
const tmpPng = path.join(outDir, '.icon-src.png')

fs.mkdirSync(outDir, { recursive: true })

/* ---------------- 1. 统一转成 1024×1024 的 PNG ---------------- */
execFileSync('sips', ['-s', 'format', 'png', '-z', String(SIZE), String(SIZE), input, '--out', tmpPng], {
  stdio: 'ignore'
})

const png = PNG.sync.read(fs.readFileSync(tmpPng))
const { width: W, height: H, data } = png
console.log(`源图：${W}×${H}`)

const idx = (x, y) => (y * W + x) * 4
const minChannel = (i) => Math.min(data[i], data[i + 1], data[i + 2])

/* ---------------- 2. 从四条边洪水填充，找出真正的「外部背景」 ---------------- */
// JPEG 有压缩噪声，纯白不会正好是 255，阈值放宽一点
const WHITE = Number(process.env.ICON_WHITE_THRESHOLD ?? 232)
const isWhite = new Uint8Array(W * H)
for (let p = 0; p < W * H; p++) isWhite[p] = minChannel(p * 4) >= WHITE ? 1 : 0

const isBg = new Uint8Array(W * H)
const stack = []
for (let x = 0; x < W; x++) {
  stack.push(x, 0, x, H - 1)
}
for (let y = 0; y < H; y++) {
  stack.push(0, y, W - 1, y)
}
let bgCount = 0
while (stack.length) {
  const y = stack.pop()
  const x = stack.pop()
  if (x < 0 || y < 0 || x >= W || y >= H) continue
  const p = y * W + x
  if (isBg[p] || !isWhite[p]) continue
  isBg[p] = 1
  bgCount++
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1)
}
console.log(`外部背景像素：${bgCount}（${((bgCount / (W * H)) * 100).toFixed(1)}%）`)

/* ---------------- 3. 计算每个前景像素到背景的距离（限制 3 像素） ---------------- */
const dist = new Uint8Array(W * H).fill(255)
const queue = []
for (let p = 0; p < W * H; p++) {
  if (isBg[p]) {
    dist[p] = 0
    queue.push(p)
  }
}
let head = 0
while (head < queue.length) {
  const p = queue[head++]
  if (dist[p] >= 3) continue
  const x = p % W
  const y = (p - x) / W
  const next = []
  if (x > 0) next.push(p - 1)
  if (x < W - 1) next.push(p + 1)
  if (y > 0) next.push(p - W)
  if (y < H - 1) next.push(p + W)
  for (const n of next) {
    if (dist[n] > dist[p] + 1) {
      dist[n] = dist[p] + 1
      queue.push(n)
    }
  }
}

/* ---------------- 4. 写入 alpha ---------------- */
// 边缘反走样还原：像素颜色 C = t·白 + (1-t)·底色，
// 则 min(C) 随 t 线性变化，alpha = 255·(1-t)。
// 只对「紧贴背景、且明显偏亮」的像素套用，避免把内部的白色麦克风打穿。
const TILE_MIN = 11 // 深色底的最低通道值
let ramped = 0
for (let p = 0; p < W * H; p++) {
  const i = p * 4
  if (isBg[p]) {
    data[i + 3] = 0
    continue
  }
  const m = minChannel(i)
  if (dist[p] >= 1 && dist[p] <= 3 && m > 30) {
    const t = Math.min(1, Math.max(0, (m - TILE_MIN) / (255 - TILE_MIN)))
    let a = Math.round(255 * (1 - t))
    // 距离背景越远，越应当保留不透明，避免边缘出现一圈半透明灰
    a = Math.max(a, Math.round((255 * (dist[p] - 1)) / 3))
    data[i + 3] = Math.min(255, Math.max(0, a))
    ramped++
  } else {
    data[i + 3] = 255
  }
}
console.log(`边缘反走样像素：${ramped}`)

const outPng = path.join(outDir, 'icon.png')
fs.writeFileSync(outPng, PNG.sync.write(png))
console.log(`已写入：${outPng}`)

/* ---------------- 5. 生成 .icns ---------------- */
const iconset = path.join(outDir, 'icon.iconset')
fs.rmSync(iconset, { recursive: true, force: true })
fs.mkdirSync(iconset, { recursive: true })

const specs = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]
for (const [size, name] of specs) {
  execFileSync('sips', ['-z', String(size), String(size), outPng, '--out', path.join(iconset, name)], {
    stdio: 'ignore'
  })
}

const icns = path.join(outDir, 'icon.icns')
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icns])
fs.rmSync(iconset, { recursive: true, force: true })
fs.rmSync(tmpPng, { force: true })

console.log(`已写入：${icns}（${(fs.statSync(icns).size / 1024).toFixed(0)} KB）`)
