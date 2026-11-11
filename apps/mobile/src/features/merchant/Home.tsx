import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronRight,
  Circle,
  CreditCard,
  ExternalLink,
  Package,
  PackagePlus,
  Settings,
  ShoppingBag,
  Store as StoreIcon,
  Users,
} from 'lucide-react';
import { formatBDT, formatCompactBDT, formatNumber, makeRange, type DateRange, type OnboardingStepKey } from '@bazarhq/shared';
import {
  Avatar,
  Badge,
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
  StoreStatusBadge,
  TrendChart,
  useAsync,
  useNative,
  useServiceEvents,
  useServices,
  useSession,
  useUnreadCount,
} from '@bazarhq/ui';
import { Screen, SectionTitle } from '@/components/Screen';
import { paths } from '@/navigation/paths';

const actions = [
  { to: paths.productNew, label: 'Add product', description: 'List something new', icon: PackagePlus },
  { to: paths.orders, label: 'Manage orders', description: 'Confirm and process', icon: ShoppingBag },
  { to: paths.inventory, label: 'Inventory', description: 'Update stock levels', icon: Boxes },
  { to: paths.paymentSettings, label: 'Payments', description: 'Configure checkout', icon: CreditCard },
];

const onboardingLinks: Record<OnboardingStepKey, string> = {
  subdomain: paths.onboardingStore,
  logo: paths.storeSettings,
  payment_method: paths.paymentSettings,
  first_product: paths.productNew,
};

