'use client';

/** Super Admin: merchants, customers, stores and read-only orders (FR-SA-08..13). */
import { useState } from 'react';
import { Ban, ChevronRight, Eye, RotateCcw, ShieldAlert, ShoppingBag, Store, Trash2, Users } from 'lucide-react';
import {
  deleteMerchantSchema,
  errorMessage,
  formatBDT,
  formatDate,
  formatDateTime,
  formatRelative,
  ORDER_STATUS_LABEL,
  ORDER_STATUSES,
  PAYMENT_METHOD_LABEL,
  STORE_STATUS_LABEL,
  suspendMerchantSchema,
  toFieldErrors,
  type AdminMerchantDetail,
  type OrderStatus,
  type StoreStatus,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  KeyValue,
  Modal,
  OrderStatusBadge,
  PageHeader,
  PaymentMethodLabel,
  PaymentStatusBadge,
  SearchInput,
  SelectField,
  Skeleton,
  SkeletonRows,
  StoreStatusBadge,
  TableWrap,
  Tabs,
  td,
  TextArea,
  TextField,
  th,
  useToast,
} from '../../components';
import { useAdminPaths, useAsync, useDebounced, useNavigation, useServiceEvents, useServices } from '../../context';
import { BackLink } from '../customer/account';
import { TrackingTimeline } from '../customer/public';
import { PaymentReviewCard } from '../returns';

const storeUrl = (sub: string) => `/store/${encodeURIComponent(sub)}`;

/* ------------------------------------------------------------------ */
/* Merchants                                                           */
/* ------------------------------------------------------------------ */

