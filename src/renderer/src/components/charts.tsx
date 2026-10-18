import React from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { AI_DIMENSIONS, MAX_RESPONSE_SCORE, TASK_META, TASK_TYPES } from '@shared/constants'
import type { TaskScoreEntry, TaskType } from '@shared/types'

const tooltipStyle = {
  background: 'rgba(10,15,31,0.96)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 12,
  fontSize: 12,
  color: '#E2E8F0',
  padding: '8px 12px'
} as const

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '--'
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/* --------------------------- 雷达图 --------------------------- */

export function DimensionRadar({
  delivery,
  languageUse,
  topicDevelopment,
  height = 240
}: {
  delivery: number | null
  languageUse: number | null
  topicDevelopment: number | null
  height?: number
}): React.JSX.Element {
  const values = [delivery, languageUse, topicDevelopment]
  const data = AI_DIMENSIONS.map((d, i) => ({
    dimension: d.label,
    labelZh: d.labelZh,
    value: values[i] ?? 0,
    fullMark: MAX_RESPONSE_SCORE
  }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <defs>
          <linearGradient id="radarFill" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#818CF8" stopOpacity={0.55} />
            <stop offset="100%" stopColor="#22D3EE" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <PolarGrid stroke="rgba(255,255,255,0.12)" />
        <PolarAngleAxis dataKey="dimension" tick={{ fill: '#94A3B8', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 6]} tickCount={7} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} />
        <Radar name="Score" dataKey="value" stroke="#A5B4FC" strokeWidth={2} fill="url(#radarFill)" />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={((v: unknown, _n: unknown, p: { payload?: { labelZh?: string } }) => [`${fmt(Number(v))} / ${MAX_RESPONSE_SCORE}`, p?.payload?.labelZh ?? '']) as never}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}

/* --------------------------- 维度条形 --------------------------- */

export function DimensionBars({
  delivery,
  languageUse,
  topicDevelopment
}: {
  delivery: number | null
  languageUse: number | null
  topicDevelopment: number | null
}): React.JSX.Element {
  const values: Record<string, number | null> = {
    delivery,
    language_use: languageUse,
    topic_development: topicDevelopment
  }
  return (
    <div className="space-y-3">
      {AI_DIMENSIONS.map((d) => {
        const v = values[d.key]
        const pct = v == null ? 0 : (v / MAX_RESPONSE_SCORE) * 100
        return (
          <div key={d.key}>
            <div className="mb-1.5 flex items-baseline justify-between text-xs">
              <span className="text-slate-300">
                {d.label} <span className="text-slate-500">/ {d.labelZh}</span>
              </span>
              <span className="tabular-nums text-slate-400">
                {fmt(v)} <span className="text-slate-600">/ 6</span>
              </span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${pct}%`, background: d.color }}
                />
              </div>
              <span className="w-10 text-right font-mono text-[10px] tracking-tighter text-slate-500">
                {'█'.repeat(Math.round(pct / 10)).padEnd(10, '░')}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* --------------------------- Task 对比 --------------------------- */

export function TaskBarChart({
  taskScores,
  height = 220
}: {
  taskScores: TaskScoreEntry[]
  height?: number
}): React.JSX.Element {
  const data = TASK_TYPES.map((t) => {
    const entry = taskScores.find((s) => s.taskType === t)
    const meta = TASK_META[t]
    return {
      name: meta.shortLabel,
      /* 键名必须和下面 <Bar dataKey> 完全一致，否则柱子取不到数据、图表是空的。 */
      'raw 0-6': entry?.rawScore ?? 0,
      fill: meta.accent
    }
  })
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="name" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, MAX_RESPONSE_SCORE]} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          formatter={((v: unknown, _n: unknown, p: { payload?: { name?: string } }) => [
            `${fmt(Number(v))} / ${MAX_RESPONSE_SCORE}`,
            p?.payload?.name ?? 'Score'
          ]) as never}
        />
        <Bar dataKey="raw 0-6" radius={[6, 6, 0, 0]} maxBarSize={54}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TaskRadarChart({
  taskScores,
  height = 240
}: {
  taskScores: TaskScoreEntry[]
  height?: number
}): React.JSX.Element {
  const data = TASK_TYPES.map((t) => {
    const entry = taskScores.find((s) => s.taskType === t)
    return { task: TASK_META[t].shortLabel, value: entry?.rawScore ?? 0, fullMark: MAX_RESPONSE_SCORE }
  })
  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} outerRadius="72%">
        <PolarGrid stroke="rgba(255,255,255,0.12)" />
        <PolarAngleAxis dataKey="task" tick={{ fill: '#94A3B8', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, MAX_RESPONSE_SCORE]} tickCount={7} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} />
        <Radar dataKey="value" stroke="#34D399" strokeWidth={2} fill="#34D399" fillOpacity={0.3} />
        <Tooltip contentStyle={tooltipStyle} formatter={((v: unknown) => [`${fmt(Number(v))} / ${MAX_RESPONSE_SCORE}`, 'Score']) as never} />
      </RadarChart>
    </ResponsiveContainer>
  )
}

/* --------------------------- 趋势 --------------------------- */

export function TrendChart({
  trend,
  height = 240
}: {
  trend: { date: number; overallScore: number | null }[]
  height?: number
}): React.JSX.Element {
  const data = trend
    .filter((t) => t.overallScore != null)
    .map((t) => {
      const d = new Date(t.date)
      return {
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        full: d.toLocaleString('zh-CN'),
        score: t.overallScore as number
      }
    })
  if (data.length === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-xs text-slate-500">
        完成第一次模考后即可看到成绩趋势
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 14, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, MAX_RESPONSE_SCORE]} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(l, p) => (p?.[0]?.payload as { full?: string })?.full ?? l}
          formatter={((v: unknown) => [`${fmt(Number(v))} / ${MAX_RESPONSE_SCORE}`, 'Estimated Score']) as never}
        />
        <Line
          type="monotone"
          dataKey="score"
          name="Estimated Score"
          stroke="#22D3EE"
          strokeWidth={2.5}
          dot={{ r: 3, fill: '#22D3EE' }}
          activeDot={{ r: 5 }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: '#94A3B8' }} />
      </LineChart>
    </ResponsiveContainer>
  )
}

/* --------------------------- 历史柱状 --------------------------- */

export function HistoryBarChart({
  attempts,
  height = 200
}: {
  attempts: { date: number; overallScore: number | null }[]
  height?: number
}): React.JSX.Element {
  const data = attempts
    .slice()
    .reverse()
    .map((a) => {
      const d = new Date(a.date)
      return {
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        score: a.overallScore ?? 0,
        /* 配色阈值跟着官方 1-6 分档走：≥4.5 约 B2+，≥3.5 约 B1+，其余偏低。 */
        fill: (a.overallScore ?? 0) >= 4.5 ? '#34D399' : (a.overallScore ?? 0) >= 3.5 ? '#22D3EE' : '#FBBF24'
      }
    })
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
        <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, MAX_RESPONSE_SCORE]} tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ fill: 'rgba(255,255,255,0.04)' }}
          formatter={((v: unknown) => [`${fmt(Number(v))} / ${MAX_RESPONSE_SCORE}`, 'Estimated Score']) as never}
        />
        <Bar dataKey="score" name="Score" radius={[6, 6, 0, 0]} maxBarSize={40}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function taskLabel(t: TaskType): string {
  return TASK_META[t].shortLabel
}