export function HomeScreen() {
  const services = useServices();
  const native = useNative();
  const { session } = useSession();
  const unread = useUnreadCount();
  const [range, setRange] = useState<DateRange>(() => makeRange('7d'));
  const data = useAsync(() => services.analytics.dashboard(range), [range.from, range.to]);
  const onboarding = useAsync(() => services.store.getOnboarding(), [session?.store?.status]);
  const orderCounts = useAsync(() => services.orders.countsByStatus(), []);
  useServiceEvents(() => {
    void data.reload();
    void onboarding.reload();
    void orderCounts.reload();
  });
  const d = data.data;
  const store = session?.store;
  const firstName = session?.user.fullName.trim().split(/\s+/)[0] || 'there';

  const viewStore = async () => {
    if (!store?.subdomain) return;
    const base = (import.meta.env.VITE_PUBLIC_APP_URL ?? 'https://bazarhq.vercel.app').replace(/\/+$/, '');
    const url = `${base}/store/${encodeURIComponent(store.subdomain)}`;
    if (native.openUrl) await native.openUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
  };

  const pendingOrders = orderCounts.data?.pending ?? 0;

  return (
    <Screen
      title="Home"
      subtitle={store?.name ?? 'Merchant dashboard'}
      onRefresh={() => Promise.all([data.reload(), onboarding.reload(), orderCounts.reload()])}
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
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </Link>
          <Link to={paths.storeSettings} aria-label="Profile and settings" className="p-1">
            <Avatar name={session?.user.fullName ?? ''} src={session?.user.avatarUrl} size={34} />
          </Link>
        </>
      }
    >
      {/* Clear store identity and the two most important next actions. */}
      <section className="overflow-hidden rounded-2xl bg-navy-950 p-4 text-white shadow-[var(--shadow-card)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-emerald-300">Merchant workspace</p>
            <h2 className="mt-1 truncate text-xl font-extrabold">Hello, {firstName}</h2>
            <p className="mt-1 truncate text-sm text-slate-300">{store?.name ?? 'Set up your store to get started'}</p>
          </div>
          {store && <StoreStatusBadge status={store.status} />}
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-slate-300">Here is your store activity and the tasks that need your attention.</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => void viewStore()} disabled={!store?.subdomain} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-500 px-3 text-sm font-bold text-white transition hover:bg-emerald-400 disabled:opacity-50">
            <ExternalLink className="size-4" aria-hidden /> View storefront
          </button>
          <Link to={paths.storeSettings} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/25 px-3 text-sm font-semibold text-white hover:bg-white/10">
            <Settings className="size-4" aria-hidden /> Store settings
          </Link>
        </div>
      </section>

      {store?.status === 'draft' && onboarding.data && (
        <Card className="mt-4 border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-amber-950">Finish setting up your store</p>
              <p className="mt-0.5 text-[12.5px] text-amber-900">Complete the steps below before publishing.</p>
            </div>
            <Badge tone="warning">{onboarding.data.percent}%</Badge>
          </div>
          <ProgressBar value={onboarding.data.percent} label="Store setup progress" className="mt-3" />
          <ul className="mt-3 space-y-2">
            {onboarding.data.steps.map((step) => (
              <li key={step.key}>
                <Link to={onboardingLinks[step.key]} className="flex items-center gap-2 rounded-lg py-1 text-[13px] font-medium text-amber-950">
                  {step.done ? <CheckCircle2 className="size-4 shrink-0 text-emerald-700" aria-hidden /> : <Circle className="size-4 shrink-0 text-amber-700" aria-hidden />}
                  <span className={step.done ? 'text-amber-900/70 line-through' : ''}>{step.label}</span>
                  {!step.done && <ChevronRight className="ml-auto size-4" aria-hidden />}
                </Link>
              </li>
            ))}
          </ul>
          <Link to={paths.onboarding} className="mt-3 inline-flex text-sm font-bold text-amber-950 underline underline-offset-2">Continue setup</Link>
        </Card>
      )}

      {pendingOrders > 0 && (
        <Link to={paths.orders} className="mt-4 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800"><ShoppingBag className="size-5" aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold text-emerald-950">{pendingOrders} new {pendingOrders === 1 ? 'order' : 'orders'} need attention</span>
            <span className="block text-[12px] text-emerald-800">Review and confirm customer orders.</span>
          </span>
          <ChevronRight className="size-5 text-emerald-800" aria-hidden />
        </Link>
      )}

      <SectionTitle>Your store at a glance</SectionTitle>
      {data.error ? (
        <ErrorState message={data.error} onRetry={data.reload} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {!d ? (
            Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[118px] rounded-[var(--radius-card)]" />)
          ) : (
            <>
              <StatTile label="Sales" metric={d.totalSales} format={formatCompactBDT} icon={<Banknote className="size-4" />} sublabel="selected period" />
              <StatTile label="Orders" metric={d.totalOrders} format={formatNumber} icon={<ShoppingBag className="size-4" />} tone="navy" sublabel="selected period" />
              <StatTile label="Products" metric={d.totalProducts} format={formatNumber} icon={<Package className="size-4" />} tone="violet" sublabel="in your catalogue" />
              <StatTile label="Customers" metric={d.totalCustomers} format={formatNumber} icon={<Users className="size-4" />} tone="amber" sublabel="selected period" />
            </>
          )}
        </div>
      )}

      <SectionTitle>Quick actions</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className="flex min-h-[88px] items-center gap-3 rounded-2xl border border-line bg-white p-3 shadow-[var(--shadow-card)] transition active:scale-[0.99] active:bg-brand-50">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <action.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-bold leading-tight text-ink">{action.label}</span>
              <span className="mt-1 block text-[11.5px] leading-snug text-ink-muted">{action.description}</span>
            </span>
          </Link>
        ))}
      </div>

      <SectionTitle>Sales performance</SectionTitle>
      <div className="mb-2 overflow-x-auto"><DateRangeFilter value={range} onChange={setRange} /></div>
      <Card className="p-3">
        {!d ? (
          <Skeleton className="h-48" />
        ) : !d.hasOrders ? (
          <EmptyState
            icon={<Banknote className="size-6" aria-hidden />}
            title="No sales yet"
            description="Your sales chart will appear after the first customer order. Add products and share your storefront to get started."
            action={<Link to={paths.productNew} className={buttonClass('brand', 'md')}>Add your first product</Link>}
          />
        ) : (
          <ChartFrame
            chart={<TrendChart data={d.series.map((point) => ({ x: point.date, y: point.revenue }))} formatValue={formatBDT} formatAxis={formatCompactBDT} label="Daily revenue" seriesName="Revenue" height={190} />}
            table={{ columns: ['Date', 'Orders', 'Revenue'], rows: d.series.map((point) => [point.date, point.orders, formatBDT(point.revenue)]) }}
          />
        )}
      </Card>

      <SectionTitle action={<Link to={paths.inventory} className="text-sm font-semibold text-brand-700">See all</Link>}>Inventory attention</SectionTitle>
      <Card className="py-1">
        {d ? <LowStockList items={d.lowStock.slice(0, 4)} /> : <Skeleton className="m-4 h-32" />}
      </Card>

      <SectionTitle action={<Link to={paths.orders} className="text-sm font-semibold text-brand-700">See all</Link>}>Recent orders</SectionTitle>
      <Card className="py-1">
        {d ? <RecentOrdersList orders={d.recentOrders.slice(0, 5)} /> : <Skeleton className="m-4 h-40" />}
      </Card>

      <Link to={paths.storeSettings} className="mt-4 flex items-center justify-center gap-2 py-2 text-sm font-semibold text-ink-muted">
        <StoreIcon className="size-4" aria-hidden /> Manage store profile
      </Link>
    </Screen>
  );
}
