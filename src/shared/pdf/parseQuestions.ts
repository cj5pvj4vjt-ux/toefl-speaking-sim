import { TASK_META } from '../constants'
import { pickQuestionsForMode } from '../scoring/convert'
import type { ExamMode, Question, TaskType } from '../types'

/**
 * TOEFL Essentials Speaking 题组的规则解析。
 *
 * 题组（一套完整 Speaking section）的典型形态：
 *
 *   2026年1月21日 第1套
 *   1-7. <场景说明> Listen to ... and repeat what he says. Repeat only once.
 *     1. <要跟读的句子>
 *     ...
 *     7. <要跟读的句子>
 *   8-11 <面试场景说明> ... will ask you some questions ...
 *     8. <面试问题>
 *     ...
 *     11. <面试问题>
 *   Question 8 <参考答案>  ... Question 11 <参考答案>
 *
 * 排版不统一、参考文献干扰、扫描件等复杂情况交给 LLM 解析兜底（见 llmParse.ts）。
 */

export interface PageText {
  page: number
  text: string
}

export interface ParseResult {
  questions: Question[]
  warnings: string[]
  stats: { detected: number; parsed: number; needsReview: number; groups: number }
}

/* ------------------------------ 文本归一化 ------------------------------ */

export function normalizePageText(raw: string): string {
  let s = raw ?? ''
  s = s.replace(/\r\n?/g, '\n')
  s = s.replace(/\u00a0/g, ' ')
  s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  // 连字符断行： "informa-\ntion" → "information"
  s = s.replace(/([A-Za-z])-\n([a-z])/g, '$1$2')
  s = s
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, '  ').trimEnd())
    .join('\n')
  s = normalizeHeaderSpacing(s)
  return collapseGlyphSpacing(s)
}

/**
 * 还原被空格拆散的日期与套号。
 *
 * 真实真题库的 PDF 里经常出现 "20 2 6 年 1 月 28 日 第 2 套" 这种形状，
 * 而 collapseGlyphSpacing 只处理「单字符」token，抓不住 "20" 这种两字符片段，
 * 结果题组切分失效 —— 后面套题的参考答案会串到前面套题的题号上。
 * 这里用严格的日期/套号上下文来还原，不会误伤普通正文。
 */
export function normalizeHeaderSpacing(text: string): string {
  return text
    .replace(
      /((?:\d\s*){2,6})年\s*((?:\d\s*){1,3})月\s*((?:\d\s*){1,3})日/g,
      (_m, y: string, mo: string, d: string) =>
        `${y.replace(/\s/g, '')}年${mo.replace(/\s/g, '')}月${d.replace(/\s/g, '')}日`
    )
    .replace(/第\s*((?:\d\s*){1,3})套/g, (_m, n: string) => `第${n.replace(/\s/g, '')}套`)
    .replace(/【\s*(\d{4})\s*年/g, '【$1年')
}

/**
 * 修复 PDF 抽取时的「逐字拆开」噪声。
 *
 * 某些 PDF 的每个字形是独立文本对象，抽取后字与字之间会多出空格，
 * 于是 "2026年1月21日第1套" 变成 "2 0 2 6 年 1 月 2 1 日 第 1 套"。
 * 规则：连续 3 个以上「单字符」token 直接无缝拼接。
 * 这个模式在正常英文里几乎不出现，所以误伤概率很低。
 */
export function collapseGlyphSpacing(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const tokens = line.split(' ')
      const out: string[] = []
      let run: string[] = []
      const flush = (): void => {
        if (run.length >= 3) out.push(run.join(''))
        else if (run.length > 0) out.push(...run)
        run = []
      }
      for (const tk of tokens) {
        if (tk.length === 1) run.push(tk)
        else {
          flush()
          out.push(tk)
        }
      }
      flush()
      return out.join(' ')
    })
    .join('\n')
}

