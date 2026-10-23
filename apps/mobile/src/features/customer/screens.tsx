/**
 * Customer stack for Android. Screens reuse the shared customer features from
 * @bazarhq/ui; this file only maps route params and adds mobile padding.
 */
import { useCallback } from 'react';
import { Link, Navigate, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LifeBuoy, LogOut, MapPin, PackageSearch, RotateCcw, ShoppingBag, ShoppingCart, UserCog } from 'lucide-react';
import { DEMO_ACCOUNTS, formatBDT, type Session, type StorefrontSort } from '@bazarhq/shared';
import {
  Button,
  Card,
  CartView,
  CustomerAddresses,
  CheckoutFlow,
  CustomerForgotPassword,
  CustomerHome,
  CustomerLogin,
  CustomerNotifications,
  CustomerOrders,
  CustomerOrderView,
  CustomerProfile,
  CustomerRegister,
  CustomerReturns,
  CustomerReturnView,
  CustomerTickets,
  CustomerTicketView,
  CustomerVerifyEmail,
  EmptyState,
  Landing,
  NewTicketForm,
  OrderSuccess,
  PolicyView,
  ProductArt,
  ProductDetail,
  ProductListing,
  RequireCustomer,
  SslCommerzSandbox,
  StoreHome,
  StoreSearch,
  StoreShell,
  TrackOrder,
  useAllCarts,
  useServices,
  useSession,
} from '@bazarhq/ui';
import { MenuLink } from '@/navigation/Shell';
import { nativeSignOutCleanup } from '@/services/native';
import { customerPaths as c, ROLE_START } from '@/navigation/paths';
import { Page } from '@/navigation/RoleShell';
import { PushPrompt } from '@/components/PushPrompt';
import { devTools, showDemoTools } from '@/services/services';
export const HomeScreen = () => <Landing />;
export function StoresScreen() {
  const [sp] = useSearchParams();
  return <StoreSearch key={sp.get('q') ?? ''} initial={sp.get('q') ?? ''} />;
}
export function TrackScreen() {
  const [sp] = useSearchParams();
  return <TrackOrder initialOrderNumber={sp.get('order') ?? ''} />;
}
export function PolicyScreen() {
  const { type } = useParams();
  return type === 'tos' || type === 'privacy' ? <PolicyView type={type} /> : <Navigate to={c.home} replace />;
}
export function SslScreen() {
  const [sp] = useSearchParams();
  return <SslCommerzSandbox token={sp.get('session') ?? ''} />;
}

/* Store (store-scoped context for products, cart and checkout) */
export function StoreLayout() {
  const { sub = '' } = useParams();
  return (
    <StoreShell subdomain={sub.toLowerCase()}>
      <Outlet />
    </StoreShell>
  );
}
export const StoreHomeScreen = () => <StoreHome />;
export function StoreProductsScreen() {
  const [sp] = useSearchParams();
  return (
    <ProductListing
      key={sp.toString()}
      initial={{ q: sp.get('q') ?? undefined, category: sp.get('category') ?? undefined, sort: (sp.get('sort') as StorefrontSort | null) ?? undefined }}
    />
  );
}
export function ProductScreen() {
  const { slug = '' } = useParams();
  return <ProductDetail key={slug} productSlug={slug} />;
}
export const StoreCartScreen = () => <CartView />;
export const CheckoutScreen = () => <CheckoutFlow />;
export function SuccessScreen() {
  const [sp] = useSearchParams();
  return <OrderSuccess orderNumber={sp.get('order') ?? ''} />;
}

