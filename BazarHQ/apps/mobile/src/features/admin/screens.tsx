/** Super Admin stack for Android, reusing the shared admin features from @bazarhq/ui. */
import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Banknote, Bell, FileText, Gavel, LoaderCircle, LogOut, Megaphone, Palette, ShieldCheck, ShieldX, ShoppingBag, User } from 'lucide-react';
import { DEMO_ACCOUNTS } from '@bazarhq/shared';
import {
  AdminDashboardView,
  AdminLogin,
  AdminNotificationsView,
  AdminOrderDetailView,
  AdminOrdersView,
  AdminProfileView,
  AdminTicketsView,
  AdminTicketView,
  AdminTotp,
  AnnouncementsView,
  AuditLogView,
  Badge,
  BazarLogo,
  Button,
  Card,
  CustomerDetailView,
  CustomersView,
  DisputesView,
  MerchantDetailView,
  MerchantsView,
  PoliciesView,
  RefundsView,
  ReturnDisputeView,
  StoresView,
  SystemHealthView,
  ThemesView,
  cn,
  useAsync,
  useServices,
  useSession,
  useUnreadCount,
  type AdminDemoTools,
} from '@bazarhq/ui';
import { MenuLink } from '@/navigation/Shell';
import { adminPaths as a } from '@/navigation/paths';
import { Page } from '@/navigation/RoleShell';
import { devTools, showDemoTools } from '@/services/services';
import { nativeSignOutCleanup } from '@/services/native';

export function AdminLoginScreen() {
  const [sp] = useSearchParams();
  const demo = useMemo<AdminDemoTools | null>(
    () =>
      devTools && showDemoTools
        ? {
            accounts: DEMO_ACCOUNTS.filter((x) => x.role === 'super_admin'),
            totpCode: devTools.demoTotpCode,
            network: () => devTools!.adminNetwork(),
            setNetwork: (n) => devTools!.setAdminNetwork(n),
            expireSession: () => devTools!.expireAdminSession(),
          }
        : null,
    [],
  );
  return <AdminLogin demo={demo} expired={sp.get('expired') === '1'} />;
}
/** Step 1 on Android: confirm the approved VPN / allowlisted network path before any credentials are entered. */
export function NetworkCheckScreen() {
  const services = useServices();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const net = useAsync(() => services.adminAuth.checkNetwork(), [tick]);
  const ok = net.data?.allowed;
  return (
    <main className="flex min-h-dvh flex-col bg-navy-950 px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(32px+env(safe-area-inset-top))] text-white">
      <BazarLogo tone="light" subtitle="Super Admin" />
      <h1 className="mt-10 text-2xl font-bold">Network access check</h1>
      <p className="mt-2 text-sm text-navy-100">
        The admin console only works over the BazarHQ managed VPN or an allowlisted network. TOTP is verified by the server after sign-in.
      </p>
      <div
        className={cn(
          'mt-6 flex items-start gap-3 rounded-2xl p-4 ring-1',
          net.loading ? 'bg-white/5 ring-white/10' : ok ? 'bg-brand-500/15 ring-brand-400/30' : 'bg-red-500/15 ring-red-400/30',
        )}
        role="status"
      >
        {net.loading ? (
          <LoaderCircle className="size-5 animate-spin" aria-hidden />
        ) : ok ? (
          <ShieldCheck className="size-5 text-brand-300" aria-hidden />
        ) : (
          <ShieldX className="size-5 text-red-300" aria-hidden />
        )}
        <div>
          <p className="font-semibold">{net.loading ? 'Checking…' : ok ? 'Approved network' : 'Access blocked'}</p>
          <p className="text-[13px] text-navy-100">
            {net.loading
              ? 'Asking the server which network you are on.'
              : ok
                ? `Connected from ${net.data!.ip}.`
                : `Connected from ${net.data?.ip ?? 'an unknown network'}. Turn on the BazarHQ VPN, then check again.`}
          </p>
        </div>
      </div>
      <div className="mt-auto space-y-2 pt-8">
        <Button block size="lg" disabled={!ok} onClick={() => navigate(a.login)}>
          Continue to sign in
        </Button>
        <Button block size="lg" variant="ghost" className="text-white" onClick={() => setTick((t) => t + 1)}>
          Check again
        </Button>
        {devTools && showDemoTools && (
          <button
            type="button"
            className="w-full pt-2 text-[12.5px] font-semibold text-navy-200 underline"
            onClick={() => {
              devTools!.setAdminNetwork(devTools!.adminNetwork() === 'allowlisted' ? 'blocked' : 'allowlisted');
              setTick((t) => t + 1);
            }}
          >
            Demo: simulate {ok ? 'an unapproved network' : 'the approved VPN'}
          </button>
        )}
      </div>
    </main>
  );
}

