import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfPageText } from '@shared/types'
import { buildPageText, type PdfTextItemLike } from '@shared/pdf/pageText'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfDocHandle {
  doc: pdfjsLib.PDFDocumentProxy
  totalPages: number
  title: string
  encrypted: boolean
}

export interface ExtractOutcome {
  pages: PdfPageText[]
  totalPages: number
  pagesWithText: number
  likelyScanned: boolean
  warnings: string[]
  title: string
}

const TEXT_MIN_CHARS = 25

/** 载入 PDF（字节来自主进程，渲染进程不接触 Node API） */
export async function loadPdf(data: ArrayBuffer, password?: string): Promise<PdfDocHandle> {
  let doc: pdfjsLib.PDFDocumentProxy
  try {
    const task = pdfjsLib.getDocument({
      data: new Uint8Array(data),
      password,
      useSystemFonts: true,
      // 渲染进程完全离线，不加载任何外部资源
      disableFontFace: false,
      cMapPacked: true
    })
    doc = await task.promise
  } catch (e) {
    const err = e as { name?: string; message?: string }
    if (err?.name === 'PasswordException') {
      throw new Error('该 PDF 已加密，需要密码才能打开')
    }
    if (err?.name === 'InvalidPDFException') {
      throw new Error('文件损坏或不是有效的 PDF')
    }
    throw new Error(`PDF 打开失败：${err?.message ?? String(e)}`)
  }

  const meta = await doc.getMetadata().catch(() => null)
  const info = (meta?.info ?? {}) as { Title?: string }
  return {
    doc,
    totalPages: doc.numPages,
    title: (info.Title ?? '').trim(),
    encrypted: false
  }
}

/** 逐页提取文本 */
export async function extractText(
  handle: PdfDocHandle,
  onProgress?: (done: number, total: number) => void
): Promise<ExtractOutcome> {
  const pages: PdfPageText[] = []
  const warnings: string[] = []
  let pagesWithText = 0

  for (let i = 1; i <= handle.totalPages; i++) {
    try {
      const page = await handle.doc.getPage(i)
      const content = await page.getTextContent()
      const text = buildPageText(content.items as PdfTextItemLike[])
      const chars = text.replace(/\s/g, '').length
      if (chars >= TEXT_MIN_CHARS) pagesWithText++
      pages.push({ page: i, text })
      page.cleanup()
    } catch (e) {
      warnings.push(`第 ${i} 页解析失败：${(e as Error).message}`)
      pages.push({ page: i, text: '' })
    }
    onProgress?.(i, handle.totalPages)
  }

  const likelyScanned = handle.totalPages > 0 && pagesWithText / handle.totalPages < 0.5
  if (likelyScanned) {
    warnings.push(
      `检测到 ${handle.totalPages - pagesWithText}/${handle.totalPages} 页几乎没有文字层，这份 PDF 很可能是扫描件。可以尝试 OCR 识别，或手动录入题目。`
    )
  }
  return {
    pages,
    totalPages: handle.totalPages,
    pagesWithText,
    likelyScanned,
    warnings,
    title: handle.title
  }
}


/** 把某页渲染成 PNG 字节（供主进程 OCR 使用） */
export async function renderPageToPng(
  handle: PdfDocHandle,
  pageNumber: number,
  scale = 2
): Promise<Uint8Array> {
  const page = await handle.doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.min(4000, Math.floor(viewport.width))
  canvas.height = Math.min(4000, Math.floor(viewport.height))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布用于 OCR')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  page.cleanup()
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画布导出失败'))), 'image/png')
  )
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

export async function closePdf(handle: PdfDocHandle | null): Promise<void> {
  try {
    const d = handle?.doc as unknown as { destroy?: () => Promise<void> } | undefined
    await d?.destroy?.()
  } catch {
    /* ignore */
  }
}

export type { pdfjsLib }