export function CartsScreen() {
  const carts = useAllCarts();
  return (
    <Page>
      <h1 className="text-xl font-bold">Your carts</h1>
      <p className="text-sm text-ink-muted">One cart per store.</p>
      {carts.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={<ShoppingBag className="size-6" aria-hidden />}
          title="No items yet"
          action={
            <Link to={c.stores()} className="text-sm font-semibold text-brand-700">
              Find a store
            </Link>
          }
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {carts.map((cart) => (
            <li key={cart.storeId}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{cart.storeName}</p>
                    <p className="text-[13px] text-ink-muted">
                      {cart.items.reduce((s, i) => s + i.quantity, 0)} items · {formatBDT(cart.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0))}
                    </p>
                  </div>
                  <Link to={c.storeCart(cart.subdomain)} className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white">
                    Open
                  </Link>
                </div>
                <ul className="mt-3 flex gap-2 overflow-x-auto">
                  {cart.items.map((i) => (
                    <li key={`${i.productId}:${i.variantId}`}>
                      <ProductArt name={i.name} url={i.imageUrl} className="size-12" />
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/* Auth */
export function LoginScreen() {
  const [sp] = useSearchParams();
  const routeAfter = useCallback((s: Session, next?: string | null) => {
    if (s.user.role !== 'customer') return ROLE_START[s.user.role];
    return next && next.startsWith('/c/') ? next : c.account;
  }, []);
  return (
    <CustomerLogin
      next={sp.get('next')}
      routeAfter={routeAfter}
      demoAccounts={showDemoTools ? DEMO_ACCOUNTS.filter((a) => a.role === 'customer') : undefined}
    />
  );
}
export const RegisterScreen = () => <CustomerRegister />;
export const VerifyScreen = () => (
  <CustomerVerifyEmail onSimulateClick={devTools && showDemoTools ? (e) => devTools!.simulateVerificationClick(e) : undefined} />
);
export function ForgotScreen() {
  const [sp] = useSearchParams();
  return <CustomerForgotPassword token={sp.get('token')} demoLatestToken={devTools && showDemoTools ? () => devTools!.latestResetToken() : undefined} />;
}

/* Account (signed-in customers) */
export function AccountLayout() {
  return (
    <RequireCustomer loginHref={c.login(c.account)}>
      <Page>
        <Outlet />
      </Page>
    </RequireCustomer>
  );
}
export function AccountScreen() {
  const services = useServices();
  const { setSession } = useSession();
  const navigate = useNavigate();
  return (
    <>
      <CustomerHome />
      <Card className="mt-5 divide-y divide-line">
        <MenuLink to={c.carts} icon={<ShoppingCart className="size-5" />} label="Carts" hint="One cart per store" />
        <MenuLink to={c.returns} icon={<RotateCcw className="size-5" />} label="Returns & refunds" />
        <MenuLink to={c.support} icon={<LifeBuoy className="size-5" />} label="Support tickets" />
        <MenuLink to={c.addresses} icon={<MapPin className="size-5" />} label="Addresses" hint="Up to 3, one default" />
        <MenuLink to={c.profile} icon={<UserCog className="size-5" />} label="Profile & security" />
        <MenuLink to={c.track()} icon={<PackageSearch className="size-5" />} label="Track an order" hint="Order ID + phone" />
      </Card>
      <Button
        className="mt-5"
        variant="danger-outline"
        size="lg"
        block
        icon={<LogOut className="size-4" aria-hidden />}
        onClick={async () => {
          await nativeSignOutCleanup((t) => services.notifications.unregisterDevice(t));
          await services.auth.signOut();
          setSession(null);
          navigate(c.home, { replace: true });
        }}
      >
        Sign out
      </Button>
    </>
  );
}
export const AddressesScreen = () => <CustomerAddresses />;
export const OrdersScreen = () => <CustomerOrders />;
export function OrderScreen() {
  const { id = '' } = useParams();
  return <CustomerOrderView id={id} />;
}
export const ReturnsScreen = () => <CustomerReturns />;
export function ReturnScreen() {
  const { id = '' } = useParams();
  return <CustomerReturnView id={id} />;
}
export const TicketsScreen = () => <CustomerTickets />;
export function NewTicketScreen() {
  const [sp] = useSearchParams();
  return <NewTicketForm orderId={sp.get('order') ?? undefined} />;
}
export function TicketScreen() {
  const { id = '' } = useParams();
  return <CustomerTicketView id={id} />;
}
export const NotificationsScreen = () => (
  <>
    <PushPrompt text="Get a push alert when your order status or a refund changes." />
    <CustomerNotifications />
  </>
);
export const ProfileScreen = () => <CustomerProfile />;