let idSeq = 0
export function newId(prefix = 'q'): string {
  idSeq += 1
  return `${prefix}_${Date.now().toString(36)}_${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* ------------------------------ 正则 ------------------------------ */

const RE_DATE = /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/
const RE_SET_NO = /第\s*(\d{1,2})\s*套/
/** 「口语 1」「口语3」这类没写「第N套」的套号 */
const RE_SET_NO_ALT = /口语\s*(\d{1,2})/
/** "1-7." / "8–11" 这类题号区间标题 */
const RE_RANGE_HDR = /^\s*(\d{1,2})\s*[-–—~]\s*(\d{1,2})\s*[.．、]?\s*/
/** "1. Milk and Yogurt..." —— 带点号的编号 */
const RE_ITEM_DOT = /^\s*(\d{1,2})\s*[.．、]\s*(.*)$/
/** "1 Milk and Yogurt..." —— 空格分隔的编号（后面像句子开头） */
const RE_ITEM_BARE = /^\s*(\d{1,2})\s+(?=[A-Z"'(“])(.+)$/
/** 参考答案块的起点。注意 PDF 里常见 "Question 8Yes, I have..." 这种数字与正文粘连 */
const RE_REF_START = /^\s*Questions?\s*(\d{1,2})(?!\d)\s*[.。:：]?\s*(.*)$/i
/** 整行就是 "Question 8" */
const RE_REF_BARE = /^\s*Questions?\s*(\d{1,2})(?!\d)\s*$/i

/** 判定为「面试部分」的提示词 */
const RE_INTERVIEW = /(interview|面试|ask you some questions)/i
/** 判定为「跟读部分」的提示词 */
const RE_REPEAT = /(repeat what|listen and repeat|repeat only once|repeat after)/i
/** 判定为「朗读部分」的提示词 */
const RE_READ_ALOUD = /(read aloud|read the part|朗读)/i
/** 参考答案起始标记：【文】【答案】【范文】等 */
const RE_REF_MARK = /【\s*(?:参考)?\s*(?:范文|答案|文)\s*\d?\s*】/
/** 参考答案的第二版本标记：【简单版】【范文1】等，属于同一题的另一个版本 */
const RE_REF_VARIANT = /【\s*(?:简单版|简易版|范文\s*\d|答案\s*\d|第\d+版)\s*】/

/* ------------------------------ 题组切分 ------------------------------ */

interface SetBlock {
  label: string
  lines: { text: string; page: number }[]
  page: number
}

function makeLabel(line: string, fallbackIndex: number, page?: number): string {
  const d = line.match(RE_DATE)
  const n = line.match(RE_SET_NO) ?? line.match(RE_SET_NO_ALT)
  const date = d ? `${d[1]}-${d[2].padStart(2, '0')}-${d[3].padStart(2, '0')}` : ''
  const no = n ? `第${n[1]}套` : ''
  if (date) return [date, no].filter(Boolean).join(' ')
  // 只有「第N套」而没有日期时，同一份文档里会出现好几个「第1套」，
  // 加上页码才能区分，也方便回原 PDF 核对
  if (no) return page ? `${no} · 第 ${page} 页` : no
  // 标题行里没有日期也没有套号：用页码定位，比「题组 3」有用得多
  return page ? `第 ${page} 页题组` : `第 ${fallbackIndex} 题组`
}

/**
 * 题组标题：日期（可带「第N套」或「口语 N」）或单独的「第N套」。
 * 真实真题库里这几种写法都出现过。
 */
const RE_HEADER_ANY =
  /(20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)(?:\s*(?:第\s*\d{1,2}\s*套|口语\s*\d{1,2}))?|第\s*\d{1,2}\s*套/g

/** 「问题 10：」「答案：」这种中英混排的参考答案标记 */
const RE_CN_QUESTION = /^\s*问题\s*(\d{1,2})\s*[:：.。、]?\s*(.*)$/
const RE_CN_ANSWER = /^\s*答案\s*[:：.。、]?\s*(.*)$/

/**
 * 把整份文档切成一个个题组。
 *
 * 关键点：标题必须出现在行首才算数。
 * 正文里也会出现「参考3月10日第1套」这类引用，不能当成新题组；
 * 但同一行里可能连着两个标题（"2026年1月27日3套 = 2月11日2026年1月21日第2套You are..."），
 * 所以行首命中后要把整行按所有标题位置切开。
 */
function splitSets(pages: PageText[]): SetBlock[] {
  const blocks: SetBlock[] = []
  let current: SetBlock | null = null

  const startBlock = (label: string, page: number): void => {
    if (current && current.lines.length > 0) blocks.push(current)
    current = { label, lines: [], page }
  }

  for (const p of pages) {
    const text = normalizePageText(p.text)
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue

      RE_HEADER_ANY.lastIndex = 0
      const cuts: number[] = []
      let m: RegExpExecArray | null
      while ((m = RE_HEADER_ANY.exec(line)) !== null) cuts.push(m.index)

      if (cuts.length > 0 && cuts[0] === 0) {
        // 行首是标题：按每个标题位置切段，每段开启一个新题组
        for (let i = 0; i < cuts.length; i++) {
          const seg = line.slice(cuts[i], i + 1 < cuts.length ? cuts[i + 1] : undefined).trim()
          if (!seg) continue
          startBlock(makeLabel(seg, blocks.length + 1, p.page), p.page)
          current!.lines.push({ text: seg, page: p.page })
        }
        continue
      }

      if (!current) current = { label: `第 ${p.page} 页题组`, lines: [], page: p.page }
      current.lines.push({ text: line, page: p.page })
    }
  }
  if (current && current.lines.length > 0) blocks.push(current)

  // 同一套题在翻页处常常重复出现标题，会被切成相邻的两块，这里先合并回去
  const merged: SetBlock[] = []
  for (const b of blocks.filter((x) => x.lines.length > 0)) {
    const prev = merged[merged.length - 1]
    if (prev && prev.label === b.label) {
      prev.lines.push(...b.lines)
    } else {
      merged.push({ ...b, lines: [...b.lines] })
    }
  }

  // 标签必须唯一，否则不同套题的题目会被当成同一组（组卷时会串题）
  const used = new Map<string, number>()
  return merged.map((b) => {
    const n = (used.get(b.label) ?? 0) + 1
    used.set(b.label, n)
    return { ...b, label: n === 1 ? b.label : `${b.label}#${n}` }
  })
}

