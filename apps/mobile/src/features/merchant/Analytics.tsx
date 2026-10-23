import { useState } from 'react';
import { Activity, Banknote, Eye, Receipt, ShoppingBag } from 'lucide-react';
import { formatBDT, formatCompactBDT, formatNumber, formatPercent, makeRange, PAYMENT_METHOD_LABEL, type DateRange } from '@bazarhq/shared';
import {
  BarChart,
  Card,
  ChartFrame,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  NotificationList,
  RankedBars,
  Skeleton,
  StatTile,
  TrendChart,
  useAsync,
  useServices,
} from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';

/** "Store performance" screen from the APK reference. */
export function AnalyticsScreen() {
  const services = useServices();
  const [range, setRange] = useState<DateRange>(() => makeRange('30d'));
  const report = useAsync(() => services.analytics.report(range), [range.from, range.to]);
  const notes = useAsync(() => services.notifications.list(), []);
  const r = report.data;

  return (
    <Screen title="Store performance" onRefresh={report.reload}>
      <div className="overflow-x-auto">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>
      {report.error ? (
        <ErrorState message={report.error} onRetry={report.reload} />
      ) : !r ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[118px] rounded-[var(--radius-card)]" />
          ))}
        </div>
      ) : !r.hasOrders ? (
        <EmptyState icon={<Activity className="size-6" aria-hidden />} title="No data yet" description="Analytics appear after your first order." />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <StatTile label="Revenue" metric={r.revenue} format={formatCompactBDT} icon={<Banknote className="size-4" />} sublabel="" />
            <StatTile label="Orders" metric={r.orders} format={formatNumber} icon={<ShoppingBag className="size-4" />} tone="navy" sublabel="" />
            <StatTile label="Visitors" metric={r.visitors} format={formatNumber} icon={<Eye className="size-4" />} tone="amber" sublabel="" />
            <StatTile
              label="Conversion"
              metric={r.conversionRate}
              format={(v) => formatPercent(v)}
              icon={<Activity className="size-4" />}
              tone="violet"
              sublabel=""
            />
          </div>
          <Card className="mt-3 flex items-center justify-between p-4">
            <span className="flex items-center gap-2 text-sm text-ink-muted">
              <Receipt className="size-4" aria-hidden /> Avg. order value
            </span>
            <span className="font-bold tabular">{formatBDT(r.averageOrderValue.value)}</span>
          </Card>

          <SectionTitle>Revenue trend</SectionTitle>
          <Card className="p-3">
            <ChartFrame
              chart={
                <TrendChart
                  data={r.series.map((p) => ({ x: p.date, y: p.revenue }))}
                  formatValue={formatBDT}
                  formatAxis={formatCompactBDT}
                  label="Daily revenue"
                  seriesName="Revenue"
                  height={190}
                />
              }
              table={{ columns: ['Date', 'Revenue'], rows: r.series.map((p) => [p.date, formatBDT(p.revenue)]) }}
            />
          </Card>

          <SectionTitle>Orders per day</SectionTitle>
          <Card className="p-3">
            <ChartFrame
              chart={
                <BarChart
                  labels={r.series.map((p) => p.date)}
                  series={[{ name: 'Orders', color: 'var(--color-chart-1)', values: r.series.map((p) => p.orders) }]}
                  formatValue={(v) => formatNumber(Math.round(v))}
                  label="Orders per day"
                  height={170}
                />
              }
              table={{ columns: ['Date', 'Orders'], rows: r.series.map((p) => [p.date, p.orders]) }}
            />
          </Card>

          <SectionTitle>Top products</SectionTitle>
          <Card className="p-4">
            <RankedBars
              items={r.topProducts.map((p) => ({ key: p.productId, label: p.name, sublabel: `${p.unitsSold} sold`, value: p.revenue }))}
              formatValue={formatBDT}
            />
          </Card>

          <SectionTitle>Payment methods</SectionTitle>
          <Card className="p-4">
            <RankedBars
              items={r.paymentMethodBreakdown.map((m) => ({ key: m.method, label: PAYMENT_METHOD_LABEL[m.method], sublabel: `${m.orders}`, value: m.revenue }))}
              formatValue={formatBDT}
            />
          </Card>
          <p className="mt-2 text-[12px] text-ink-subtle">
            Cancelled: {r.cancelled.orders} orders ({formatBDT(r.cancelled.value)}) — excluded from revenue.
          </p>

          <SectionTitle>Recent notifications</SectionTitle>
          <Card className="py-1">{notes.data ? <NotificationList items={notes.data.slice(0, 3)} dense /> : <Skeleton className="m-4 h-24" />}</Card>
        </>
      )}
    </Screen>
  );
}
