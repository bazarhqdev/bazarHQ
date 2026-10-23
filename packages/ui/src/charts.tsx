'use client';

/**
 * Charts built on Recharts (approved stack). Marks follow the dataviz spec:
 * 2px lines, rounded bar ends on the baseline, recessive grid, hover/keyboard
 * tooltips (Recharts accessibility layer), and a Chart/Table toggle via
 * ChartFrame so values are never colour-only.
 */
import { useId, useState, type ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart as RBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatShortDate } from '@bazarhq/shared';
import { cn } from './cn';

export interface SeriesDatum {
  x: string;
  y: number;
}

export interface StackSeries {
  name: string;
  color: string;
  values: number[];
}

const axisTick = { fill: 'var(--color-ink-subtle)', fontSize: 11 };

function ChartTooltip({
  active,
  label,
  payload,
  formatValue,
}: {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string | number; value?: number | string; color?: string; dataKey?: string | number }[];
  formatValue: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[150px] rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] shadow-[var(--shadow-pop)]">
      <p className="font-semibold text-ink">{formatShortDate(String(label))}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="mt-0.5 flex items-center justify-between gap-3 text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
            {p.name}
          </span>
          <span className="font-semibold text-ink tabular">{formatValue(Number(p.value ?? 0))}</span>
        </p>
      ))}
    </div>
  );
}

/** Single-series trend (line + soft area). */
export function TrendChart({
  data,
  formatValue,
  formatAxis = formatValue,
  height = 220,
  label,
  seriesName,
  color = 'var(--color-chart-1)',
}: {
  data: SeriesDatum[];
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  height?: number;
  label: string;
  seriesName: string;
  color?: string;
}) {
  const gid = useId().replace(/:/g, '');
  return (
    <div style={{ height }} className="w-full" role="figure" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id={`g${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="x" tickFormatter={(v) => formatShortDate(String(v))} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v) => formatAxis(Number(v))} tick={axisTick} tickLine={false} axisLine={false} width={58} />
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ stroke: 'var(--color-line-strong)', strokeDasharray: '3 3' }} />
          <Area
            type="monotone"
            dataKey="y"
            name={seriesName}
            stroke={color}
            strokeWidth={2}
            fill={`url(#g${gid})`}
            activeDot={{ r: 5, stroke: 'white', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical bars: one series, or several stacked series. */
export function BarChart({
  labels,
  series,
  formatValue,
  height = 220,
  label,
}: {
  labels: string[];
  series: StackSeries[];
  formatValue: (v: number) => string;
  height?: number;
  label: string;
}) {
  const data = labels.map((x, i) => Object.fromEntries([['x', x], ...series.map((s) => [s.name, s.values[i] ?? 0])]));
  return (
    <div style={{ height }} className="w-full" role="figure" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2} accessibilityLayer>
          <CartesianGrid vertical={false} stroke="var(--color-chart-grid)" />
          <XAxis dataKey="x" tickFormatter={(v) => formatShortDate(String(v))} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis tickFormatter={(v) => formatValue(Number(v))} tick={axisTick} tickLine={false} axisLine={false} width={48} allowDecimals={false} />
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ fill: 'var(--color-canvas)' }} />
          {series.map((s, i) => (
            <Bar key={s.name} dataKey={s.name} name={s.name} stackId="a" fill={s.color} maxBarSize={28} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} />
          ))}
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string; shape?: 'bar' | 'line' }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-muted" aria-label="Legend">
      {items.map((it) => (
        <li key={it.name} className="inline-flex items-center gap-1.5">
          <span className={cn(it.shape === 'line' ? 'h-0.5 w-3.5 rounded' : 'size-2.5 rounded-sm')} style={{ background: it.color }} aria-hidden />
          {it.name}
        </li>
      ))}
    </ul>
  );
}

/** Horizontal ranked bars with text-ink value labels. */
export function RankedBars({
  items,
  formatValue,
  color = 'var(--color-chart-1)',
  emptyLabel = 'No data for this period.',
}: {
  items: { label: ReactNode; value: number; sublabel?: ReactNode; key: string }[];
  formatValue: (v: number) => string;
  color?: string;
  emptyLabel?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 0);
  if (!items.length || max === 0) return <p className="py-6 text-center text-sm text-ink-muted">{emptyLabel}</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.key} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink">
              {it.label}
              {it.sublabel && <span className="ml-1.5 text-[12px] font-normal text-ink-subtle">{it.sublabel}</span>}
            </span>
            <span className="shrink-0 font-semibold text-ink tabular">{formatValue(it.value)}</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div className="h-2 rounded-full transition-[width] duration-500" style={{ width: `${Math.max((it.value / max) * 100, 2)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Wraps a chart with a "Chart / Table" toggle so values are never colour-only. */
export function ChartFrame({
  chart,
  table,
  legend,
  className,
}: {
  chart: ReactNode;
  table: { columns: string[]; rows: (string | number)[][] };
  legend?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>{legend}</div>
        <div className="inline-flex rounded-lg bg-canvas p-0.5 text-[12px] font-semibold" role="group" aria-label="Display as">
          {(['chart', 'table'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn('rounded-md px-2.5 py-1 capitalize', view === v ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink')}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'chart' ? (
        chart
      ) : (
        <div className="max-h-[260px] overflow-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-canvas">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} scope="col" className="px-3 py-2 text-left text-[12px] font-semibold text-ink-subtle">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  {r.map((cell, j) => (
                    <td key={j} className="px-3 py-1.5 tabular text-ink">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