/* ------------------------------ 题组解析 ------------------------------ */

interface RawItem {
  no: number
  text: string
  page: number
  interview: boolean
}

type ZoneKind = 'repeat' | 'interview'

/**
 * 剥掉括号里的编辑备注。
 *
 * 真实真题库里会写「2026 年 5 月 5 日新题（此套仅 interview 是新题）」这种页眉，
 * 备注里的 "interview" 会把整段跟读题误判成面试题。
 */
function stripNotes(text: string): string {
  return text.replace(/[（(][^）)]{0,120}[）)]/g, ' ')
}

/** 一段连续的同类小题（跟读 1-7 或面试 8-11），带一段屏幕上显示的「场景」 */
interface Zone {
  kind: ZoneKind
  /** 屏幕上显示的场景/指令（官方：屏幕上只有场景，没有任何题目文字） */
  scenario: string
  /** 区间起始题号（"1-7." → 1）；没有区间标题时用第一题的题号 */
  from: number
  items: RawItem[]
}

/** 整行就是题组头（日期 / 第 N 套），用来切开同一页里的两段 */
function isSetHeaderLine(line: string): boolean {
  const t = line.trim()
  if (!t) return false
  // 纯「第N套」行
  if (RE_SET_NO.test(t) && t.length <= 16) return true
  // 以日期开头、且整行很短（例如「2026 年 4 月 26 日口语 1」），后面没有成句正文
  const d = t.match(RE_DATE)
  if (!d || d.index !== 0) return false
  const rest = t.slice(d[0].length).trim()
  if (rest.length > 16) return false
  return !/[a-z]{2,}/i.test(rest)
}

/**
 * 解析一个题组。
 *
 * 版式（真实真题库的两种写法都覆盖）：
 *   A. 「1-7. <场景与指令>」区间标题，随后 1.~7. 是跟读句
 *   B. 直接一段场景文字，随后 1.~7. 是跟读句（没有区间标题）
 *   面试区同理：可能是「8-11 <场景>」，也可能只有一段场景文字，随后 8.~11. 是问题
 *   最后是参考答案区，用「Question N」或「【文】8.」引出。
 *
 * 关键：区间标题/场景文字**不是题**，它只是屏幕上显示的背景说明；
 * 真正的题只有编号行。把这一点搞错会既吞掉第 1 句、又让所有参考答案错位。
 */
