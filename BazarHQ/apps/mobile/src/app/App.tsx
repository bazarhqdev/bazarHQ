import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  NativeProvider,
  NavigationProvider,
  ServicesProvider,
  SessionProvider,
  ToastProvider,
  type AppLinkComponent,
  type NativeCapabilities,
} from '@bazarhq/ui';
import { services } from '@/services/services';
import { adminPaths, customerPaths, paths } from '@/navigation/paths';
import { hideNativeSplash, isNative, openExternal, pickImage, saveTextFile } from '@/services/native';
import { Guard, NativeBridge, TabLayout } from '@/navigation/Shell';
import { AdminTabLayout, CustomerTabLayout, RoleHome, WelcomeScreen } from '@/navigation/RoleShell';
import { SplashScreen } from '@/features/merchant/Splash';
import { ForgotPasswordScreen, LoginScreen, RegisterScreen, ResetPasswordScreen, VerifyEmailScreen } from '@/features/merchant/auth';
import { OnboardingScreen, OnboardingStoreScreen, OnboardingThemeScreen } from '@/features/merchant/onboarding';
import { HomeScreen } from '@/features/merchant/Home';
import { ProductEditorScreen, ProductsScreen } from '@/features/merchant/products';
import { InventoryScreen } from '@/features/merchant/Inventory';
import { OrderDetailScreen, OrdersScreen } from '@/features/merchant/orders';
import { AnalyticsScreen } from '@/features/merchant/Analytics';
import { MoreScreen } from '@/features/merchant/More';
import { PaymentsScreen } from '@/features/merchant/Payments';
import { NotificationsScreen } from '@/features/merchant/Notifications';
import { SupportScreen, TicketScreen } from '@/features/merchant/support';
import { SettingsScreen } from '@/features/merchant/Settings';
import { ReturnDetailScreen, ReturnsScreen } from '@/features/merchant/returns';
import { FullScreenLoader } from '@/navigation/Shell';

/** Customer and Super Admin stacks load on demand so the merchant start-up bundle stays small. */
function lazyScreens<K extends string>(loader: () => Promise<Record<K, unknown>>, names: readonly K[]): Record<K, ComponentType> {
  return Object.fromEntries(names.map((n) => [n, lazy(async () => ({ default: (await loader())[n] as ComponentType }))])) as unknown as Record<
    K,
    ComponentType
  >;
}
const C = lazyScreens(() => import('@/features/customer/screens'), [
  'LoginScreen',
  'RegisterScreen',
  'VerifyScreen',
  'ForgotScreen',
  'SslScreen',
  'HomeScreen',
  'StoresScreen',
  'TrackScreen',
  'CartsScreen',
  'PolicyScreen',
  'StoreLayout',
  'StoreHomeScreen',
  'StoreProductsScreen',
  'ProductScreen',
  'StoreCartScreen',
  'CheckoutScreen',
  'SuccessScreen',
  'AccountLayout',
  'AccountScreen',
  'OrdersScreen',
  'OrderScreen',
  'ReturnsScreen',
  'ReturnScreen',
  'TicketsScreen',
  'NewTicketScreen',
  'TicketScreen',
  'NotificationsScreen',
  'ProfileScreen',
  'AddressesScreen',
] as const);
const A = lazyScreens(() => import('@/features/admin/screens'), [
  'NetworkCheckScreen',
  'AdminLoginScreen',
  'AdminTotpScreen',
  'DashboardScreen',
  'HealthScreen',
  'MerchantsScreen',
  'MerchantScreen',
  'CustomersScreen',
  'CustomerScreen',
  'StoresScreen',
  'OrdersScreen',
  'OrderScreen',
  'ThemesScreen',
  'AnnouncementsScreen',
  'PoliciesScreen',
  'SupportScreen',
  'TicketScreen',
  'DisputesScreen',
  'DisputeScreen',
  'RefundsScreen',
  'AuditScreen',
  'NotificationsScreen',
  'ProfileScreen',
  'AdminMoreScreen',
] as const);

