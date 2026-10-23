'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Mail, MapPin, Phone, Users } from 'lucide-react';
import { formatBDT, formatDate, formatRelative, type StoreCustomer } from '@bazarhq/shared';
import {
  Avatar,
  Badge,
  Card,
  EmptyState,
  ErrorState,
  KeyValue,
  Modal,
  OrderStatusBadge,
  PageHeader,
  SearchInput,
  SkeletonRows,
  TableWrap,
  Tabs,
  td,
  th,
  useAsync,
  useDebounced,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

const activityTone = { active: 'success', new: 'info', inactive: 'neutral' } as const;
const activityLabel = { active: 'Active', new: 'New', inactive: 'Inactive' } as const;

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const services = useServices();
  const detail = useAsync(() => services.customers.get(id), [id]);
  const c = detail.data?.customer;
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={c?.name ?? 'Customer'}
      description={c ? `${c.accountType === 'registered' ? 'Registered customer' : 'Guest checkout'} · first order ${formatDate(c.firstOrderAt)}` : undefined}
    >
      {detail.loading ? (
        <SkeletonRows rows={4} className="p-0" />
      ) : detail.error || !c ? (
        <ErrorState message={detail.error ?? 'Customer not found.'} onRetry={detail.reload} />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <KeyValue label="Orders">{c.ordersCount}</KeyValue>
            <KeyValue label="Total spent">{formatBDT(c.totalSpent)}</KeyValue>
            <KeyValue label="Last order">{formatRelative(c.lastOrderAt)}</KeyValue>
          </dl>
          <div className="space-y-1.5 rounded-xl bg-canvas p-3 text-sm">
            <p className="flex items-center gap-2">
              <Phone className="size-4 text-ink-subtle" aria-hidden />
              <a href={`tel:${c.phone}`} className="hover:underline">
                {c.phone}
              </a>
            </p>
            {c.email && (
              <p className="flex items-center gap-2">
                <Mail className="size-4 text-ink-subtle" aria-hidden />
                <a href={`mailto:${c.email}`} className="hover:underline">
                  {c.email}
                </a>
              </p>
            )}
            {c.district && (
              <p className="flex items-center gap-2">
                <MapPin className="size-4 text-ink-subtle" aria-hidden /> {c.district}
              </p>
            )}
          </div>
          <div>
            <h3 className="mb-2 text-sm font-bold text-ink">Order history</h3>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {detail.data!.orders.map((o) => (
                <li key={o.id}>
                  <Link href={paths.order(o.id)} className="flex items-center gap-3 px-3 py-2.5 hover:bg-canvas">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{o.orderNumber}</p>
                      <p className="text-[12px] text-ink-muted">
                        {formatDate(o.createdAt)} · {o.items.length} item{o.items.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <OrderStatusBadge status={o.status} />
                    <span className="w-20 text-right text-sm font-semibold tabular">{formatBDT(o.totalAmount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[12px] text-ink-subtle">
            Customer data is limited to what’s needed to fulfil orders from your store. Customer accounts are managed by BazarHQ.
          </p>
        </div>
      )}
    </Modal>
  );
}

function CustomersView() {
  const services = useServices();
  const router = useRouter();
  const pathname = usePathname();
  const selected = useSearchParams().get('customer');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<'all' | 'registered' | 'guest'>('all');
  const q = useDebounced(search);
  const customers = useAsync(() => services.customers.list({ search: q, accountType: type }), [q, type]);
  const list = customers.data ?? [];
  const open = (c: StoreCustomer) => router.push(paths.customer(c.id));

  return (
    <>
      <title>Customers · BazarHQ Merchant</title>
      <PageHeader title="Customers" description="People who have ordered from your store, built from your order history." />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
          <Tabs
            label="Account type"
            value={type}
            onChange={setType}
            items={[
              { value: 'all', label: 'All' },
              { value: 'registered', label: 'Registered' },
              { value: 'guest', label: 'Guest' },
            ]}
          />
          <SearchInput value={search} onChange={setSearch} placeholder="Name, phone or email" label="Search customers" className="w-full sm:w-72" />
        </div>
        {customers.loading ? (
          <SkeletonRows rows={6} />
        ) : customers.error ? (
          <ErrorState message={customers.error} onRetry={customers.reload} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title={q ? 'No customers match' : 'No customers yet'}
            description={q ? 'Try another name or phone number.' : 'Customers appear here after their first order.'}
          />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-line bg-canvas/60">
                <tr>
                  {['Customer', 'Contact', 'Account', 'Status', 'Orders', 'Total spent', 'Last order'].map((h) => (
                    <th key={h} scope="col" className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((c) => (
                  <tr key={c.id} className="cursor-pointer hover:bg-canvas/60" onClick={() => open(c)}>
                    <td className={td}>
                      <button type="button" onClick={() => open(c)} className="flex items-center gap-3 text-left font-semibold hover:text-brand-700">
                        <Avatar name={c.name} size={34} />
                        {c.name}
                      </button>
                    </td>
                    <td className={td}>
                      <p>{c.phone}</p>
                      {c.email && <p className="text-[12px] text-ink-subtle">{c.email}</p>}
                    </td>
                    <td className={td}>
                      <Badge tone={c.accountType === 'registered' ? 'navy' : 'neutral'}>{c.accountType === 'registered' ? 'Registered' : 'Guest'}</Badge>
                    </td>
                    <td className={td}>
                      <Badge tone={activityTone[c.activity]} dot>
                        {activityLabel[c.activity]}
                      </Badge>
                    </td>
                    <td className={`${td} tabular`}>{c.ordersCount}</td>
                    <td className={`${td} font-semibold tabular`}>{formatBDT(c.totalSpent)}</td>
                    <td className={`${td} text-ink-muted`}>{formatRelative(c.lastOrderAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="mt-3 text-[12.5px] text-ink-subtle">
        Status: New = first order in the last 14 days · Active = ordered in the last 30 days · Inactive = no order for 30+ days.
      </p>
      {selected && <CustomerDetail id={selected} onClose={() => router.replace(pathname)} />}
    </>
  );
}

export default function CustomersPage() {
  return (
    <Suspense>
      <CustomersView />
    </Suspense>
  );
}