export const AdminTotpScreen = () => <AdminTotp demoCode={devTools && showDemoTools ? devTools.demoTotpCode : null} />;

const wrap = (node: React.ReactNode) => <Page>{node}</Page>;
const withId = (C: (p: { id: string }) => React.ReactNode) =>
  function Screen() {
    const { id = '' } = useParams();
    return wrap(<C id={id} />);
  };

export const DashboardScreen = () => wrap(<AdminDashboardView />);
export const HealthScreen = () => wrap(<SystemHealthView />);
export const MerchantsScreen = () => wrap(<MerchantsView />);
export const MerchantScreen = withId(MerchantDetailView);
export const CustomersScreen = () => wrap(<CustomersView />);
export const CustomerScreen = withId(CustomerDetailView);
export const StoresScreen = () => wrap(<StoresView />);
export function OrdersScreen() {
  const [sp] = useSearchParams();
  return wrap(<AdminOrdersView storeId={sp.get('store') ?? undefined} />);
}
export const OrderScreen = withId(AdminOrderDetailView);
export const ThemesScreen = () => wrap(<ThemesView />);
export const AnnouncementsScreen = () => wrap(<AnnouncementsView />);
export const PoliciesScreen = () => wrap(<PoliciesView />);
export const SupportScreen = () => wrap(<AdminTicketsView />);
export const TicketScreen = withId(AdminTicketView);
export const DisputesScreen = () => wrap(<DisputesView />);
export function DisputeScreen() {
  const { kind, id = '' } = useParams();
  return wrap(kind === 'ticket' ? <AdminTicketView id={id} /> : <ReturnDisputeView id={id} />);
}
export const RefundsScreen = () => wrap(<RefundsView />);
export const AuditScreen = () => wrap(<AuditLogView />);
export const NotificationsScreen = () => wrap(<AdminNotificationsView />);
export const ProfileScreen = () => wrap(<AdminProfileView />);

export function AdminMoreScreen() {
  const services = useServices();
  const { session, setSession } = useSession();
  const unread = useUnreadCount();
  const navigate = useNavigate();
  return (
    <Page>
      <h1 className="text-xl font-bold">Admin</h1>
      <p className="text-sm text-ink-muted">
        {session?.user.fullName} · {session?.admin?.ip}
      </p>
      <Card className="mt-4 divide-y divide-line">
        <MenuLink to={a.systemHealth} icon={<Activity className="size-5" />} label="System health" />
        <MenuLink to={a.customers} icon={<User className="size-5" />} label="Customers" />
        <MenuLink to={a.disputes} icon={<Gavel className="size-5" />} label="Disputes" />
        <MenuLink to={a.orders} icon={<ShoppingBag className="size-5" />} label="Orders" hint="Read-only" />
        <MenuLink to={a.refunds} icon={<Banknote className="size-5" />} label="Refunds" />
      </Card>
      <Card className="mt-4 divide-y divide-line">
        <MenuLink to={a.themes} icon={<Palette className="size-5" />} label="Themes" />
        <MenuLink to={a.announcements} icon={<Megaphone className="size-5" />} label="Announcements" />
        <MenuLink to={a.policies} icon={<FileText className="size-5" />} label="Policies" hint="Dual approval" />
        <MenuLink
          to={a.notifications}
          icon={<Bell className="size-5" />}
          label="Notifications"
          badge={unread ? <Badge tone="danger">{unread}</Badge> : undefined}
        />
        <MenuLink to={a.profile} icon={<User className="size-5" />} label="My account" />
      </Card>
      <Button
        className="mt-5"
        variant="danger-outline"
        size="lg"
        block
        icon={<LogOut className="size-4" aria-hidden />}
        onClick={async () => {
          await nativeSignOutCleanup((t) => services.notifications.unregisterDevice(t));
          await services.adminAuth.signOut();
          setSession(null);
          navigate(a.login, { replace: true });
        }}
      >
        Sign out
      </Button>
    </Page>
  );
}