const AppLink: AppLinkComponent = ({ href, children, ...rest }) => (
  <Link to={href} {...rest}>
    {children}
  </Link>
);

function Navigation({ children }: { children: ReactNode }) {
  const nav = useNavigate();
  const navigate = useCallback((href: string, opts?: { replace?: boolean }) => nav(href, { replace: opts?.replace }), [nav]);
  return (
    <NavigationProvider Link={AppLink} navigate={navigate} paths={paths} customerPaths={customerPaths} adminPaths={adminPaths} platform="mobile">
      {children}
    </NavigationProvider>
  );
}

export function App() {
  const [splash, setSplash] = useState(true);
  useEffect(() => {
    void hideNativeSplash();
    const t = setTimeout(() => setSplash(false), 1100);
    return () => clearTimeout(t);
  }, []);
  // Camera + Filesystem/Share are offered to shared screens only inside the Android app.
  const native = useMemo<NativeCapabilities>(
    () => (isNative() ? { pickImage, saveText: saveTextFile, openUrl: openExternal } : { saveText: saveTextFile }),
    [],
  );

  return (
    <ServicesProvider services={services}>
      <NativeProvider value={native}>
        <BrowserRouter>
          <Navigation>
            <ToastProvider placement="top-center">
              <SessionProvider>
                <NativeBridge />
                {splash ? (
                  <SplashScreen />
                ) : (
                  <Suspense fallback={<FullScreenLoader />}>
                    <Routes>
                      <Route path="/" element={<RoleHome />} />
                      <Route path="/welcome" element={<WelcomeScreen />} />

                      {/* Merchant */}
                      <Route path={paths.login} element={<LoginScreen />} />
                      <Route path={paths.register} element={<RegisterScreen />} />
                      <Route path={paths.forgotPassword} element={<ForgotPasswordScreen />} />
                      <Route path="/reset-password" element={<ResetPasswordScreen />} />
                      <Route path={paths.verifyEmail} element={<VerifyEmailScreen />} />
                      <Route
                        path={paths.onboarding}
                        element={
                          <Guard requireStore={false}>
                            <OnboardingScreen />
                          </Guard>
                        }
                      />
                      <Route
                        path={paths.onboardingStore}
                        element={
                          <Guard requireStore={false}>
                            <OnboardingStoreScreen />
                          </Guard>
                        }
                      />
                      <Route
                        path={paths.onboardingTheme}
                        element={
                          <Guard requireStore={false}>
                            <OnboardingThemeScreen />
                          </Guard>
                        }
                      />
                      <Route
                        element={
                          <Guard>
                            <TabLayout />
                          </Guard>
                        }
                      >
                        <Route path={paths.dashboard} element={<HomeScreen />} />
                        <Route path={paths.products} element={<ProductsScreen />} />
                        <Route path={paths.productNew} element={<ProductEditorScreen />} />
                        <Route path="/products/:id" element={<ProductEditorScreen />} />
                        <Route path={paths.inventory} element={<InventoryScreen />} />
                        <Route path={paths.orders} element={<OrdersScreen />} />
                        <Route path="/orders/:id" element={<OrderDetailScreen />} />
                        <Route path={paths.returns} element={<ReturnsScreen />} />
                        <Route path="/returns/:id" element={<ReturnDetailScreen />} />
                        <Route path={paths.analytics} element={<AnalyticsScreen />} />
                        <Route path="/more" element={<MoreScreen />} />
                        <Route path={paths.paymentSettings} element={<PaymentsScreen />} />
                        <Route path={paths.notifications} element={<NotificationsScreen />} />
                        <Route path={paths.support} element={<SupportScreen />} />
                        <Route path="/support/:id" element={<TicketScreen />} />
                        <Route path={paths.storeSettings} element={<SettingsScreen />} />
                      </Route>

                      {/* Customer */}
                      <Route path="/c/login" element={<C.LoginScreen />} />
                      <Route path="/c/register" element={<C.RegisterScreen />} />
                      <Route path="/c/verify-email" element={<C.VerifyScreen />} />
                      <Route path="/c/forgot-password" element={<C.ForgotScreen />} />
                      <Route path="/c/pay/ssl" element={<C.SslScreen />} />
                      <Route element={<CustomerTabLayout />}>
                        <Route path="/c" element={<C.HomeScreen />} />
                        <Route path="/c/stores" element={<C.StoresScreen />} />
                        <Route path="/c/track" element={<C.TrackScreen />} />
                        <Route path="/c/cart" element={<C.CartsScreen />} />
                        <Route path="/c/policy/:type" element={<C.PolicyScreen />} />
                        <Route path="/c/s/:sub" element={<C.StoreLayout />}>
                          <Route index element={<C.StoreHomeScreen />} />
                          <Route path="products" element={<C.StoreProductsScreen />} />
                          <Route path="p/:slug" element={<C.ProductScreen />} />
                          <Route path="cart" element={<C.StoreCartScreen />} />
                          <Route path="checkout" element={<C.CheckoutScreen />} />
                          <Route path="success" element={<C.SuccessScreen />} />
                        </Route>
                        <Route element={<C.AccountLayout />}>
                          <Route path="/c/account" element={<C.AccountScreen />} />
                          <Route path="/c/orders" element={<C.OrdersScreen />} />
                          <Route path="/c/orders/:id" element={<C.OrderScreen />} />
                          <Route path="/c/returns" element={<C.ReturnsScreen />} />
                          <Route path="/c/returns/:id" element={<C.ReturnScreen />} />
                          <Route path="/c/support" element={<C.TicketsScreen />} />
                          <Route path="/c/support/new" element={<C.NewTicketScreen />} />
                          <Route path="/c/support/:id" element={<C.TicketScreen />} />
                          <Route path="/c/notifications" element={<C.NotificationsScreen />} />
                          <Route path="/c/profile" element={<C.ProfileScreen />} />
                          <Route path="/c/addresses" element={<C.AddressesScreen />} />
                        </Route>
                      </Route>

                      {/* Super Admin */}
                      <Route path="/a/network" element={<A.NetworkCheckScreen />} />
                      <Route path="/a/login" element={<A.AdminLoginScreen />} />
                      <Route path="/a/totp" element={<A.AdminTotpScreen />} />
                      <Route path="/a" element={<Navigate to="/a/network" replace />} />
                      <Route element={<AdminTabLayout />}>
                        <Route path="/a/dashboard" element={<A.DashboardScreen />} />
                        <Route path="/a/health" element={<A.HealthScreen />} />
                        <Route path="/a/merchants" element={<A.MerchantsScreen />} />
                        <Route path="/a/merchants/:id" element={<A.MerchantScreen />} />
                        <Route path="/a/customers" element={<A.CustomersScreen />} />
                        <Route path="/a/customers/:id" element={<A.CustomerScreen />} />
                        <Route path="/a/stores" element={<A.StoresScreen />} />
                        <Route path="/a/orders" element={<A.OrdersScreen />} />
                        <Route path="/a/orders/:id" element={<A.OrderScreen />} />
                        <Route path="/a/themes" element={<A.ThemesScreen />} />
                        <Route path="/a/announcements" element={<A.AnnouncementsScreen />} />
                        <Route path="/a/policies" element={<A.PoliciesScreen />} />
                        <Route path="/a/support" element={<A.SupportScreen />} />
                        <Route path="/a/support/:id" element={<A.TicketScreen />} />
                        <Route path="/a/disputes" element={<A.DisputesScreen />} />
                        <Route path="/a/disputes/:kind/:id" element={<A.DisputeScreen />} />
                        <Route path="/a/refunds" element={<A.RefundsScreen />} />
                        <Route path="/a/audit" element={<A.AuditScreen />} />
                        <Route path="/a/notifications" element={<A.NotificationsScreen />} />
                        <Route path="/a/profile" element={<A.ProfileScreen />} />
                        <Route path="/a/more" element={<A.AdminMoreScreen />} />
                      </Route>

                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>
                )}
              </SessionProvider>
            </ToastProvider>
          </Navigation>
        </BrowserRouter>
      </NativeProvider>
    </ServicesProvider>
  );
}
