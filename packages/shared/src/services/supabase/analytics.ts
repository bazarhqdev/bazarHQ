/**
 * Merchant analytics (FR-M-36..38) on Supabase.
 *
 * Orders come from an RLS-scoped read of the merchant's own store; visitors,
 * popular pages and low stock come from merchant_dashboard() (migration 011).
 * The figures are computed with the same shared helpers as the mock, so both
 * data sources agree on every metric.
 */
import { PAYMENT_METHODS } from '../../constants';
import { stockState } from '../../domain';
import { dayKey } from '../../formatters';
import type { AnalyticsReport, DashboardSummary, DateRange, LowStockItem, Order, Store } from '../../types';
import { buildSeries, countByStatus, daysInRange, inRange, metric, previousRange, revenueOf, seriesToCsv } from '../analytics';
import type { AnalyticsService } from '../contracts';
import type { AdapterContext } from './core';
import { mapNotification, mapOrder, ORDER_COLUMNS } from './mappers';

/* eslint-disable @typescript-eslint/no-explicit-any -- RPC JSON is narrowed field by field */
type Row = Record<string, any>;

const DAY = 86_400_000;
const startOf = (day: string) => `${day}T00:00:00+06:00`;
const endOf = (day: string) => new Date(Date.parse(`${day}T00:00:00+06:00`) + DAY).toISOString();

function customerKey(o: Order) {
  return o.customerId ?? `guest:${o.orderPhone}`;
}

