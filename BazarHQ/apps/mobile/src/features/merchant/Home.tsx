import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banknote, Bell, Boxes, CreditCard, Package, PackagePlus, Settings, ShoppingBag, Users } from 'lucide-react';
import { formatBDT, formatCompactBDT, formatNumber, makeRange, type DateRange } from '@bazarhq/shared';
import {
  Avatar,
  buttonClass,
  Card,
  ChartFrame,
  DateRangeFilter,
  EmptyState,
  ErrorState,
  LowStockList,
  ProgressBar,
  RecentOrdersList,
  Skeleton,
  StatTile,
  TrendChart,
  useAsync,
  useServiceEvents,
  useServices,
  useSession,
  useUnreadCount,
} from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';
import { paths } from '@/navigation/paths';

const actions = [
  { to: paths.productNew, label: 'Add product', icon: PackagePlus },
  { to: paths.orders, label: 'Orders', icon: ShoppingBag },
  { to: paths.inventory, label: 'Stock', icon: Boxes },
  { to: paths.paymentSettings, label: 'Payments', icon: CreditCard },
];

export function HomeScreen() {
  const services = useServices();
  const { session } = useSession();
  const unread = useUnreadCount();
  const [range, setRange] = useState<DateRange>(() => makeRange('7d'));
  const data = useAsync(() => services.analytics.dashboard(range), [range.from, range.to]);
  const onboarding = useAsync(() => services.store.getOnboarding(), [session?.store?.status]);
  useServiceEvents(() => void data.reload());
  const d = data.data;
  const store = session?.store;

  return (
    <Screen
      title={store?.name ?? 'Dashboard'}
      subtitle="Merchant dashboard"
      onRefresh={() => Promise.all([data.reload(), onboarding.reload()])}
      actions={
        <>
          <Link
            to={paths.notifications}
            aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
            className="relative flex size-11 items-center justify-center rounded-full active:bg-navy-50"
          >
            <Bell className="size-5" aria-hidden />
            {unread > 0 && (
              <span className="absolute right-2 top-2 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white">
                {unread}
              </span>
            )}
          </Link>
          <Link to={paths.storeSettings} aria-label="Profile and settings" className="p-1">
            <Avatar name={session?.user.fullName ?? ''} src={session?.user.avatarUrl} size={34} />
          </Link>
        </>
      }
    >
      <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-white p-4 ring-1 ring-brand-100">
        <p className="text-lg font-bold">Welcome back, {store?.name}!</p>
        <p className="text-sm text-ink-muted">Keep growing your business.</p>
      </div>

      {store?.status === 'draft' && onboarding.data && (
        <Link to={paths.onboarding} className="mt-3 block rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-bold">Store not live yet · {onboarding.data.percent}%</p>
          <ProgressBar value={onboarding.data.percent} label="Setup progress" className="mt-2" />
          <p className="mt-2 text-sm font-semibold text-brand-700">Continue setup ›</p>
        </Link>
      )}

      <div className="mt-4 overflow-x-auto">
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3">
            {!d ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-[var(--radius-card)]" />)
            ) : (
              <>
                <StatTile label="Total sales" metric={d.totalSales} format={formatCompactBDT} icon={<Banknote className="size-4" />} sublabel="" />
                <StatTile label="Orders" metric={d.totalOrders} format={formatNumber} icon={<ShoppingBag className="size-4" />} tone="navy" sublabel="" />
                <StatTile label="Products" metric={d.totalProducts} format={formatNumber} icon={<Package className="size-4" />} tone="violet" sublabel="" />
                <StatTile label="Customers" metric={d.totalCustomers} format={formatNumber} icon={<Users className="size-4" />} tone="amber" sublabel="" />
              </>
            )}
          </div>

          <SectionTitle>Quick actions</SectionTitle>
          <div className="grid grid-cols-4 gap-2">
            {actions.map((a) => (
              <Link
                key={a.to}
                to={a.to}
                className="flex flex-col items-center gap-1.5 rounded-2xl bg-white p-3 text-center text-[12px] font-semibold shadow-[var(--shadow-card)] ring-1 ring-line active:bg-brand-50"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                  <a.icon className="size-5" aria-hidden />
                </span>
                {a.label}
              </Link>
            ))}
          </div>

          <SectionTitle>Sales</SectionTitle>
          <Card className="p-3">
            {!d ? (
              <Skeleton className="h-48" />
            ) : !d.hasOrders ? (
              <EmptyState
                title="No orders yet"
                description="Your sales chart appears after the first order."
                action={
                  <Link to={paths.productNew} className={buttonClass('brand', 'md')}>
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
                    label="Daily revenue"
                    seriesName="Revenue"
                    height={190}
                  />
                }
                table={{ columns: ['Date', 'Orders', 'Revenue'], rows: d.series.map((p) => [p.date, p.orders, formatBDT(p.revenue)]) }}
              />
            )}
          </Card>

          <SectionTitle
            action={
              <Link to={paths.inventory} className="text-sm font-semibold text-brand-700">
                See all
              </Link>
            }
          >
            Low stock
          </SectionTitle>
          <Card className="py-1">{d ? <LowStockList items={d.lowStock.slice(0, 4)} /> : <Skeleton className="m-4 h-32" />}</Card>

          <SectionTitle
            action={
              <Link to={paths.orders} className="text-sm font-semibold text-brand-700">
                See all
              </Link>
            }
          >
            Recent orders
          </SectionTitle>
          <Card className="py-1">{d ? <RecentOrdersList orders={d.recentOrders.slice(0, 5)} /> : <Skeleton className="m-4 h-40" />}</Card>

          <Link to={paths.storeSettings} className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-ink-muted">
            <Settings className="size-4" aria-hidden /> Store settings
          </Link>
        </>
      )}
    </Screen>
  );
}
