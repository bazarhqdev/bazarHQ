'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Activity, Banknote, Download, Eye, Receipt, ShoppingBag } from 'lucide-react';
import {
  errorMessage,
  formatBDT,
  formatCompactBDT,
  formatNumber,
  formatPercent,
  makeRange,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABEL,
  type DateRange,
} from '@bazarhq/shared';
import {
  BarChart,
  Button,
  buttonClass,
  Card,
  CardHeader,
  ChartFrame,
  DateRangeFilter,
  downloadText,
  EmptyState,
  ErrorState,
  Legend,
  OrderStatusBadge,
  PageHeader,
  RankedBars,
  Skeleton,
  StatTile,
  TrendChart,
  useAsync,
  useServices,
  useToast,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

export default function AnalyticsPage() {
  const services = useServices();
  const toast = useToast();
  const [range, setRange] = useState<DateRange>(() => makeRange('30d'));
  const report = useAsync(() => services.analytics.report(range), [range.from, range.to]);
  const [exporting, setExporting] = useState(false);
  const r = report.data;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { filename, csv } = await services.analytics.exportCsv(range);
      downloadText(filename, csv);
      toast.success('Export ready', filename);
    } catch (e) {
      toast.error('Export failed', errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <title>Analytics · BazarHQ Merchant</title>
      <PageHeader
        title="Analytics"
        description="Sales, orders and customers for your store. Cancelled orders are excluded from revenue."
        actions={
          <>
            <DateRangeFilter value={range} onChange={setRange} />
            <Button variant="secondary" icon={<Download className="size-4" aria-hidden />} loading={exporting} onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          </>
        }
      />
      {report.error ? (
        <Card>
          <ErrorState message={report.error} onRetry={report.reload} />
        </Card>
      ) : !r ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[118px] rounded-[var(--radius-card)]" />
            ))}
          </div>
          <Skeleton className="h-80 rounded-[var(--radius-card)]" />
        </div>
      ) : !r.hasOrders ? (
        <Card>
          <EmptyState
            icon={<Activity className="size-6" aria-hidden />}
            title="Analytics will appear after your first order"
            description="Finish setup, add products and share your store link. Charts fill in automatically."
            action={
              <Link href={paths.onboarding} className={buttonClass('brand', 'md')}>
                Review setup checklist
              </Link>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatTile label="Revenue" metric={r.revenue} format={formatBDT} icon={<Banknote className="size-[18px]" />} />
            <StatTile label="Orders" metric={r.orders} format={formatNumber} icon={<ShoppingBag className="size-[18px]" />} tone="navy" />
            <StatTile label="Avg. order value" metric={r.averageOrderValue} format={formatBDT} icon={<Receipt className="size-[18px]" />} tone="violet" />
            <StatTile label="Visitors" metric={r.visitors} format={formatNumber} icon={<Eye className="size-[18px]" />} tone="amber" />
            <StatTile label="Conversion rate" metric={r.conversionRate} format={(v) => formatPercent(v)} icon={<Activity className="size-[18px]" />} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[
              ['Today', r.revenueToday],
              ['Last 7 days', r.revenueThisWeek],
              ['Last 30 days', r.revenueThisMonth],
            ].map(([label, v]) => (
              <Card key={label as string} as="div" className="p-4">
                <p className="text-[13px] font-semibold text-ink-muted">Revenue · {label}</p>
                <p className="mt-1 text-xl font-bold tabular">{formatBDT(v as number)}</p>
              </Card>
            ))}
            <Card as="div" className="border-red-100 p-4">
              <p className="text-[13px] font-semibold text-ink-muted">Cancelled (not in revenue)</p>
              <p className="mt-1 text-xl font-bold tabular">
                {r.cancelled.orders} <span className="text-sm font-semibold text-ink-muted">· {formatBDT(r.cancelled.value)}</span>
              </p>
            </Card>
          </div>

          <Card>
            <CardHeader title="Revenue trend" description="Daily revenue for the selected period." />
            <div className="px-5 pb-5">
              <ChartFrame
                chart={
                  <TrendChart
                    data={r.series.map((p) => ({ x: p.date, y: p.revenue }))}
                    formatValue={formatBDT}
                    formatAxis={formatCompactBDT}
                    label="Daily revenue"
                    seriesName="Revenue"
                    height={260}
                  />
                }
                table={{
                  columns: ['Date', 'Revenue', 'Orders', 'Cancelled'],
                  rows: r.series.map((p) => [p.date, formatBDT(p.revenue), p.orders, p.cancelled]),
                }}
              />
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Order trend" description="Orders placed per day, including cancelled." />
              <div className="px-5 pb-5">
                <ChartFrame
                  chart={
                    <BarChart
                      labels={r.series.map((p) => p.date)}
                      series={[{ name: 'Orders', color: 'var(--color-chart-1)', values: r.series.map((p) => p.orders) }]}
                      formatValue={(v) => formatNumber(Math.round(v))}
                      label="Orders per day"
                    />
                  }
                  table={{ columns: ['Date', 'Orders'], rows: r.series.map((p) => [p.date, p.orders]) }}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Customer growth" description="Customers ordering each day: first-time vs returning." />
              <div className="px-5 pb-5">
                <ChartFrame
                  legend={
                    <Legend
                      items={[
                        { name: 'New', color: 'var(--color-chart-1)' },
                        { name: 'Returning', color: 'var(--color-chart-2)' },
                      ]}
                    />
                  }
                  chart={
                    <BarChart
                      labels={r.customerGrowth.map((g) => g.date)}
                      series={[
                        { name: 'New', color: 'var(--color-chart-1)', values: r.customerGrowth.map((g) => g.newCustomers) },
                        { name: 'Returning', color: 'var(--color-chart-2)', values: r.customerGrowth.map((g) => g.returningCustomers) },
                      ]}
                      formatValue={(v) => formatNumber(Math.round(v))}
                      label="New and returning customers per day"
                    />
                  }
                  table={{ columns: ['Date', 'New', 'Returning'], rows: r.customerGrowth.map((g) => [g.date, g.newCustomers, g.returningCustomers]) }}
                />
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Top products" description="By revenue in this period." />
              <div className="px-5 pb-5">
                <RankedBars
                  items={r.topProducts.map((p) => ({ key: p.productId, label: p.name, sublabel: `${p.unitsSold} sold`, value: p.revenue }))}
                  formatValue={formatBDT}
                />
              </div>
            </Card>
            <Card>
              <CardHeader title="Orders by status" />
              <ul className="space-y-2 px-5 pb-5">
                {ORDER_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between text-sm">
                    <OrderStatusBadge status={s} />
                    <span className="font-semibold tabular" aria-label={`${ORDER_STATUS_LABEL[s]}: ${r.ordersByStatus[s]}`}>
                      {r.ordersByStatus[s]}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Payment methods" description="Revenue by method (excl. cancelled)." />
              <div className="px-5 pb-5">
                <RankedBars
                  items={r.paymentMethodBreakdown.map((m) => ({
                    key: m.method,
                    label: PAYMENT_METHOD_LABEL[m.method],
                    sublabel: `${m.orders} orders`,
                    value: m.revenue,
                  }))}
                  formatValue={formatBDT}
                />
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Popular pages" description="Storefront page views (unique sessions)." />
            <div className="px-5 pb-5">
              <RankedBars
                items={r.popularPages.map((p) => ({ key: p.path, label: <code className="text-[13px]">{p.path}</code>, value: p.views }))}
                formatValue={formatNumber}
                color="var(--color-chart-2)"
              />
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