export function MerchantsView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [status, setStatus] = useState<'all' | 'active' | 'onboarding' | 'suspended'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.admin.listMerchants({ status, search: q }), [status, q]);
  useServiceEvents(() => void list.reload());
  return (
    <>
      <PageHeader title="Merchants" description="Every merchant account and its store. Suspend, reinstate or delete with an audited reason." />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Merchant status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Live' },
              { value: 'onboarding', label: 'Onboarding' },
              { value: 'suspended', label: 'Suspended' },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Name, email, store or subdomain" label="Search merchants" />
        </div>
        {list.loading ? (
          <SkeletonRows rows={6} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Users className="size-6" aria-hidden />} title="No merchants match" />
        ) : (
          <>
            <TableWrap className="hidden lg:block">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/60">
                  <tr>
                    {['Merchant', 'Store', 'Status', 'Products', 'Orders', 'GMV', ''].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h || <span className="sr-only">Open</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data!.map((r) => (
                    <tr key={r.merchant.id} className="hover:bg-canvas/60">
                      <td className={td}>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={r.merchant.fullName} size={32} />
                          <div className="min-w-0">
                            <Link href={a.merchant(r.merchant.id)} className="font-semibold text-ink hover:text-brand-700">
                              {r.merchant.fullName}
                            </Link>
                            <p className="truncate text-[12px] text-ink-subtle">{r.merchant.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={td}>
                        {r.store ? (
                          <>
                            <p className="font-medium">{r.store.name}</p>
                            <p className="text-[12px] text-ink-subtle">/store/{r.store.subdomain}</p>
                          </>
                        ) : (
                          <span className="text-ink-subtle">No store yet</span>
                        )}
                      </td>
                      <td className={td}>
                        {r.merchant.status === 'suspended' ? (
                          <Badge tone="danger">Suspended</Badge>
                        ) : r.store ? (
                          <StoreStatusBadge status={r.store.status} />
                        ) : (
                          <Badge>Onboarding</Badge>
                        )}
                      </td>
                      <td className={`${td} tabular`}>{r.productCount}</td>
                      <td className={`${td} tabular`}>{r.orderCount}</td>
                      <td className={`${td} font-semibold tabular`}>{formatBDT(r.revenue)}</td>
                      <td className={`${td} text-right`}>
                        <Link
                          href={a.merchant(r.merchant.id)}
                          aria-label={`Open ${r.merchant.fullName}`}
                          className="inline-flex rounded-lg p-2 text-ink-subtle hover:text-ink"
                        >
                          <ChevronRight className="size-4" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <ul className="divide-y divide-line lg:hidden">
              {list.data!.map((r) => (
                <li key={r.merchant.id}>
                  <Link href={a.merchant(r.merchant.id)} className="flex items-center gap-3 p-4 hover:bg-canvas">
                    <Avatar name={r.merchant.fullName} size={36} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.merchant.fullName}</p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {r.store?.name ?? 'No store yet'} · {formatBDT(r.revenue)}
                      </p>
                    </div>
                    {r.merchant.status === 'suspended' ? <Badge tone="danger">Suspended</Badge> : r.store && <StoreStatusBadge status={r.store.status} />}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </>
  );
}

export function MerchantDetailView({ id }: { id: string }) {
  const services = useServices();
  const toast = useToast();
  const { Link, navigate } = useNavigation();
  const a = useAdminPaths();
  const m = useAsync<AdminMerchantDetail>(() => services.admin.getMerchant(id), [id]);
  const [modal, setModal] = useState<'suspend' | 'reinstate' | 'delete' | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (m.loading) return <Skeleton className="h-96 w-full" />;
  if (m.error || !m.data) return <ErrorState message={m.error ?? 'Merchant not found.'} onRetry={m.reload} />;
  const d = m.data;
  const suspended = d.merchant.status === 'suspended';
  const close = () => {
    setModal(null);
    setText('');
    setError(undefined);
  };
  const act = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (modal === 'suspend') {
        const v = suspendMerchantSchema.safeParse({ reason: text });
        if (!v.success) return setError(toFieldErrors(v.error).reason);
        m.setData(await services.admin.suspendMerchant(d.merchant.id, text));
        toast.success('Merchant suspended', 'Sessions ended and the store was unpublished.');
      } else if (modal === 'reinstate') {
        m.setData(await services.admin.reinstateMerchant(d.merchant.id));
        toast.success('Merchant reinstated', 'The store stays unpublished until the merchant republishes it.');
      } else if (modal === 'delete') {
        const v = deleteMerchantSchema(d.merchant.email).safeParse({ phrase: text });
        if (!v.success) return setError(toFieldErrors(v.error).phrase);
        await services.admin.deleteMerchant(d.merchant.id, text);
        toast.success('Merchant deleted', 'Transaction records are retained.');
        navigate(a.merchants, { replace: true });
        return;
      }
      close();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader
        back={<BackLink href={a.merchants} label="Merchants" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {d.merchant.fullName} {suspended ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}
          </span>
        }
        description={`${d.merchant.email} · joined ${formatDate(d.merchant.createdAt)}`}
        actions={
          <>
            {suspended ? (
              <Button variant="secondary" icon={<RotateCcw className="size-4" aria-hidden />} onClick={() => setModal('reinstate')}>
                Reinstate
              </Button>
            ) : (
              <Button variant="danger-outline" icon={<Ban className="size-4" aria-hidden />} onClick={() => setModal('suspend')}>
                Suspend
              </Button>
            )}
            <Button variant="danger" icon={<Trash2 className="size-4" aria-hidden />} onClick={() => setModal('delete')}>
              Delete
            </Button>
          </>
        }
      />
      {suspended && d.merchant.suspensionReason && (
        <Alert tone="danger" className="mb-5" title="Suspension reason (shown to the merchant)">
          {d.merchant.suspensionReason}
        </Alert>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader
            title="Recent orders"
            description="Read-only. Merchants manage their own order status."
            action={
              d.store && (
                <Link href={`${a.orders}?store=${d.store.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                  All orders
                </Link>
              )
            }
          />
          {d.recentOrders.length === 0 ? (
            <EmptyState icon={<ShoppingBag className="size-6" aria-hidden />} title="No orders yet" />
          ) : (
            <ul className="divide-y divide-line">
              {d.recentOrders.map((o) => (
                <li key={o.id}>
                  <Link href={a.order(o.id)} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{o.orderNumber}</p>
                      <p className="text-[12.5px] text-ink-muted">
                        {o.customerName} · {formatRelative(o.createdAt)} · {formatBDT(o.totalAmount)}
                      </p>
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <aside className="space-y-5">
          <Card className="space-y-3 p-5 text-sm">
            {d.store ? (
              <>
                <KeyValue label="Store">
                  <span className="font-semibold">{d.store.name}</span> <StoreStatusBadge status={d.store.status} />
                </KeyValue>
                <KeyValue label="Address">
                  <a href={storeUrl(d.store.subdomain)} className="text-brand-700 hover:underline" target="_blank" rel="noreferrer">
                    /store/{d.store.subdomain}
                  </a>
                </KeyValue>
              </>
            ) : (
              <KeyValue label="Store">Not created yet</KeyValue>
            )}
            <KeyValue label="Products">{d.productCount}</KeyValue>
            <KeyValue label="Orders · GMV">
              {d.orderCount} · {formatBDT(d.revenue)}
            </KeyValue>
            <KeyValue label="Open tickets">{d.openTickets}</KeyValue>
            <KeyValue label="Active sessions">{d.activeSessions}</KeyValue>
            <KeyValue label="Sign-in">
              {d.merchant.authProvider === 'google' ? 'Google' : 'Email + password'}
              {d.merchant.twoFactorEnabled ? ' · 2FA on' : ''}
            </KeyValue>
          </Card>
          <p className="flex items-start gap-2 rounded-xl bg-canvas p-3 text-[12.5px] text-ink-muted">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden /> Payment credentials are never visible to Super Admins. Every action here is written
            to the audit log.
          </p>
        </aside>
      </div>

      <Modal
        open={modal !== null}
        onClose={close}
        busy={busy}
        title={
          modal === 'suspend'
            ? `Suspend ${d.merchant.fullName}?`
            : modal === 'reinstate'
              ? `Reinstate ${d.merchant.fullName}?`
              : `Delete ${d.merchant.fullName}?`
        }
        description={
          modal === 'suspend'
            ? 'Ends all their sessions and unpublishes the store. Customers can still track existing orders.'
            : modal === 'reinstate'
              ? 'They can sign in again. The store stays unpublished until they republish it.'
              : 'Permanently removes the account. Orders, refunds and audit records are retained.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant={modal === 'reinstate' ? 'primary' : 'danger'} loading={busy} onClick={act}>
              {modal === 'suspend' ? 'Suspend merchant' : modal === 'reinstate' ? 'Reinstate' : 'Delete permanently'}
            </Button>
          </>
        }
      >
        {modal === 'suspend' && (
          <TextArea
            label="Reason"
            required
            hint="Shown to the merchant and recorded in the audit log. At least 10 characters."
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error}
          />
        )}
        {modal === 'delete' && (
          <TextField
            label={
              <>
                Type <code className="rounded bg-canvas px-1">DELETE {d.merchant.email}</code> to confirm
              </>
            }
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={error}
          />
        )}
        {modal === 'reinstate' && error && <Alert tone="danger">{error}</Alert>}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export function CustomersView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.admin.listCustomers({ search: q }), [q]);
  return (
    <>
      <PageHeader title="Customers" description="Registered customer accounts. Guest orders are visible per store under Orders." />
      <Card>
        <div className="border-b border-line p-4">
          <SearchInput value={search} onChange={setSearch} placeholder="Name, email or phone" label="Search customers" />
        </div>
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Users className="size-6" aria-hidden />} title="No customers match" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data!.map((c) => (
              <li key={c.customer.id}>
                <Link href={a.customer(c.customer.id)} className="flex items-center gap-3 px-5 py-3.5 hover:bg-canvas">
                  <Avatar name={c.customer.fullName} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.customer.fullName}</p>
                    <p className="truncate text-[12.5px] text-ink-muted">
                      {c.customer.email}
                      {c.customer.phone ? ` · ${c.customer.phone}` : ''}
                    </p>
                  </div>
                  <div className="hidden text-right text-[13px] sm:block">
                    <p className="font-semibold tabular">{formatBDT(c.totalSpent)}</p>
                    <p className="text-ink-subtle">
                      {c.orderCount} orders{c.lastOrderAt ? ` · last ${formatRelative(c.lastOrderAt)}` : ''}
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export function CustomerDetailView({ id }: { id: string }) {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const c = useAsync(() => services.admin.getCustomer(id), [id]);
  if (c.loading) return <Skeleton className="h-80 w-full" />;
  if (c.error || !c.data) return <ErrorState message={c.error ?? 'Customer not found.'} onRetry={c.reload} />;
  const d = c.data;
  return (
    <>
      <PageHeader
        back={<BackLink href={a.customers} label="Customers" />}
        title={d.customer.fullName}
        description={`${d.customer.email} · customer since ${formatDate(d.customer.createdAt)}`}
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card>
          <CardHeader title="Orders" description="Across all stores." />
          {d.orders.length === 0 ? (
            <EmptyState title="No orders" />
          ) : (
            <ul className="divide-y divide-line">
              {d.orders.map((o) => (
                <li key={o.id}>
                  <Link href={a.order(o.id)} className="flex items-center gap-3 px-5 py-3 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">
                        {o.orderNumber} <span className="font-normal text-ink-muted">· {o.storeName}</span>
                      </p>
                      <p className="text-[12.5px] text-ink-muted">
                        {formatDate(o.createdAt)} · {formatBDT(o.totalAmount)}
                      </p>
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="space-y-3 p-5 text-sm">
          <KeyValue label="Phone">{d.customer.phone ?? '—'}</KeyValue>
          <KeyValue label="Status">{d.customer.status}</KeyValue>
          <KeyValue label="Orders · spent">
            {d.orderCount} · {formatBDT(d.totalSpent)}
          </KeyValue>
          <KeyValue label="Saved addresses">{d.addresses}</KeyValue>
        </Card>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Stores                                                              */
/* ------------------------------------------------------------------ */

export function StoresView() {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [status, setStatus] = useState<StoreStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.admin.listStores({ status, search: q }), [status, q]);
  return (
    <>
      <PageHeader title="Stores" description="Every storefront on the platform. Suspended stores show customers a generic ‘store unavailable’ page." />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Store status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all' as const, label: 'All' },
              ...(['published', 'draft', 'suspended'] as StoreStatus[]).map((s) => ({ value: s, label: STORE_STATUS_LABEL[s] })),
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Store name or subdomain" label="Search stores" />
        </div>
        {list.loading ? (
          <SkeletonRows rows={5} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.length === 0 ? (
          <EmptyState icon={<Store className="size-6" aria-hidden />} title="No stores match" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {list.data!.map((s) => (
              <li key={s.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="size-9 shrink-0 rounded-lg" style={{ background: s.brandColour }} aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.name}</p>
                      <p className="truncate text-[12px] text-ink-subtle">/store/{s.subdomain}</p>
                    </div>
                  </div>
                  <StoreStatusBadge status={s.status} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-[12.5px]">
                  <div>
                    <dt className="text-ink-subtle">Products</dt>
                    <dd className="font-semibold tabular">{s.productCount}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-subtle">Orders</dt>
                    <dd className="font-semibold tabular">{s.orderCount}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-subtle">Theme</dt>
                    <dd className="truncate font-semibold">{s.themeName ?? '—'}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[12.5px] text-ink-muted">
                  Owner:{' '}
                  <Link href={a.merchant(s.ownerId)} className="font-semibold text-brand-700 hover:underline">
                    {s.ownerName}
                  </Link>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Orders (read-only)                                                  */
/* ------------------------------------------------------------------ */

export function AdminOrdersView({ storeId }: { storeId?: string }) {
  const services = useServices();
  const { Link } = useNavigation();
  const a = useAdminPaths();
  const [status, setStatus] = useState<OrderStatus | 'all'>('all');
  const [payment, setPayment] = useState<'all' | 'pending_verification'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const list = useAsync(() => services.admin.listOrders({ status, search: q, storeId, paymentStatus: payment }), [status, q, storeId, payment]);
  return (
    <>
      <PageHeader title="Orders" description="Read-only oversight across all stores. Order status is changed only by the store." />
      <Card>
        <div className="space-y-3 border-b border-line p-4">
          <Tabs
            label="Order status"
            value={status}
            onChange={setStatus}
            items={[{ value: 'all' as const, label: 'All' }, ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] }))]}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_240px]">
            <SearchInput value={search} onChange={setSearch} placeholder="Order ID, customer or store" label="Search orders" />
            <SelectField
              aria-label="Payment filter"
              value={payment}
              onChange={(e) => setPayment(e.target.value as 'all' | 'pending_verification')}
              options={[
                { value: 'all', label: 'Any payment status' },
                { value: 'pending_verification', label: 'Awaiting verification' },
              ]}
            />
          </div>
        </div>
        {list.loading ? (
          <SkeletonRows rows={8} />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : list.data!.items.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="size-6" aria-hidden />} title="No orders match" />
        ) : (
          <>
            <TableWrap className="hidden lg:block">
              <table className="w-full">
                <thead className="border-b border-line bg-canvas/60">
                  <tr>
                    {['Order', 'Store', 'Customer', 'Total', 'Payment', 'Status'].map((h) => (
                      <th key={h} scope="col" className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {list.data!.items.slice(0, 200).map((o) => (
                    <tr key={o.id} className="hover:bg-canvas/60">
                      <td className={td}>
                        <Link href={a.order(o.id)} className="font-semibold hover:text-brand-700">
                          {o.orderNumber}
                        </Link>
                        <p className="text-[12px] text-ink-subtle">{formatRelative(o.createdAt)}</p>
                      </td>
                      <td className={td}>{o.storeName}</td>
                      <td className={td}>
                        {o.customerName}
                        {!o.customerId && <span className="text-[12px] text-ink-subtle"> · guest</span>}
                      </td>
                      <td className={`${td} font-semibold tabular`}>{formatBDT(o.totalAmount)}</td>
                      <td className={td}>
                        <div className="flex flex-col items-start gap-1 text-[12.5px]">
                          <PaymentMethodLabel method={o.paymentMethod} />
                          <PaymentStatusBadge status={o.paymentStatus} />
                        </div>
                      </td>
                      <td className={td}>
                        <OrderStatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <ul className="divide-y divide-line lg:hidden">
              {list.data!.items.slice(0, 100).map((o) => (
                <li key={o.id}>
                  <Link href={a.order(o.id)} className="block p-4 hover:bg-canvas">
                    <div className="flex justify-between gap-2">
                      <p className="text-sm font-semibold">{o.orderNumber}</p>
                      <p className="text-sm font-bold tabular">{formatBDT(o.totalAmount)}</p>
                    </div>
                    <p className="text-[12.5px] text-ink-muted">
                      {o.storeName} · {o.customerName}
                    </p>
                    <div className="mt-1.5 flex gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-2.5 text-[12.5px] text-ink-subtle">
              {list.data!.total} orders{list.data!.total > 200 ? ' · showing the latest 200' : ''}
            </p>
          </>
        )}
      </Card>
    </>
  );
}

export function AdminOrderDetailView({ id }: { id: string }) {
  const services = useServices();
  const a = useAdminPaths();
  const d = useAsync(() => services.admin.getOrder(id), [id]);
  if (d.loading) return <Skeleton className="h-96 w-full" />;
  if (d.error || !d.data) return <ErrorState message={d.error ?? 'Order not found.'} onRetry={d.reload} />;
  const o = d.data.order;
  return (
    <>
      <PageHeader
        back={<BackLink href={a.orders} label="Orders" />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.orderNumber} <OrderStatusBadge status={o.status} />
          </span>
        }
        description={`${d.data.storeName} · placed ${formatDateTime(o.createdAt)}`}
        actions={
          <Badge tone="navy">
            <Eye className="mr-1 inline size-3.5" aria-hidden />
            Read-only
          </Badge>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <PaymentReviewCard
            detail={d.data}
            onChange={(nd) => d.setData({ ...nd, storeName: d.data!.storeName })}
            review={(oid, input) => services.admin.reviewPayment(oid, input)}
            actorLabel="admin"
          />
          <Card className="p-5">
            <TrackingTimeline status={o.status} events={d.data.events} cancellationReason={o.cancellationReason} />
          </Card>
          <Card>
            <CardHeader title="Items" />
            <ul className="divide-y divide-line">
              {o.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3 px-5 py-3 text-sm">
                  <span>
                    {i.productName}
                    {i.variantLabel && <span className="text-ink-muted"> · {i.variantLabel}</span>} × {i.quantity}
                  </span>
                  <span className="tabular">{formatBDT(i.subtotal)}</span>
                </li>
              ))}
            </ul>
            <p className="flex justify-between border-t border-line px-5 py-3 text-sm font-bold">
              <span>Total (incl. {formatBDT(o.deliveryCharge)} delivery)</span>
              <span className="tabular">{formatBDT(o.totalAmount)}</span>
            </p>
          </Card>
        </div>
        <aside className="space-y-5">
          <Card className="space-y-3 p-5 text-sm">
            <KeyValue label="Customer">
              {o.customerName} {!o.customerId && <Badge>Guest</Badge>}
            </KeyValue>
            <KeyValue label="Phone">{o.orderPhone}</KeyValue>
            <KeyValue label="Address">
              {o.deliveryAddress.address}, {o.deliveryAddress.district}
            </KeyValue>
            <KeyValue label="Payment">
              {PAYMENT_METHOD_LABEL[o.paymentMethod]} · <PaymentStatusBadge status={o.paymentStatus} />
            </KeyValue>
          </Card>
          <Card>
            <CardHeader title="Payment attempts" description="Safe projection — no credentials or full references." />
            <ul className="divide-y divide-line text-[13px]">
              {d.data.payments.map((p) => (
                <li key={p.id} className={cn('flex justify-between gap-2 px-5 py-2.5')}>
                  <span>
                    {PAYMENT_METHOD_LABEL[p.method]} · {formatBDT(p.amount)}
                    {p.providerReferenceMasked && <span className="block font-mono text-[12px] text-ink-subtle">{p.providerReferenceMasked}</span>}
                  </span>
                  <span className="text-right">
                    <Badge tone={p.status === 'paid' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>{p.status.replace('_', ' ')}</Badge>
                    <span className="block text-[11.5px] text-ink-subtle">{formatRelative(p.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}
