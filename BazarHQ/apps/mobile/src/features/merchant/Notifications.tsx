import { useState } from 'react';
import { BellOff, BellRing, CheckCheck } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  NotificationList,
  SkeletonRows,
  Tabs,
  useAsync,
  useServiceEvents,
  useServices,
  useToast,
} from '@bazarhq/ui';
import { Screen } from '@/components/Screen';
import { enablePush, pushSupported } from '@/services/native';

export function NotificationsScreen() {
  const services = useServices();
  const toast = useToast();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const items = useAsync(() => services.notifications.list({ unreadOnly: filter === 'unread' }), [filter]);
  useServiceEvents(() => void items.reload());
  const [push, setPush] = useState<'idle' | 'granted' | 'denied'>('idle');

  return (
    <Screen
      title="Notifications"
      back
      onRefresh={items.reload}
      actions={
        <IconButton label="Mark all as read" onClick={() => void services.notifications.markAllRead().then(() => toast.success('All caught up'))}>
          <CheckCheck className="size-5" aria-hidden />
        </IconButton>
      }
    >
      {pushSupported() && push !== 'granted' && (
        <Alert
          tone={push === 'denied' ? 'warning' : 'info'}
          className="mb-3"
          action={
            push === 'idle' && (
              <Button
                size="sm"
                variant="brand"
                icon={<BellRing className="size-4" aria-hidden />}
                onClick={async () => {
                  // Permission is requested only at this point of use (MOB-10/18).
                  // The FCM token goes to the server (device_tokens) and is never kept client-side.
                  const r = await enablePush((token) => void services.notifications.registerDevice({ token, platform: 'android' }).catch(() => undefined));
                  setPush(r === 'granted' ? 'granted' : 'denied');
                }}
              >
                Turn on
              </Button>
            )
          }
        >
          {push === 'denied' ? 'Push notifications are off. You can enable them in Android settings.' : 'Get a push alert for every new order.'}
        </Alert>
      )}
      <Tabs
        label="Filter"
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'all', label: 'All' },
          { value: 'unread', label: 'Unread' },
        ]}
      />
      <Card className="mt-3">
        {items.loading ? (
          <SkeletonRows rows={5} />
        ) : items.error ? (
          <ErrorState message={items.error} onRetry={items.reload} />
        ) : !items.data?.length ? (
          <EmptyState icon={<BellOff className="size-6" aria-hidden />} title="Nothing new" description="We’ll let you know when something needs attention." />
        ) : (
          <NotificationList
            items={items.data}
            onOpen={(n) => {
              if (!n.isRead) void services.notifications.markRead(n.id);
            }}
          />
        )}
      </Card>
    </Screen>
  );
}
