'use client';

import { useState } from 'react';
import { BellOff, CheckCheck } from 'lucide-react';
import { errorMessage } from '@bazarhq/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  NotificationList,
  PageHeader,
  SkeletonRows,
  Tabs,
  useAsync,
  useServiceEvents,
  useServices,
  useToast,
} from '@bazarhq/ui';

export default function NotificationsPage() {
  const services = useServices();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = useAsync(() => services.notifications.list({ unreadOnly: filter === 'unread' }), [filter]);
  useServiceEvents(() => void items.reload());
  const unread = items.data?.filter((n) => !n.isRead).length ?? 0;
  const [busy, setBusy] = useState(false);

  return (
    <>
      <title>Notifications · BazarHQ Merchant</title>
      <PageHeader
        title="Notifications"
        description="New orders, stock alerts, payments and support updates."
        actions={
          <Button
            variant="secondary"
            icon={<CheckCheck className="size-4" aria-hidden />}
            loading={busy}
            disabled={unread === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await services.notifications.markAllRead();
                toast.success('All notifications marked as read');
              } catch (e) {
                toast.error('Couldn’t update', errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark all as read
          </Button>
        }
      />
      <Card>
        <div className="border-b border-line p-4">
          <Tabs
            label="Filter notifications"
            value={filter}
            onChange={setFilter}
            items={[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread', count: filter === 'all' ? unread : items.data?.length },
            ]}
          />
        </div>
        {items.loading ? (
          <SkeletonRows rows={6} />
        ) : items.error ? (
          <ErrorState message={items.error} onRetry={items.reload} />
        ) : !items.data?.length ? (
          <EmptyState
            icon={<BellOff className="size-6" aria-hidden />}
            title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
            description="We’ll let you know when something needs your attention."
          />
        ) : (
          <NotificationList
            items={items.data}
            onOpen={(n) => {
              if (!n.isRead) {
                items.setData((list) => (list ?? []).map((x) => (x.id === n.id ? { ...x, isRead: true } : x)));
                void services.notifications.markRead(n.id);
              }
            }}
          />
        )}
      </Card>
    </>
  );
}
