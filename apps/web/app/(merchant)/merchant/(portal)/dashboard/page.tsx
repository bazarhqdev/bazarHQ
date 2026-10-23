'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Banknote, Boxes, CreditCard, Package, PackagePlus, Settings, ShoppingBag, Users } from 'lucide-react';
import { formatBDT, formatCompactBDT, formatNumber, makeRange, type DateRange } from '@bazarhq/shared';
import {
  Alert,
  buttonClass,
  Card,
  CardHeader,
  ChartFrame,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  LowStockList,
  NotificationList,
  PageHeader,
  ProgressBar,
  RecentOrdersList,
  Skeleton,
  StatTile,
  TrendChart,
  useAsync,
  useServiceEvents,
  useServices,
  useSession,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

const quickActions = [
  { href: paths.productNew, label: 'Add product', icon: PackagePlus },
  { href: paths.orders, label: 'View orders', icon: ShoppingBag },
  { href: paths.inventory, label: 'Inventory', icon: Boxes },
  { href: paths.paymentSettings, label: 'Payments', icon: CreditCard },
  { href: paths.storeSettings, label: 'Store settings', icon: Settings },
];

export default function DashboardPage() {
  const services = useServices();
  const { session } = useSession();
  const [range, setRange] = useState<DateRange>(() => makeRange('30d'));
  const data = useAsync(() => services.analytics.dashboard(range), [range.from, range.to]);
  const onboarding = useAsync(() => services.store.getOnboarding(), [session?.store?.status]);
  useServiceEvents(() => void data.reload());

  const store = session?.store;
  const d = data.data;

  return (
    <>
      <title>Dashboard · BazarHQ Merchant</title>
      <PageHeader
        title={`Welcome back, ${session?.user.fullName.split(' ')[0] ?? ''}`}
        description="Here’s how your store is doing."
        actions={<DateRangeFilter value={range} onChange={setRange} />}
      />

      {store?.status === 'draft' && onboarding.data && (
        <Card className="mb-5 border-amber-200 bg-amber-50/60 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">Your store isn’t live yet — {onboarding.data.percent}% set up</p>
              <p className="text-sm text-ink-muted">Complete the checklist and enable a payment method to publish.</p>
              <ProgressBar value={onboarding.data.percent} label="Setup progress" className="mt-3 max-w-md" />
            </div>
            <Link href={paths.onboarding} className={buttonClass('primary', 'md')}>
              Continue setup
            </Link>
          </div>
        </Card>
      )}

      {data.error ? (
        <Card>
          <ErrorState message={data.error} onRetry={data.reload} />
        </Card>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {!d ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-[var(--radius-card)]" />)
            ) : (
              <>
                <StatTile label="Total sales" metric={d.totalSales} format={formatBDT} icon={<Banknote className="size-[18px]" />} />
                <StatTile label="Total orders" metric={d.totalOrders} format={formatNumber} icon={<ShoppingBag className="size-[18px]" />} tone="navy" />
                <StatTile
                  label="Total products"
                  metric={d.totalProducts}
                  format={formatNumber}
                  icon={<Package className="size-[18px]" />}
                  tone="violet"
                  sublabel="vs start of period"
                />
                <StatTile label="Customers" metric={d.totalCustomers} format={formatNumber} icon={<Users className="size-[18px]" />} tone="amber" />
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader title="Sales overview" description="Daily revenue. Cancelled orders are excluded." />
              <div className="px-5 pb-5">
                {!d ? (
                  <Skeleton className="h-[240px]" />
                ) : !d.hasOrders ? (
                  <EmptyState
                    icon={<ShoppingBag className="size-6" aria-hidden />}
                    title="No orders yet"
                    description="Your sales chart appears after your first order. Share your store link and make sure a payment method and products are live."
                    action={
                      <Link href={paths.productNew} className={buttonClass('brand', 'md')}>
                        Add a product
                      </Link>
                    }
                  />
                ) : (
                  <ChartFrame
                    chart={
                      <TrendChart
                        data={d.series.map((p) => ({ x: p.date, y: p.revenue }))}
                        formatValue={formatBDT}
                        formatAxis={formatCompactBDT}
                        label="Daily revenue for the selected period"
                        seriesName="Revenue"
                        height={240}
                      />
                    }
                    table={{ columns: ['Date', 'Orders', 'Revenue'], rows: d.series.map((p) => [p.date, p.orders, formatBDT(p.revenue)]) }}
                  />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader
                title="Low-stock alerts"
                action={
                  <Link href={paths.inventory} className="text-[13px] font-semibold text-brand-700 hover:underline">
                    Inventory
                  </Link>
                }
              />
              {!d ? <Skeleton className="mx-5 mb-5 h-48" /> : <LowStockList items={d.lowStock} />}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader
                title="Recent orders"
                action={
                  <Link href={paths.orders} className="text-[13px] font-semibold text-brand-700 hover:underline">
                    View all
                  </Link>
                }
              />
              {!d ? (
                <Skeleton className="mx-5 mb-5 h-64" />
              ) : d.recentOrders.length ? (
                <RecentOrdersList orders={d.recentOrders} />
              ) : (
                <p className="px-5 pb-5 text-sm text-ink-muted">No orders yet.</p>
              )}
            </Card>
            <div className="space-y-5">
              <Card>
                <CardHeader title="Quick actions" />
                <div className="grid grid-cols-3 gap-2 px-5 pb-5 sm:grid-cols-5 xl:grid-cols-3">
                  {quickActions.map((a) => (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="flex flex-col items-center gap-1.5 rounded-xl border border-line p-3 text-center text-[12.5px] font-semibold text-ink hover:border-brand-600 hover:bg-brand-50"
                    >
                      <a.icon className="size-5 text-brand-700" aria-hidden />
                      {a.label}
                    </Link>
                  ))}
                </div>
              </Card>
              <Card>
                <CardHeader
                  title="Recent notifications"
                  action={
                    <Link href={paths.notifications} className="text-[13px] font-semibold text-brand-700 hover:underline">
                      View all
                    </Link>
                  }
                />
                {!d ? (
                  <Skeleton className="mx-5 mb-5 h-40" />
                ) : d.recentNotifications.length ? (
                  <NotificationList items={d.recentNotifications} dense />
                ) : (
                  <p className="px-5 pb-5 text-sm text-ink-muted">You’re all caught up.</p>
                )}
              </Card>
            </div>
          </div>
          {d && d.lowStock.some((l) => l.state === 'out_of_stock') && (
            <Alert tone="warning" title="Some items are out of stock">
              Customers can’t buy out-of-stock products or variants. Restock them from Inventory.
            </Alert>
          )}
        </div>
      )}
    </>
  );
}
