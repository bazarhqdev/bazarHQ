import { useNavigate } from 'react-router-dom';
import { Bell, CreditCard, LifeBuoy, LogOut, RotateCcw, Settings, Sparkles, Store } from 'lucide-react';
import { Avatar, Badge, Button, Card, StoreStatusBadge, useServices, useSession, useToast, useUnreadCount } from '@bazarhq/ui';
import { MenuLink } from '@/navigation/Shell';
import { Screen } from '@/components/Screen';
import { paths } from '@/navigation/paths';
import { devTools, showDemoTools } from '@/services/services';
import { nativeSignOutCleanup } from '@/services/native';

export function MoreScreen() {
  const services = useServices();
  const { session, signOut, refresh } = useSession();
  const unread = useUnreadCount();
  const toast = useToast();
  const navigate = useNavigate();
  const store = session?.store;
  return (
    <Screen title="More">
      <Card className="flex items-center gap-3 p-4">
        <Avatar name={session?.user.fullName ?? ''} src={session?.user.avatarUrl} size={48} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{session?.user.fullName}</p>
          <p className="truncate text-[13px] text-ink-muted">{session?.user.email}</p>
        </div>
        {store && <StoreStatusBadge status={store.status} />}
      </Card>
      <Card className="mt-4 divide-y divide-line">
        <MenuLink
          to={paths.notifications}
          icon={<Bell className="size-5" />}
          label="Notifications"
          badge={unread ? <Badge tone="danger">{unread}</Badge> : undefined}
        />
        <MenuLink to={paths.returns} icon={<RotateCcw className="size-5" />} label="Returns & refunds" hint="Review requests, record refunds" />
        <MenuLink to={paths.support} icon={<LifeBuoy className="size-5" />} label="Support tickets" hint="Customer tickets for your store" />
        <MenuLink to={paths.paymentSettings} icon={<CreditCard className="size-5" />} label="Payment settings" hint="bKash, Nagad, Rocket, SSLCommerz, COD" />
        <MenuLink to={paths.storeSettings} icon={<Settings className="size-5" />} label="Profile & settings" hint="Store, shipping, security" />
        <MenuLink to={paths.onboarding} icon={<Store className="size-5" />} label="Store setup checklist" />
      </Card>
      {devTools && showDemoTools && (
        <Card className="mt-4 p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-ink-subtle">
            <Sparkles className="size-3.5" aria-hidden /> Demo data
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await devTools?.simulateIncomingOrder();
                toast.info('New order received');
              }}
            >
              Simulate new order
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="size-4" aria-hidden />}
              onClick={async () => {
                devTools?.reset();
                await refresh();
                navigate(paths.login, { replace: true });
              }}
            >
              Reset demo data
            </Button>
          </div>
        </Card>
      )}
      <Button
        className="mt-5"
        variant="danger-outline"
        size="lg"
        block
        icon={<LogOut className="size-4" aria-hidden />}
        onClick={async () => {
          await nativeSignOutCleanup((t) => services.notifications.unregisterDevice(t));
          await signOut();
          navigate(paths.login, { replace: true });
        }}
      >
        Sign out
      </Button>
      <p className="mt-4 text-center text-[12px] text-ink-subtle">BazarHQ Merchant · v0.2.0</p>
    </Screen>
  );
}