function parseSet(block: SetBlock): { questions: Question[]; warnings: string[] } {
  const warnings: string[] = []
  const zones: Zone[] = []
  const refs = new Map<number, string[]>()

  let refMode = false
  let refNo: number | null = null
  let zone: Zone | null = null
  let current: RawItem | null = null
  /** 场景还没结束（区间标题之后、第一个编号小题之前） */
  let scenarioOpen = false
  /** 还没开区之前攒下的场景文字 */
  let pendingScenario = ''
  /** 场景已说完、编号尚未出现的句子（PDF 里第 1 句经常漏编号） */
  let preItem = ''
  /** 内联参考答案模式（「答案：」之后的内容都属于上一小题的答案） */
  let answerMode = false
  /** 最近一个小题号，用于把内联答案挂到正确的题上 */
  let lastItemNo: number | null = null
  let sawInterviewMarker = false
  let sawRepeatMarker = false

  const pushItem = (): void => {
    if (current && current.text.trim() && zone) zone.items.push(current)
    current = null
  }
  const closeZone = (): void => {
    pushItem()
    zone = null
    scenarioOpen = false
  }
  /** 新建一段；返回对象本身，避免闭包赋值让 TS 丢掉类型收窄 */
  const makeZone = (kind: ZoneKind, scenario: string, from = 1): Zone => {
    const z: Zone = { kind, scenario: scenario.trim(), from, items: [] }
    zones.push(z)
    return z
  }
  const appendRef = (no: number | null, text: string): void => {
    const n = no ?? refNo
    if (n == null || !text.trim()) return
    const bucket = refs.get(n) ?? []
    bucket.push(text.trim())
    refs.set(n, bucket)
  }
  /**
   * 有些 PDF 会把两道小题挤在同一行（"…around the world, 3.discover…"）。
   * 这里按「必须等于下一个期望题号」的严格条件把它拆开，避免误伤 "3.14" 之类。
   */
  const splitEmbedded = (text: string, nextNo: number): { head: string; tail: { no: number; text: string }[] } => {
    const tail: { no: number; text: string }[] = []
    let head = text
    let expect = nextNo
    for (;;) {
      const re = new RegExp(`[\\s,;](${expect})\\s*[.．、]\\s*`)
      const m = head.match(re)
      if (!m || m.index == null) break
      const after = head.slice(m.index + m[0].length)
      if (after.trim().length < 4) break
      const before = head.slice(0, m.index).trim()
      tail.push({ no: expect, text: after.trim() })
      head = before
      expect += 1
      const nx = tail[tail.length - 1].text
      const m2 = nx.match(new RegExp(`[\\s,;](${expect})\\s*[.．、]\\s*`))
      if (m2 && m2.index != null && nx.slice(m2.index + m2[0].length).trim().length >= 4) {
        tail[tail.length - 1] = { no: expect - 1, text: nx.slice(0, m2.index).trim() }
        tail.push({ no: expect, text: nx.slice(m2.index + m2[0].length).trim() })
        expect += 1
      }
    }
    return { head, tail }
  }

  /** 没有区间标题时，用场景措辞与题号推断这一段是哪一类 */
  const inferKind = (scenario: string, no: number): ZoneKind => {
    const t = stripNotes(scenario)
    // 先判跟读：页眉备注里常出现「面试」「interview」字样，容易把跟读段误判成面试段
    if (RE_REPEAT.test(t)) return 'repeat'
    if (RE_INTERVIEW.test(t)) return 'interview'
    return no >= 8 ? 'interview' : 'repeat'
  }

  for (const { text: line, page } of block.lines) {
    let body = line

    /* ---------- 参考答案标记：【文】/【答案】/【范文】 ---------- */
    const mi = body.search(RE_REF_MARK)
    if (mi >= 0) {
      const before = body.slice(0, mi).trim()
      if (current && before) current.text += ' ' + before
      pushItem()
      refMode = true
      refNo = null
      body = body.slice(mi).replace(RE_REF_MARK, '').trim()
      if (!body) continue
    } else if (refMode && RE_REF_VARIANT.test(body)) {
      const variant = body.match(RE_REF_VARIANT)![0].replace(/[【】\s]/g, '')
      body = body.replace(RE_REF_VARIANT, '').trim()
      if (!body) continue
      if (refNo != null) appendRef(refNo, `【${variant}】${body}`)
      continue
    }

    /* ---------- 参考答案区 ---------- */
    if (refMode) {
      const rq = body.match(RE_REF_START)
      if (rq && (RE_REF_BARE.test(body) || /^Questions?\s*\d{1,2}\b/i.test(body))) {
        refNo = Number(rq[1])
        const rest = (rq[2] ?? '').trim()
        if (rest) appendRef(refNo, rest)
        else refs.set(refNo, refs.get(refNo) ?? [])
        continue
      }
      const rn = body.match(RE_ITEM_DOT) ?? body.match(RE_ITEM_BARE)
      if (rn) {
        const no = Number(rn[1])
        if (no >= 1 && no <= 20) {
          refNo = no
          refs.set(no, refs.get(no) ?? [])
          appendRef(no, (rn[2] ?? '').trim())
          continue
        }
      }
      appendRef(refNo, body)
      continue
    }

    /* ---------- 题目区 ---------- */

    // "Question 8 <参考答案>"：直接进入参考答案区
    const qh = body.match(RE_REF_START)
    if (qh && (RE_REF_BARE.test(body) || /^Questions?\s*\d{1,2}\b/i.test(body))) {
      closeZone()
      refMode = true
      refNo = Number(qh[1])
      const rest = (qh[2] ?? '').trim()
      refs.set(refNo, refs.get(refNo) ?? [])
      if (rest) appendRef(refNo, rest)
      continue
    }

    // 同一页里再次出现的题组头：切开当前这一段
    if (isSetHeaderLine(body)) {
      closeZone()
      pendingScenario = ''
      continue
    }

    // 区间标题：「1-7. <场景>」/「8-11 <场景>」——标题文字是场景，不是题
    const range = body.match(RE_RANGE_HDR)
    if (range) {
      const from = Number(range[1])
      const rest = body.slice(range[0].length).trim()
      const scenario = pendingScenario ? `${pendingScenario} ${rest}`.trim() : rest
      pendingScenario = ''
      const sc = stripNotes(scenario)
      const kind: ZoneKind = RE_REPEAT.test(sc)
        ? 'repeat'
        : RE_INTERVIEW.test(sc)
          ? 'interview'
          : from >= 8
            ? 'interview'
            : 'repeat'
      if (kind === 'interview') sawInterviewMarker = true
      else sawRepeatMarker = true
      pushItem()
      zone = makeZone(kind, scenario, from)
      scenarioOpen = true
      preItem = ''
      continue
    }

    // 「问题 10: ...」也是题干（真实真题库里跟「10. ...」混用）
    const cn = body.match(RE_CN_QUESTION)
    if (cn) {
      const no = Number(cn[1])
      const text = (cn[2] ?? '').trim()
      if (no >= 1 && no <= 30) {
        if (!zone) {
          const kind = inferKind(pendingScenario, no)
          if (kind === 'interview') sawInterviewMarker = true
          else sawRepeatMarker = true
          pushItem()
          zone = makeZone(kind, pendingScenario)
          scenarioOpen = true
          pendingScenario = ''
        }
        const active = zone
        pushItem()
        current = { no, text, page, interview: active.kind === 'interview' }
        scenarioOpen = false
        answerMode = false
        lastItemNo = no
        continue
      }
    }

    // 「答案：」= 紧跟其后的是当前小题的参考答案（内联版式）
    const ca = body.match(RE_CN_ANSWER)
    if (ca && lastItemNo != null) {
      answerMode = true
      const rest = (ca[1] ?? '').trim()
      refs.set(lastItemNo, refs.get(lastItemNo) ?? [])
      if (rest) appendRef(lastItemNo, rest)
      continue
    }

    // 编号小题
    const m = body.match(RE_ITEM_DOT) ?? body.match(RE_ITEM_BARE)
    if (m) {
      const no = Number(m[1])
      const text = (m[2] ?? '').trim()
      if (no < 1 || no > 30) {
        if (current) current.text += ' ' + body
        continue
      }
      // 官方题号是固定的：跟读 1-7，面试 8-11。
      // 题号跨过 7/8 分界线就换段，这是最可靠的切分依据。
      if (zone && zone.kind === 'repeat' && no >= 8 && (lastItemNo ?? 0) <= 7) {
        closeZone()
        pendingScenario = ''
      } else if (zone && zone.kind === 'interview' && no <= 7 && (lastItemNo ?? 0) >= 8) {
        closeZone()
        pendingScenario = ''
      }
      if (!zone) {
        // 没有区间标题：用攒下的场景文字开一段
        const kind = inferKind(pendingScenario, no)
        if (kind === 'interview') sawInterviewMarker = true
        else sawRepeatMarker = true
        pushItem()
        zone = makeZone(kind, pendingScenario)
        scenarioOpen = true
        pendingScenario = ''
      }
      // 题号回退（例如面试答案又从头写 8.）说明进入了「无标记的参考答案区」
      const seenNos = new Set<number>()
      for (const z of zones) for (const it of z.items) seenNos.add(it.no)
      if (current) seenNos.add(current.no)
      if (zone && no <= (lastItemNo ?? 0) && seenNos.has(no)) {
        pushItem()
        refMode = true
        refNo = no
        refs.set(no, refs.get(no) ?? [])
        if (text) appendRef(no, text)
        continue
      }

      const active = zone
      // 第 1 句没有编号：补成 from 号题
      if (preItem && active.items.length === 0 && !current && no === active.from + 1) {
        active.items.push({
          no: active.from,
          text: preItem,
          page,
          interview: active.kind === 'interview'
        })
        preItem = ''
      }
      pushItem()
      const split = splitEmbedded(text, no + 1)
      current = { no, text: split.head, page, interview: active.kind === 'interview' }
      for (const t of split.tail) {
        if (current && current.text.trim()) active.items.push(current)
        current = { no: t.no, text: t.text, page, interview: active.kind === 'interview' }
      }
      scenarioOpen = false
      answerMode = false
      lastItemNo = current ? current.no : no
      continue
    }

    // 非编号行
    if (!body.trim()) continue
    if (!zone) {
      // 区之前的散行，先当作场景攒着
      if (!/^[\s\d第套=至到日年月]*$/.test(body)) pendingScenario += ' ' + body.trim()
      continue
    }
    if (answerMode && lastItemNo != null) {
      appendRef(lastItemNo, body.trim())
      continue
    }
    if (scenarioOpen) {
      // 场景已经交代完（出现「Repeat only once.」这类指令）时，
      // 后面紧跟的无编号句子其实是第 1 题（真实 PDF 里确实会漏掉编号）
      const instructed = RE_REPEAT.test(zone.scenario) || RE_INTERVIEW.test(zone.scenario)
      if (instructed && zone.items.length === 0 && current == null) {
        preItem = preItem ? `${preItem} ${body.trim()}` : body.trim()
        continue
      }
      zone.scenario += ' ' + body.trim()
      continue
    }
    // 场景已结束：可能是下一段的提示词
    if (RE_INTERVIEW.test(body) && zone.kind === 'repeat') {
      closeZone()
      pendingScenario = body.trim()
      continue
    }
    if (current) current.text += ' ' + body
  }
  pushItem()

  const questions: Question[] = []
  for (const z of zones) {
    for (const it of z.items) {
      const text = it.text.trim()
      if (!text) continue
      const taskType: TaskType = it.interview ? 'INTERVIEW' : 'LISTEN_REPEAT'
      const meta = TASK_META[taskType]
      // 参考答案一律不录入（用户要求）
      const words = text.split(/\s+/).filter(Boolean).length
      questions.push({
        id: newId('q'),
        taskType,
        questionText: text,
        contextText: z.scenario.trim() || null,
        readingText: null,
        listeningText: text,
        referenceAnswer: null,
        preparationTime: meta.prepTime,
        responseTime: (() => {
          // 官方：听后重复的作答时间从 8 秒逐步增加到 12 秒，随句子由短到长递增
          if (taskType === 'LISTEN_REPEAT') return words <= 8 ? 8 : words <= 12 ? 10 : 12
          return meta.responseTime
        })(),
        sourcePage: it.page,
        tags: [`group:${block.label}`, it.interview ? 'interview' : 'listen-repeat', `no:${it.no}`],
        parseWarnings: [],
        needsReview: text.length < 12,
        rawText: text
      })
    }
  }

  return { questions, warnings }
}

