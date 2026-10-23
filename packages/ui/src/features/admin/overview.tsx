'use client';

/** Super Admin overview: dashboard, system health, audit log, notifications, profile. */
import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Banknote, Bell, CheckCircle2, Gavel, ScrollText, ShieldCheck, ShoppingBag, Store, Users, XCircle } from 'lucide-react';
import {
  formatBDT,
  formatCompactBDT,
  formatDateTime,
  formatNumber,
  formatRelative,
  HEALTH_STATUS_LABEL,
  makeRange,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABEL,
  type AuditLog,
  type DateRange,
  type HealthStatus,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import { ChartFrame, RankedBars, TrendChart } from '../../charts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  PageHeader,
  PaymentMethodMark,
  SearchInput,
  SelectField,
  Skeleton,
  SkeletonRows,
  TableWrap,
  td,
  th,
} from '../../components';
import { adminNotificationHref, useAdminPaths, useAsync, useDebounced, useNavigation, useServiceEvents, useServices, useSession } from '../../context';
import { DateRangeFilter, NotificationList, StatTile } from '../dashboard';

export const healthTone: Record<HealthStatus, 'success' | 'warning' | 'danger'> = { operational: 'success', degraded: 'warning', outage: 'danger' };

export function HealthBadge({ status }: { status: HealthStatus }) {
  return (
    <Badge tone={healthTone[status]} dot>
      {HEALTH_STATUS_LABEL[status]}
    </Badge>
  );
}

