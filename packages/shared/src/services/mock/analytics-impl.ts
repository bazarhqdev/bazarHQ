import { buildSeries, countByStatus, daysInRange, inRange, metric, previousRange, revenueOf, seriesToCsv } from '../analytics';
import { PAYMENT_METHODS } from '../../constants';
import { dayKey } from '../../formatters';
import { inventoryRowsForProduct } from '../../rules-split';
import type { AnalyticsReport, DashboardSummary, DateRange, LowStockItem, Order, Store } from '../../types';
import type { MockDb } from './seed';

function storeOrders(db: MockDb, store: Store): Order[] {
  return db.orders.filter((o) => o.storeId === store.id);
}

function customerKey(o: Order) {
  return o.customerId ?? `guest:${o.orderPhone}`;
}

function sumVisitors(db: MockDb, storeId: string, range: { from: string; to: string }) {
  return daysInRange(range).reduce((s, d) => s + (db.visitors[storeId]?.[d] ?? 0), 0);
}

export function lowStockItems(db: MockDb, store: Store): LowStockItem[] {
  return db.products
    .filter((p) => p.storeId === store.id && !p.deletedAt && p.status === 'active')
    .flatMap((p) => inventoryRowsForProduct(p, null))
    .filter((r) => r.state !== 'in_stock')
    .sort((a, b) => a.stockQuantity - b.stockQuantity)
    .map((r) => ({
      productId: r.productId,
      variantId: r.variantId,
      name: r.variantLabel ? `${r.productName} — ${r.variantLabel}` : r.productName,
      stockQuantity: r.stockQuantity,
      threshold: r.lowStockThreshold,
      state: r.state,
    }));
}

export function buildDashboard(db: MockDb, store: Store, userId: string, range: DateRange, now: Date): DashboardSummary {
  void now;
  const all = storeOrders(db, store);
  const prev = previousRange(range);
  const cur = all.filter((o) => inRange(o.createdAt, range));
  const before = all.filter((o) => inRange(o.createdAt, prev));
  const custCur = new Set(cur.map(customerKey)).size;
  const custPrev = new Set(before.map(customerKey)).size;
  const products = db.products.filter((p) => p.storeId === store.id && !p.deletedAt);
  const productsBefore = products.filter((p) => p.createdAt.slice(0, 10) < range.from).length;
  return {
    range,
    totalSales: metric(revenueOf(cur), revenueOf(before)),
    totalOrders: metric(cur.length, before.length),
    totalProducts: metric(products.length, productsBefore),
    totalCustomers: metric(custCur, custPrev),
    series: buildSeries(all, range, db.visitors[store.id] ?? {}),
    lowStock: lowStockItems(db, store).slice(0, 6),
    recentOrders: [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    recentNotifications: db.notifications.filter((n) => n.userId === userId).slice(0, 4),
    hasOrders: all.length > 0,
  };
}

export function analyticsReport(db: MockDb, store: Store, range: DateRange, now: Date): AnalyticsReport {
  const all = storeOrders(db, store);
  const prev = previousRange(range);
  const cur = all.filter((o) => inRange(o.createdAt, range));
  const before = all.filter((o) => inRange(o.createdAt, prev));
  const revCur = revenueOf(cur);
  const revPrev = revenueOf(before);
  const validCur = cur.filter((o) => o.status !== 'cancelled');
  const validPrev = before.filter((o) => o.status !== 'cancelled');
  const visCur = sumVisitors(db, store.id, range);
  const visPrev = sumVisitors(db, store.id, prev);
  const conv = (orders: number, visitors: number) => (visitors > 0 ? (orders / visitors) * 100 : 0);
  const aov = (rev: number, n: number) => (n > 0 ? rev / n : 0);

  const today = dayKey(now);
  const lastN = (n: number) => {
    const from = dayKey(new Date(now.getTime() - (n - 1) * 86_400_000));
    return revenueOf(all.filter((o) => inRange(o.createdAt, { from, to: today })));
  };

  // Top products (excluding cancelled orders).
  const prod = new Map<string, { productId: string; name: string; unitsSold: number; revenue: number }>();
  for (const o of validCur) {
    for (const it of o.items) {
      const e = prod.get(it.productId) ?? { productId: it.productId, name: it.productName, unitsSold: 0, revenue: 0 };
      e.unitsSold += it.quantity;
      e.revenue += it.subtotal;
      prod.set(it.productId, e);
    }
  }
  const topProducts = [...prod.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  // Customer growth: new = first-ever order that day.
  const firstOrder = new Map<string, string>();
  for (const o of [...all].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const k = customerKey(o);
    if (!firstOrder.has(k)) firstOrder.set(k, dayKey(new Date(o.createdAt)));
  }
  const growth = daysInRange(range).map((d) => ({ date: d, newCustomers: 0, returningCustomers: 0 }));
  const growthMap = new Map(growth.map((g) => [g.date, g]));
  const seenPerDay = new Set<string>();
  for (const o of cur) {
    const d = dayKey(new Date(o.createdAt));
    const k = customerKey(o);
    const key = `${d}:${k}`;
    if (seenPerDay.has(key)) continue;
    seenPerDay.add(key);
    const g = growthMap.get(d);
    if (!g) continue;
    if (firstOrder.get(k) === d) g.newCustomers += 1;
    else g.returningCustomers += 1;
  }

  const methodBreakdown = PAYMENT_METHODS.map((method) => {
    const os = validCur.filter((o) => o.paymentMethod === method);
    return { method, orders: os.length, revenue: os.reduce((s, o) => s + o.totalAmount, 0) };
  });

  const cancelled = cur.filter((o) => o.status === 'cancelled');
  const totalViews = Math.max(visCur, 1);
  const popularPages = [
    { path: '/', views: Math.round(totalViews * 0.92) },
    { path: '/products', views: Math.round(totalViews * 0.61) },
    ...topProducts.slice(0, 3).map((p, i) => ({
      path: `/products/${p.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}`,
      views: Math.round(totalViews * (0.28 - i * 0.06)),
    })),
    { path: '/cart', views: Math.round(totalViews * 0.18) },
  ].sort((a, b) => b.views - a.views);

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
    series: buildSeries(all, range, db.visitors[store.id] ?? {}),
    ordersByStatus: countByStatus(cur),
    paymentMethodBreakdown: methodBreakdown,
    topProducts,
    customerGrowth: growth,
    popularPages,
    hasOrders: all.length > 0,
  };
}

export function exportAnalyticsCsv(db: MockDb, store: Store, range: DateRange) {
  const series = buildSeries(storeOrders(db, store), range, db.visitors[store.id] ?? {});
  return { filename: `${store.subdomain}-analytics-${range.from}_to_${range.to}.csv`, csv: seriesToCsv(series) };
}
