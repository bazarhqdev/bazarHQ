/** Super Admin stack for Android, reusing the shared admin features from @bazarhq/ui. */
import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Activity, Banknote, Bell, FileText, Gavel, LogOut, Megaphone, Palette, ShoppingBag, User } from 'lucide-react';
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
            expireSession: () => devTools!.expireAdminSession(),
          }
        : null,
    [],
  );
  return <AdminLogin demo={demo} expired={sp.get('expired') === '1'} />;
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
