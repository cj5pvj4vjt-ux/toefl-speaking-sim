#!/usr/bin/env node
/**
 * 生成一份仿真 TOEFL Speaking 真题 PDF（用于开发与端到端验证）。
 *
 * 用法：node scripts/make-sample-pdf.mjs [输出路径]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import PDFDocument from 'pdfkit'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'samples', 'essentials-sample-speaking.txt')
const out = process.argv[2] || path.join(root, 'samples', 'essentials-sample-speaking.pdf')

const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf'
]
const font = FONT_CANDIDATES.find((p) => fs.existsSync(p))

const text = fs.readFileSync(src, 'utf8')
fs.mkdirSync(path.dirname(out), { recursive: true })

const doc = new PDFDocument({ size: 'A4', margin: 54, info: { Title: 'TOEFL Speaking Sample' } })
const stream = fs.createWriteStream(out)
doc.pipe(stream)
if (font) doc.font(font)
doc.fontSize(11)

for (const line of text.split('\n')) {
  doc.text(line.length ? line : ' ', { lineGap: 2 })
}

doc.end()
await new Promise((resolve) => stream.on('finish', resolve))

console.log(`PDF 已生成：${out}`)
console.log(`大小：${fs.statSync(out).size} bytes`)