/**
 * 去重：同一题组里同一个题号出现多次时，只保留文本更短的那条。
 *
 * 真实真题库里，面试问题有时会先以「带口语化铺垫」的版本出现一次，
 * 紧接着再给一遍干净版本（后面跟答案）。用户只要干干净净的题目。
 */
function dedupeByNumber(questions: Question[]): Question[] {
  const best = new Map<string, Question>()
  const order: string[] = []
  for (const q of questions) {
    const group = q.tags.find((t) => t.startsWith('group:')) ?? ''
    const no = q.tags.find((t) => t.startsWith('no:')) ?? ''
    const key = `${group}|${q.taskType}|${no}`
    const prev = best.get(key)
    if (!prev) {
      best.set(key, q)
      order.push(key)
      continue
    }
    if (q.questionText.trim().length < prev.questionText.trim().length) best.set(key, q)
  }
  return order.map((k) => best.get(k)!)
}

/* ------------------------------ 入口 ------------------------------ */

export function parseQuestionsFromPages(pages: PageText[]): ParseResult {
  const warnings: string[] = []

  const totalChars = pages.reduce((a, p) => a + (p.text ?? '').replace(/\s/g, '').length, 0)
  if (totalChars < 40) {
    warnings.push('PDF 中几乎没有可提取的文字，可能是扫描件。请使用「AI 智能解析」（可自动 OCR）或手动录入。')
    return { questions: [], warnings, stats: { detected: 0, parsed: 0, needsReview: 0, groups: 0 } }
  }

  const blocks = splitSets(pages)
  const questions: Question[] = []
  for (const b of blocks) {
    const { questions: qs, warnings: w } = parseSet(b)
    questions.push(...qs)
    warnings.push(...w)
  }

  const deduped = dedupeByNumber(questions)

  if (deduped.length === 0) {
    warnings.push('规则解析没有识别出题目。建议改用「AI 智能解析」——它更适合排版不统一的 PDF。')
  }

  /*
   * 结构化自检，替代原来的「有没有看到提示词」判断。
   *
   * 官方一套题固定是 7 道跟读 + 4 道面试；题号（1-7 / 8-11）本身就很可靠，
   * 提示词缺失并不影响切分。真正该提醒用户的是**题目数量对不上**，
   * 原来的写法会给一堆其实解析得很好的题组报「可能需人工确认」，
   * 和「需要人工确认 0」自相矛盾，属于纯噪音。
   */
  const shape = new Map<string, { repeat: number; interview: number }>()
  for (const q of deduped) {
    const g = q.tags.find((t) => t.startsWith('group:')) ?? 'group:未分组'
    const c = shape.get(g) ?? { repeat: 0, interview: 0 }
    if (q.taskType === 'LISTEN_REPEAT') c.repeat += 1
    else c.interview += 1
    shape.set(g, c)
  }
  for (const [g, c] of shape) {
    const label = g.slice(6)
    if (c.repeat === 0 && c.interview > 0) {
      warnings.push(`题组「${label}」只识别到面试题（${c.interview} 道），没有跟读题。`)
    } else if (c.interview === 0 && c.repeat > 0) {
      warnings.push(`题组「${label}」只识别到跟读题（${c.repeat} 道），没有面试题。`)
    } else if (c.repeat !== 7 || c.interview !== 4) {
      const miss: string[] = []
      if (c.repeat !== 7) miss.push(`跟读应为 7 道、实际 ${c.repeat} 道`)
      if (c.interview !== 4) miss.push(`面试应为 4 道、实际 ${c.interview} 道`)
      warnings.push(`题组「${label}」与官方结构不符（${miss.join('，')}），可能是原文缺题或排版异常。`)
    }
  }

  const needsReview = deduped.filter((q) => q.needsReview).length
  return {
    questions: deduped,
    warnings: [...new Set(warnings)],
    stats: {
      detected: deduped.length,
      parsed: deduped.length,
      needsReview,
      groups: new Set(deduped.map((q) => q.tags.find((t) => t.startsWith('group:')) ?? '')).size
    }
  }
}

/** 判断是否基本是扫描件（几乎没有文字层） */
export function isLikelyScanned(pages: PageText[]): boolean {
  if (pages.length === 0) return false
  const withText = pages.filter((p) => (p.text ?? '').replace(/\s/g, '').length >= 30).length
  return withText / pages.length < 0.4
}

/**
 * 按考试模式挑选题目。
 * 规则见 shared/scoring/convert.ts，避免两处逻辑漂移。
 */
export function pickExamQuestions(
  pool: Question[],
  mode: ExamMode,
  customTaskTypes?: TaskType[]
): Question[] {
  return pickQuestionsForMode(pool, mode, customTaskTypes)
}