export function createAnalytics(ctx: AdapterContext, myStore: () => Promise<Store>): AnalyticsService {
  const { sb } = ctx;

  async function load(range: DateRange) {
    const store = await myStore();
    const prev = previousRange(range);
    const monthAgo = dayKey(new Date(Date.now() - 29 * DAY));
    const windowFrom = [prev.from, monthAgo].sort()[0]!;
    const [rows, rpc, hasAny] = await Promise.all([
      ctx.q<Row[]>(
        sb.from('orders').select(ORDER_COLUMNS).eq('store_id', store.id).eq('is_test', false).gte('created_at', startOf(windowFrom)).lt('created_at', endOf(range.to)).limit(20000),
      ),
      ctx.rpc<Row>('merchant_dashboard', { p_from: startOf(range.from), p_to: endOf(range.to) }),
      sb.from('orders').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('is_test', false),
    ]);
    const orders = rows.map((r) => mapOrder(r));
    const visitorsByDay: Record<string, number> = {};
    for (const p of (rpc.series ?? []) as Row[]) visitorsByDay[p.date] = Number(p.visitors ?? 0);
    return { store, prev, orders, rpc, visitorsByDay, hasOrders: (hasAny.count ?? 0) > 0 };
  }

  async function dashboard(range: DateRange): Promise<DashboardSummary> {
    const { store, prev, orders, rpc, visitorsByDay, hasOrders } = await load(range);
    const cur = orders.filter((o) => inRange(o.createdAt, range));
    const before = orders.filter((o) => inRange(o.createdAt, prev));
    const [productsBefore, recent, notes] = await Promise.all([
      sb.from('products').select('id', { count: 'exact', head: true }).eq('store_id', store.id).is('deleted_at', null).lt('created_at', startOf(range.from)),
      ctx.q<Row[]>(sb.from('orders').select(ORDER_COLUMNS).eq('store_id', store.id).eq('is_test', false).order('created_at', { ascending: false }).limit(6)),
      ctx.q<Row[]>(sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(4)),
    ]);
    const lowStock: LowStockItem[] = ((rpc.low_stock ?? []) as Row[]).slice(0, 6).map((l) => ({
      productId: l.product_id,
      variantId: l.variant_id ?? null,
      name: String(l.name).replace(/ \((.*)\)$/, ' — $1'),
      stockQuantity: Number(l.stock_quantity),
      threshold: Number(l.threshold),
      state: stockState(Number(l.stock_quantity), Number(l.threshold)),
    }));
    return {
      range,
      totalSales: metric(revenueOf(cur), revenueOf(before)),
      totalOrders: metric(cur.length, before.length),
      totalProducts: metric(Number(rpc.total_products ?? 0), productsBefore.count ?? 0),
      totalCustomers: metric(new Set(cur.map(customerKey)).size, new Set(before.map(customerKey)).size),
      series: buildSeries(orders, range, visitorsByDay),
      lowStock,
      recentOrders: recent.map((r) => mapOrder(r)),
      recentNotifications: notes.map(mapNotification),
      hasOrders,
    };
  }

  async function report(range: DateRange): Promise<AnalyticsReport> {
    const { prev, orders, rpc, visitorsByDay, hasOrders } = await load(range);
    const customers = await ctx.rpc<Row[]>('merchant_customers').catch(() => [] as Row[]);
    const firstOrder = new Map(customers.map((c) => [String(c.id), dayKey(new Date(c.first_order_at))]));
    const cur = orders.filter((o) => inRange(o.createdAt, range));
    const before = orders.filter((o) => inRange(o.createdAt, prev));
    const validCur = cur.filter((o) => o.status !== 'cancelled');
    const validPrev = before.filter((o) => o.status !== 'cancelled');
    const revCur = revenueOf(cur);
    const revPrev = revenueOf(before);
    const visCur = Number(rpc.visitors ?? 0);
    const visPrev = Number(rpc.previous_visitors ?? 0);
    const conv = (n: number, v: number) => (v > 0 ? (n / v) * 100 : 0);
    const aov = (rev: number, n: number) => (n > 0 ? rev / n : 0);
    const today = dayKey(new Date());
    const lastN = (n: number) => revenueOf(orders.filter((o) => inRange(o.createdAt, { from: dayKey(new Date(Date.now() - (n - 1) * DAY)), to: today })));

    const prod = new Map<string, { productId: string; name: string; unitsSold: number; revenue: number }>();
    for (const o of validCur) {
      for (const it of o.items) {
        const e = prod.get(it.productId) ?? { productId: it.productId, name: it.productName, unitsSold: 0, revenue: 0 };
        e.unitsSold += it.quantity;
        e.revenue += it.subtotal;
        prod.set(it.productId, e);
      }
    }

    const growth = daysInRange(range).map((d) => ({ date: d, newCustomers: 0, returningCustomers: 0 }));
    const growthMap = new Map(growth.map((g) => [g.date, g]));
    const seen = new Set<string>();
    for (const o of cur) {
      const d = dayKey(new Date(o.createdAt));
      const k = customerKey(o);
      if (seen.has(`${d}:${k}`)) continue;
      seen.add(`${d}:${k}`);
      const g = growthMap.get(d);
      if (!g) continue;
      if ((firstOrder.get(k) ?? d) === d) g.newCustomers += 1;
      else g.returningCustomers += 1;
    }

    const cancelled = cur.filter((o) => o.status === 'cancelled');
    return {
      range,
      revenue: metric(revCur, revPrev),
      orders: metric(cur.length, before.length),
      averageOrderValue: metric(aov(revCur, validCur.length), aov(revPrev, validPrev.length)),
      visitors: metric(visCur, visPrev),
      conversionRate: metric(conv(validCur.length, visCur), conv(validPrev.length, visPrev)),
      revenueToday: lastN(1),
      revenueThisWeek: lastN(7),
      revenueThisMonth: lastN(30),
      cancelled: { orders: cancelled.length, value: cancelled.reduce((s, o) => s + o.totalAmount, 0) },
      series: buildSeries(orders, range, visitorsByDay),
      ordersByStatus: countByStatus(cur),
      paymentMethodBreakdown: PAYMENT_METHODS.map((method) => {
        const os = validCur.filter((o) => o.paymentMethod === method);
        return { method, orders: os.length, revenue: os.reduce((s, o) => s + o.totalAmount, 0) };
      }),
      topProducts: [...prod.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6),
      customerGrowth: growth,
      popularPages: ((rpc.popular_pages ?? []) as Row[]).map((p) => ({ path: String(p.path), views: Number(p.views) })),
      hasOrders,
    };
  }

  return {
    dashboard,
    report,
    async exportCsv(range) {
      const { store, orders, visitorsByDay } = await load(range);
      return { filename: `${store.subdomain}-analytics-${range.from}_to_${range.to}.csv`, csv: seriesToCsv(buildSeries(orders, range, visitorsByDay)) };
    },
  };
}
