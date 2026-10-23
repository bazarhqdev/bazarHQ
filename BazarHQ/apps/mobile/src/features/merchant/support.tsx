import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LifeBuoy } from 'lucide-react';
import { formatRelative, TICKET_CATEGORY_LABEL, type TicketStatus } from '@bazarhq/shared';
import { Card, EmptyState, ErrorState, SkeletonRows, Tabs, TicketPriorityBadge, TicketStatusBadge, TicketThread, useAsync, useServices } from '@bazarhq/ui';
import { Screen, TopBar } from '@/components/Screen';
import { paths } from '@/navigation/paths';

export function SupportScreen() {
  const services = useServices();
  const [status, setStatus] = useState<TicketStatus | 'all'>('all');
  const tickets = useAsync(() => services.support.list({ status }), [status]);
  return (
    <Screen title="Support tickets" back onRefresh={tickets.reload}>
      <p className="mb-3 text-[13px] text-ink-muted">Customer tickets routed to your store. Reply within 72 hours to avoid escalation.</p>
      <Tabs
        label="Ticket status"
        value={status}
        onChange={setStatus}
        items={[
          { value: 'all', label: 'All' },
          { value: 'open', label: 'Open' },
          { value: 'in_progress', label: 'In progress' },
          { value: 'waiting_for_customer', label: 'Waiting' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'closed', label: 'Closed' },
        ]}
      />
      <Card className="mt-3">
        {tickets.loading ? (
          <SkeletonRows rows={4} />
        ) : tickets.error ? (
          <ErrorState message={tickets.error} onRetry={tickets.reload} />
        ) : !tickets.data?.length ? (
          <EmptyState icon={<LifeBuoy className="size-6" aria-hidden />} title="No tickets" description="Tickets assigned to your store appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {tickets.data.map((t) => (
              <li key={t.id}>
                <Link to={paths.ticket(t.id)} className="block px-4 py-3 active:bg-canvas">
                  <div className="flex justify-between text-[12px] text-ink-subtle">
                    <span>{t.ticketNumber}</span>
                    <span>{formatRelative(t.updatedAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-[15px] font-semibold">{t.subject}</p>
                  <p className="truncate text-[13px] text-ink-muted">
                    {t.customerName} · {TICKET_CATEGORY_LABEL[t.category]}
                  </p>
                  <div className="mt-1.5 flex gap-1.5">
                    <TicketStatusBadge status={t.status} />
                    {t.priority === 'urgent' && <TicketPriorityBadge priority={t.priority} />}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </Screen>
  );
}

export function TicketScreen() {
  const { id = '' } = useParams<{ id: string }>();
  const services = useServices();
  const detail = useAsync(() => services.support.get(id), [id]);
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <TopBar title={detail.data?.ticket.ticketNumber ?? 'Ticket'} back />
      {detail.loading ? (
        <SkeletonRows rows={4} />
      ) : detail.error || !detail.data ? (
        <ErrorState message={detail.error ?? 'Ticket not found.'} onRetry={detail.reload} />
      ) : (
        <div className="flex flex-1 flex-col">
          <TicketThread detail={detail.data} onChange={(d) => detail.setData(d)} />
        </div>
      )}
    </div>
  );
}