/** Human labels for audit actions such as `merchant.suspended`. */
export function auditLabel(action: string): string {
  const s = action.replace(/[._]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function AuditRows({ logs, compact }: { logs: AuditLog[]; compact?: boolean }) {
  if (logs.length === 0) return <EmptyState icon={<ScrollText className="size-6" aria-hidden />} title="No audit entries" />;
  return (
    <ul className="divide-y divide-line">
      {logs.map((l) => (
        <li key={l.id} className={cn('flex gap-3 px-5', compact ? 'py-2.5' : 'py-3')}>
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
            <ShieldCheck className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">{auditLabel(l.action)}</p>
            <p className="truncate text-[12.5px] text-ink-muted">
              {l.actorName ?? 'System'} · {l.resourceType}
              {Object.keys(l.metadata).length > 0 &&
                ` · ${Object.entries(l.metadata)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}`}
            </p>
          </div>
          <div className="shrink-0 text-right text-[12px] text-ink-subtle">
            <p title={formatDateTime(l.createdAt)}>{formatRelative(l.createdAt)}</p>
            {l.ipAddress && !compact && <p className="font-mono">{l.ipAddress}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */

export function AdminDashboardView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [range, setRange] = useState<DateRange>(() => makeRange('30d'));
  const data = useAsync(() => services.admin.dashboard(range), [range.from, range.to]);
  useServiceEvents(() => void data.reload());
  const d = data.data;
  return (
    <>
      <PageHeader
        title="Platform overview"
        description="All BazarHQ stores. Merchant business data is read-only here."
        actions={<DateRangeFilter value={range} onChange={setRange} />}
      />
      {data.error ? (
        <Card>
          <ErrorState message={data.error} onRetry={data.reload} />
        </Card>
      ) : (
        <div className="space-y-5">
          {d && (d.openDisputes > 0 || d.stalledRefunds > 0 || d.health !== 'operational') && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {d.health !== 'operational' && (
                <Link
                  href={a.systemHealth}
                  className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-950 hover:border-amber-300"
                >
                  <AlertTriangle className="size-5 shrink-0" aria-hidden />{' '}
                  <span>
                    <strong>System {HEALTH_STATUS_LABEL[d.health].toLowerCase()}</strong> — check system health
                  </span>
                </Link>
              )}
              {d.openDisputes > 0 && (
                <Link
                  href={a.disputes}
                  className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-950 hover:border-violet-300"
                >
                  <Gavel className="size-5 shrink-0" aria-hidden />{' '}
                  <span>
                    <strong>
                      {d.openDisputes} open dispute{d.openDisputes === 1 ? '' : 's'}
                    </strong>{' '}
                    awaiting review
                  </span>
                </Link>
              )}
              {d.stalledRefunds > 0 && (
                <Link
                  href={a.refunds}
                  className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-950 hover:border-red-300"
                >
                  <Banknote className="size-5 shrink-0" aria-hidden />{' '}
                  <span>
                    <strong>
                      {d.stalledRefunds} refund{d.stalledRefunds === 1 ? '' : 's'}
                    </strong>{' '}
                    stalled over 5 days
                  </span>
                </Link>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {!d ? (
              Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-[108px] rounded-[var(--radius-card)]" />)
            ) : (
              <>
                <StatTile
                  label="Merchants"
                  metric={d.merchants}
                  format={formatNumber}
                  icon={<Users className="size-[18px]" />}
                  tone="navy"
                  sublabel="vs start of period"
                />
                <StatTile label="Live stores" metric={d.activeStores} format={formatNumber} icon={<Store className="size-[18px]" />} sublabel="published now" />
                <StatTile label="Orders" metric={d.orders} format={formatNumber} icon={<ShoppingBag className="size-[18px]" />} tone="violet" />
                <StatTile label="GMV" metric={d.revenue} format={formatBDT} icon={<Banknote className="size-[18px]" />} />
                <StatTile
                  label="Customers"
                  metric={d.customers}
                  format={formatNumber}
                  icon={<Users className="size-[18px]" />}
                  tone="amber"
                  sublabel="registered accounts"
                />
              </>
            )}
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card>
              <CardHeader title="Platform GMV" description="Revenue from non-cancelled orders across all stores." />
              <div className="px-5 pb-5">
                {!d ? (
                  <Skeleton className="h-60 w-full" />
                ) : (
                  <ChartFrame
                    chart={
                      <TrendChart
                        data={d.series.map((p) => ({ x: p.date, y: p.revenue }))}
                        formatValue={formatBDT}
                        formatAxis={formatCompactBDT}
                        label="Daily platform GMV"
                        seriesName="GMV"
                        height={240}
                      />
                    }
                    table={{ columns: ['Date', 'GMV', 'Orders'], rows: d.series.map((p) => [p.date, formatBDT(p.revenue), p.orders]) }}
                  />
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Top stores" description="By GMV in this period." />
              <div className="px-5 pb-5">
                {!d ? (
                  <SkeletonRows rows={5} />
                ) : (
                  <RankedBars
                    items={d.topMerchants.map((m) => ({ key: m.storeId, label: m.storeName, value: m.revenue, sublabel: `${m.orders} orders` }))}
                    formatValue={formatBDT}
                    emptyLabel="No orders in this period."
                  />
                )}
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="Orders by status" />
              <ul className="space-y-2 px-5 pb-5 text-sm">
                {ORDER_STATUSES.map((s) => (
                  <li key={s} className="flex items-center justify-between">
                    <span className="text-ink-muted">{ORDER_STATUS_LABEL[s]}</span>
                    <span className="font-semibold tabular">{d ? formatNumber(d.ordersByStatus[s] ?? 0) : '–'}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Payment methods" description="Share of non-cancelled orders." />
              <ul className="space-y-2.5 px-5 pb-5 text-sm">
                {(d?.paymentMethodBreakdown ?? []).map((m) => {
                  const total = d!.paymentMethodBreakdown.reduce((s, x) => s + x.orders, 0) || 1;
                  return (
                    <li key={m.method}>
                      <div className="flex items-center gap-2">
                        <PaymentMethodMark method={m.method} size={22} />
                        <span className="flex-1">{PAYMENT_METHOD_LABEL[m.method]}</span>
                        <span className="tabular text-ink-muted">{m.orders}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-canvas">
                        <div className="h-1.5 rounded-full bg-[var(--color-chart-1)]" style={{ width: `${(m.orders / total) * 100}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
            <Card>
              <CardHeader
                title="Recent admin activity"
                action={
                  <Link href={a.auditLogs} className="text-sm font-semibold text-brand-700 hover:underline">
                    Audit log
                  </Link>
                }
              />
              {!d ? <SkeletonRows rows={4} /> : <AuditRows logs={d.recentActivity.slice(0, 5)} compact />}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

export function SystemHealthView() {
  const services = useServices();
  const [tick, setTick] = useState(0);
  const h = useAsync(() => services.admin.health(), [tick]);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <PageHeader
        title="System health"
        description="Uptime and latency of platform services. Outages also raise an admin alert."
        actions={
          <Button size="sm" variant="secondary" icon={<Activity className="size-4" aria-hidden />} loading={h.refreshing} onClick={() => setTick((x) => x + 1)}>
            Refresh
          </Button>
        }
      />
      {h.error ? (
        <ErrorState message={h.error} onRetry={h.reload} />
      ) : !h.data ? (
        <Skeleton className="h-80 w-full" />
      ) : (
        <div className="space-y-5">
          <Alert
            tone={h.data.overall === 'operational' ? 'success' : h.data.overall === 'degraded' ? 'warning' : 'danger'}
            title={`Overall: ${HEALTH_STATUS_LABEL[h.data.overall]}`}
          >
            {h.data.components
              .filter((c) => c.status !== 'operational')
              .map((c) => c.name)
              .join(', ') || 'All components are operating normally.'}
          </Alert>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {h.data.components.map((c) => (
              <li key={c.key}>
                <Card className="h-full p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{c.name}</p>
                    {c.status === 'operational' ? (
                      <CheckCircle2 className="size-5 text-brand-600" aria-label="Operational" />
                    ) : c.status === 'degraded' ? (
                      <AlertTriangle className="size-5 text-amber-600" aria-label="Degraded" />
                    ) : (
                      <XCircle className="size-5 text-red-600" aria-label="Outage" />
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-[13px]">
                    <div>
                      <dt className="text-ink-subtle">Latency</dt>
                      <dd className="font-semibold tabular">{c.responseMs} ms</dd>
                    </div>
                    <div>
                      <dt className="text-ink-subtle">Errors</dt>
                      <dd className={cn('font-semibold tabular', c.errorRatePct > 2 && 'text-amber-700')}>{c.errorRatePct.toFixed(1)}%</dd>
                    </div>
                  </dl>
                  {c.note && <p className="mt-2 text-[12.5px] text-amber-900">{c.note}</p>}
                  <p className="mt-2 text-[11.5px] text-ink-subtle">Checked {formatRelative(c.lastCheckedAt)}</p>
                </Card>
              </li>
            ))}
          </ul>
          <Card>
            <CardHeader title="Recent system log" />
            <ul className="divide-y divide-line">
              {h.data.recentLogs.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-5 py-3 text-sm">
                  <Badge tone={l.level === 'error' ? 'danger' : l.level === 'warn' ? 'warning' : 'neutral'}>{l.level.toUpperCase()}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink">{l.message}</p>
                    <p className="text-[12px] text-ink-subtle">
                      {l.component} · {formatDateTime(l.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

const RESOURCE_TYPES = [
  'all',
  'merchant',
  'store',
  'theme',
  'announcement',
  'policy',
  'support_ticket',
  'return',
  'refund',
  'payment_transaction',
  'order',
  'session',
  'profile',
];

export function AuditLogView() {
  const services = useServices();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useDebounced(search);
  const logs = useAsync(
    () => services.admin.listAuditLogs({ search: q, resourceType: type, from: from || undefined, to: to || undefined }),
    [q, type, from, to],
  );
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of privileged actions (actor, resource, IP, time). Entries cannot be edited or deleted." />
      <Card>
        <div className="grid grid-cols-1 gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_1fr_auto]">
          <SearchInput value={search} onChange={setSearch} placeholder="Action, actor or detail" label="Search audit log" />
          <SelectField
            aria-label="Resource type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={RESOURCE_TYPES.map((t) => ({ value: t, label: t === 'all' ? 'All resources' : t.replace('_', ' ') }))}
          />
          <div className="flex items-center gap-1.5">
            <label htmlFor="al-from" className="sr-only">
              From
            </label>
            <input
              id="al-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2 text-sm"
            />
            <span className="text-[12px] text-ink-subtle">to</span>
            <label htmlFor="al-to" className="sr-only">
              To
            </label>
            <input
              id="al-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-2 text-sm"
            />
          </div>
        </div>
        {logs.loading ? (
          <SkeletonRows rows={8} />
        ) : logs.error ? (
          <ErrorState message={logs.error} onRetry={logs.reload} />
        ) : (
          <>
            <TableWrap className="hidden md:block">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/60">
                  <tr>
                    {['When', 'Actor', 'Action', 'Resource', 'Details', 'IP'].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {logs.data!.map((l) => (
                    <tr key={l.id}>
                      <td className={`${td} whitespace-nowrap text-[13px]`}>{formatDateTime(l.createdAt)}</td>
                      <td className={td}>{l.actorName ?? 'System'}</td>
                      <td className={`${td} font-semibold`}>{auditLabel(l.action)}</td>
                      <td className={`${td} text-[13px] text-ink-muted`}>{l.resourceType}</td>
                      <td className={`${td} max-w-[320px] truncate text-[13px] text-ink-muted`} title={JSON.stringify(l.metadata)}>
                        {Object.entries(l.metadata)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(' · ') || '—'}
                      </td>
                      <td className={`${td} font-mono text-[12px]`}>{l.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <div className="md:hidden">
              <AuditRows logs={logs.data!} />
            </div>
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-subtle">{logs.data!.length} entries</p>
          </>
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */

export function AdminNotificationsView() {
  const services = useServices();
  const a = useAdminPaths();
  const list = useAsync(() => services.notifications.list(), []);
  useEffect(() => services.notifications.subscribe(() => void list.reload()), [services, list.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          <Button size="sm" variant="secondary" onClick={() => services.notifications.markAllRead().then(list.reload)}>
            Mark all read
          </Button>
        }
      />
      <Card>
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : (list.data?.length ?? 0) === 0 ? (
          <EmptyState icon={<Bell className="size-6" aria-hidden />} title="No notifications" />
        ) : (
          <NotificationList
            items={list.data!}
            hrefFor={(n) => adminNotificationHref(n, a)}
            onOpen={(n) => void services.notifications.markRead(n.id).then(list.reload)}
          />
        )}
      </Card>
    </>
  );
}

export function AdminProfileView() {
  const services = useServices();
  const { session } = useSession();
  const logs = useAsync(() => services.admin.listAuditLogs({ search: session?.user.fullName ?? '' }), [session?.user.id]);
  const u = session?.user;
  if (!u) return null;
  return (
    <>
      <PageHeader title="My admin account" />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="space-y-3 p-5 text-sm">
          <KeyValue label="Name">{u.fullName}</KeyValue>
          <KeyValue label="Email">{u.email}</KeyValue>
          <KeyValue label="Role">Super Admin</KeyValue>
          <KeyValue label="Two-factor">
            <Badge tone="success">TOTP enrolled</Badge>
          </KeyValue>
          <KeyValue label="Session">Network {session?.admin?.ip ?? '—'} · signs out after 30 idle minutes</KeyValue>
          <p className="rounded-lg bg-canvas p-3 text-[12.5px] text-ink-muted">
            Super Admin accounts are provisioned by the platform owner — there is no self-registration or default admin. Password and TOTP resets go through the
            documented break-glass procedure.
          </p>
        </Card>
        <Card>
          <CardHeader title="My recent actions" />
          {logs.loading ? <SkeletonRows rows={5} /> : <AuditRows logs={(logs.data ?? []).filter((l) => l.actorId === u.id).slice(0, 15)} />}
        </Card>
      </div>
    </>
  );
}
