'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { ArrowLeft, Info, LifeBuoy } from 'lucide-react';
import { formatRelative, TICKET_CATEGORY_LABEL, type TicketStatus } from '@bazarhq/shared';
import {
  Card,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SkeletonRows,
  Tabs,
  TicketPriorityBadge,
  TicketStatusBadge,
  TicketThread,
  useAsync,
  useDebounced,
  useServices,
} from '@bazarhq/ui';
import { paths } from '@/lib/paths';

function TicketDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const services = useServices();
  const detail = useAsync(() => services.support.get(id), [id]);
  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 border-b border-line px-5 py-3 text-[13px] font-semibold text-ink-muted hover:text-ink lg:hidden"
      >
        <ArrowLeft className="size-4" aria-hidden /> All tickets
      </button>
      {detail.loading ? (
        <SkeletonRows rows={4} />
      ) : detail.error || !detail.data ? (
        <ErrorState message={detail.error ?? 'Ticket not found.'} onRetry={detail.reload} />
      ) : (
        <TicketThread
          detail={detail.data}
          onChange={(d) => {
            detail.setData(d);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function SupportView() {
  const services = useServices();
  const router = useRouter();
  const pathname = usePathname();
  const selected = useSearchParams().get('ticket');
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const tickets = useAsync(() => services.support.list({ status, search: q }), [status, q]);
  const all = useAsync(() => services.support.list(), [tickets.data]);
  const count = (s: TicketStatus | 'all') => (all.data ? (s === 'all' ? all.data.length : all.data.filter((t) => t.status === s).length) : undefined);
  const list = tickets.data ?? [];

  return (
    <>
      <title>Support · BazarHQ Merchant</title>
      <PageHeader title="Support tickets" description="Tickets from your customers about orders, payments, delivery and returns." />
      <p className="-mt-2 mb-4 flex items-start gap-1.5 text-[12.5px] text-ink-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Customers open tickets from their account; BazarHQ routes store-related tickets to you. Unanswered tickets can be escalated to BazarHQ after 72 hours.
      </p>
      <Card className="overflow-hidden">
        <div className="grid min-h-[600px] lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className={cn('border-line lg:border-r', selected && 'hidden lg:block')}>
            <div className="space-y-3 border-b border-line p-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Subject, ticket ID or customer" label="Search tickets" />
              <Tabs
                label="Ticket status"
                value={status}
                onChange={setStatus}
                items={[
                  { value: 'all', label: 'All', count: count('all') },
                  { value: 'open', label: 'Open', count: count('open') },
                  { value: 'in_progress', label: 'In progress', count: count('in_progress') },
                  { value: 'waiting_for_customer', label: 'Waiting', count: count('waiting_for_customer') },
                  { value: 'resolved', label: 'Resolved', count: count('resolved') },
                  { value: 'closed', label: 'Closed', count: count('closed') },
                ]}
              />
            </div>
            {tickets.loading ? (
              <SkeletonRows rows={5} />
            ) : tickets.error ? (
              <ErrorState message={tickets.error} onRetry={tickets.reload} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<LifeBuoy className="size-6" aria-hidden />}
                title="No tickets here"
                description="Tickets assigned to your store will appear in this inbox."
              />
            ) : (
              <ul className="max-h-[640px] divide-y divide-line overflow-y-auto">
                {list.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => router.replace(paths.ticket(t.id))}
                      aria-current={selected === t.id ? 'true' : undefined}
                      className={cn(
                        'w-full px-4 py-3 text-left hover:bg-canvas',
                        selected === t.id && 'bg-brand-50/70 shadow-[inset_3px_0_0_var(--color-brand-600)]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-semibold text-ink-subtle">{t.ticketNumber}</span>
                        <span className="text-[12px] text-ink-subtle">{formatRelative(t.updatedAt)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm font-semibold text-ink">{t.subject}</p>
                      <p className="truncate text-[12.5px] text-ink-muted">
                        {t.customerName} · {TICKET_CATEGORY_LABEL[t.category]}
                      </p>
                      <div className="mt-1.5 flex gap-1.5">
                        <TicketStatusBadge status={t.status} />
                        {t.priority === 'urgent' && <TicketPriorityBadge priority={t.priority} />}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className={cn('min-w-0', !selected && 'hidden lg:block')}>
            {selected ? (
              <TicketDetail key={selected} id={selected} onBack={() => router.replace(pathname)} onChanged={() => void tickets.reload()} />
            ) : (
              <EmptyState
                className="h-full justify-center"
                icon={<LifeBuoy className="size-6" aria-hidden />}
                title="Select a ticket"
                description="Choose a ticket from the list to read the conversation and reply."
              />
            )}
          </div>
        </div>
      </Card>
    </>
  );
}

export default function SupportPage() {
  return (
    <Suspense>
      <SupportView />
    </Suspense>
  );
}
