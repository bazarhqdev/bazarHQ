/**
 * Pure analytics helpers. In production these numbers come from the
 * tenant-scoped analytics views (FR-M-36 "no direct table scans"); the mock
 * service computes them from its in-memory orders with the same rules.
 */
import { ORDER_STATUSES } from '../constants';
import { dayKey } from '../formatters';
import { countsTowardRevenue } from '../transitions';
import type { DateRange, DateRangePreset, MetricWithChange, Order, OrderStatus, SeriesPoint } from '../types';

const DAY = 86_400_000;

export const RANGE_PRESETS: { value: Exclude<DateRangePreset, 'custom'>; label: string; days: number }[] = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
];

/** Inclusive day range ending today (Asia/Dhaka day keys). */
export function makeRange(preset: DateRangePreset, now: Date = new Date(), custom?: { from: string; to: string }): DateRange {
  if (preset === 'custom' && custom) {
    const from = custom.from <= custom.to ? custom.from : custom.to;
    const to = custom.from <= custom.to ? custom.to : custom.from;
    return { preset, from, to };
  }
  const days = RANGE_PRESETS.find((p) => p.value === preset)?.days ?? 30;
  return { preset, from: dayKey(new Date(now.getTime() - (days - 1) * DAY)), to: dayKey(now) };
}

/** List of YYYY-MM-DD keys from..to inclusive. */
export function daysInRange(range: Pick<DateRange, 'from' | 'to'>): string[] {
  const out: string[] = [];
  const start = Date.parse(`${range.from}T00:00:00Z`);
  const end = Date.parse(`${range.to}T00:00:00Z`);
  for (let t = start; t <= end && out.length < 400; t += DAY) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export function previousRange(range: Pick<DateRange, 'from' | 'to'>): { from: string; to: string } {
  const len = daysInRange(range).length;
  const start = Date.parse(`${range.from}T00:00:00Z`);
  return {
    from: new Date(start - len * DAY).toISOString().slice(0, 10),
    to: new Date(start - DAY).toISOString().slice(0, 10),
  };
}

export function inRange(iso: string, range: Pick<DateRange, 'from' | 'to'>): boolean {
  const d = dayKey(new Date(iso));
  return d >= range.from && d <= range.to;
}

export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

export function metric(current: number, previous: number): MetricWithChange {
  return { value: current, changePct: pctChange(current, previous) };
}

export function revenueOf(orders: Order[]): number {
  return orders.filter(countsTowardRevenue).reduce((s, o) => s + o.totalAmount, 0);
}

export function buildSeries(orders: Order[], range: Pick<DateRange, 'from' | 'to'>, visitors: Record<string, number> = {}): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  for (const d of daysInRange(range)) map.set(d, { date: d, revenue: 0, orders: 0, cancelled: 0, visitors: visitors[d] ?? 0 });
  for (const o of orders) {
    const p = map.get(dayKey(new Date(o.createdAt)));
    if (!p) continue;
    p.orders += 1;
    if (o.status === 'cancelled') p.cancelled += 1;
    else p.revenue += o.totalAmount;
  }
  return [...map.values()];
}

export function countByStatus(orders: Order[]): Record<OrderStatus, number> {
  const out = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const o of orders) out[o.status] += 1;
  return out;
}

export function seriesToCsv(series: SeriesPoint[]): string {
  const header = 'date,orders,revenue_bdt,cancelled_orders,visitors';
  const rows = series.map((p) => [p.date, p.orders, p.revenue.toFixed(2), p.cancelled, p.visitors].join(','));
  return [header, ...rows].join('\n');
}

export function toCsv(rows: (string | number | null)[][]): string {
  return rows
    .map((r) =>
      r
        .map((cell) => {
          const s = cell === null ? '' : String(cell);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\n');
}
