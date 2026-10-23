'use client';

/**
 * Cart, three-step checkout, order success + wallet reference, and the
 * SSLCommerz sandbox page (SRS §11.3–11.4). The server re-validates price,
 * stock and payment availability on every order (FR-C-12/15/21).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Lock,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  Truck,
  Wallet,
} from 'lucide-react';
import { Controller } from 'react-hook-form';
import {
  BD_DISTRICTS,
  checkoutDeliverySchema,
  errorMessage,
  formatBDT,
  isServiceError,
  newIdempotencyKey,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  walletReferenceSchema,
  type Address,
  type CartValidation,
  type CheckoutDeliveryInput,
  type PaymentMethod,
  type TrackingResult,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  PaymentMethodMark,
  PaymentStatusBadge,
  SelectField,
  Skeleton,
  Stepper,
  TextField,
  useToast,
} from '../../components';
import { useAsync, useCustomerPaths, useNavigation, useServices, useSession } from '../../context';
import { applyServerErrors, useZodForm } from '../../form';
import { useNative } from '../../native';
import { ProductArt } from './art';
import { cartStore, checkoutDraft, useCart } from './cart';
import { useStore } from './storefront';

const lineKey = (l: { productId: string; variantId: string | null }) => `${l.productId}:${l.variantId ?? ''}`;

/* ------------------------------------------------------------------ */
/* Last placed order (this tab only) — lets the success page show it   */
/* ------------------------------------------------------------------ */

interface LastOrder {
  orderId: string;
  orderNumber: string;
  phone: string;
  subdomain: string;
  method: PaymentMethod;
}
export const lastOrderStore = {
  set(o: LastOrder) {
    try {
      globalThis.sessionStorage?.setItem(`bazarhq.order.${o.orderNumber}`, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  },
  get(orderNumber: string): LastOrder | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(`bazarhq.order.${orderNumber}`);
      return raw ? (JSON.parse(raw) as LastOrder) : null;
    } catch {
      return null;
    }
  },
};

/** Real gateways return an absolute https URL; the mock returns a sandbox session handled in-app. */
function goToGateway(
  s: { redirectUrl: string; sessionToken: string },
  navigate: (href: string) => void,
  p: ReturnType<typeof useCustomerPaths>,
  openUrl?: (url: string) => Promise<void>,
) {
  if (/^https:\/\//.test(s.redirectUrl)) {
    // Android opens the gateway in a Custom Tab; the result comes back via the bazarhq:// return link.
    if (openUrl) void openUrl(s.redirectUrl);
    else globalThis.location.assign(s.redirectUrl);
  } else navigate(p.sslSandbox(s.sessionToken));
}

/* ------------------------------------------------------------------ */
/* Cart (FR-C-08..12)                                                  */
/* ------------------------------------------------------------------ */

function useCartCheck(district?: string) {
  const store = useStore();
  const services = useServices();
  const cart = useCart(store.id);
  const items = cart?.items ?? [];
  const sig = items.map((i) => `${lineKey(i)}x${i.quantity}@${i.unitPrice}`).join('|');
  return useAsync<CartValidation | null>(
    () => (items.length ? services.storefront.validateCart(store.id, items, district) : Promise.resolve(null)),
    [store.id, sig, district],
  );
}

export function CartView() {
  const store = useStore();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const toast = useToast();
  const cart = useCart(store.id);
  const check = useCartCheck();
  const items = cart?.items ?? [];
  const lines = new Map((check.data?.lines ?? []).map((l) => [lineKey(l), l]));
  const priceChanges = (check.data?.lines ?? []).filter((l) => l.priceChanged);
  const unavailable = (check.data?.lines ?? []).filter((l) => !l.available);
  const capped = (check.data?.lines ?? []).filter((l) => l.quantityCapped && l.available);

  // FR-C-09: quantities above stock are capped (with a notice).
  useEffect(() => {
    for (const l of capped) cartStore.setQuantity(store.id, l, l.quantity);
    if (capped.length) toast.info('Quantities updated', 'Some items have less stock than requested, so we reduced the quantity.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capped.map(lineKey).join(',')]);

  if (items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="sr-only">Your cart</h1>
        <EmptyState
          icon={<ShoppingBag className="size-6" aria-hidden />}
          title="Your cart is empty"
          description={`Browse ${store.name} and add something you like.`}
          action={
            <Link
              href={p.storeProducts(store.subdomain)}
              className="inline-flex h-10 items-center rounded-full bg-[var(--store)] px-5 text-sm font-bold text-[var(--store-ink)]"
            >
              Browse products
            </Link>
          }
        />
      </main>
    );
  }

  const acceptPrices = () => {
    for (const l of priceChanges) cartStore.acceptPrice(store.id, l, l.currentUnitPrice);
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <h1 className="text-2xl font-bold text-ink">Your cart</h1>
      <p className="text-sm text-ink-muted">Items from {store.name} only. Each store has its own cart.</p>
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Cart items" className="space-y-3">
          {priceChanges.length > 0 && (
            <Alert
              tone="warning"
              title="Prices changed"
              action={
                <Button size="sm" variant="secondary" onClick={acceptPrices}>
                  Got it
                </Button>
              }
            >
              {priceChanges.length === 1 ? 'An item’s price changed' : `${priceChanges.length} prices changed`} since you added{' '}
              {priceChanges.length === 1 ? 'it' : 'them'}. The cart shows the current price.
            </Alert>
          )}
          {unavailable.length > 0 && (
            <Alert tone="danger" title="Some items are unavailable">
              Remove sold-out or unavailable items to continue to checkout.
            </Alert>
          )}
          <Card className="divide-y divide-line">
            {items.map((it) => {
              const l = lines.get(lineKey(it));
              const price = l?.currentUnitPrice ?? it.unitPrice;
              const max = l?.availableStock ?? 99;
              return (
                <div key={lineKey(it)} className="flex gap-3 p-4">
                  <Link href={p.product(store.subdomain, it.slug ?? it.productId)} className="block size-20 shrink-0 overflow-hidden rounded-xl">
                    <ProductArt name={it.name} url={it.imageUrl} className="h-full w-full" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={p.product(store.subdomain, it.slug ?? it.productId)}
                          className="line-clamp-2 text-sm font-semibold text-ink hover:text-[var(--store)]"
                        >
                          {it.name}
                        </Link>
                        {it.variantLabel && <p className="text-[12.5px] text-ink-muted">{it.variantLabel}</p>}
                        <p className="mt-0.5 text-[13px] tabular text-ink-muted">
                          {formatBDT(price)} each
                          {l?.priceChanged && <span className="ml-1.5 text-[12px] text-amber-800 line-through">{formatBDT(it.unitPrice)}</span>}
                        </p>
                      </div>
                      <p className="text-sm font-bold tabular text-ink">{formatBDT(price * it.quantity)}</p>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      {l && !l.available ? (
                        <Badge tone="danger">Unavailable</Badge>
                      ) : (
                        <div className="inline-flex h-9 items-center rounded-lg border border-line-strong">
                          <button
                            type="button"
                            aria-label={`Decrease ${it.name}`}
                            onClick={() => cartStore.setQuantity(store.id, it, it.quantity - 1)}
                            className="flex size-9 items-center justify-center"
                          >
                            <Minus className="size-3.5" aria-hidden />
                          </button>
                          <span className="w-7 text-center text-sm font-semibold tabular">{it.quantity}</span>
                          <button
                            type="button"
                            aria-label={`Increase ${it.name}`}
                            onClick={() =>
                              it.quantity >= max ? toast.info('Stock limit', `Only ${max} available.`) : cartStore.setQuantity(store.id, it, it.quantity + 1)
                            }
                            className="flex size-9 items-center justify-center"
                          >
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => cartStore.remove(store.id, it)}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-ink-subtle hover:text-red-700"
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
          <button type="button" onClick={() => cartStore.clear(store.id)} className="text-[13px] font-semibold text-ink-subtle hover:text-red-700">
            Clear cart
          </button>
        </section>
        <aside>
          <Card className="space-y-3 p-5 lg:sticky lg:top-20">
            <h2 className="text-base font-bold text-ink">Order summary</h2>
            {check.loading && !check.data ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="font-semibold tabular">{formatBDT(check.data?.subtotal ?? 0)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Delivery</dt>
                  <dd className="tabular text-ink-muted">
                    {formatBDT(store.shipping.insideDhakaCharge)} Dhaka / {formatBDT(store.shipping.outsideDhakaCharge)} outside
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base">
                  <dt className="font-bold">Estimated total</dt>
                  <dd className="font-extrabold tabular">{formatBDT(check.data?.total ?? 0)}</dd>
                </div>
              </dl>
            )}
            <p className="text-[12px] text-ink-subtle">Final delivery charge is set by your district at checkout.</p>
            <button
              type="button"
              disabled={unavailable.length > 0 || check.loading}
              onClick={() => {
                acceptPrices();
                navigate(p.storeCheckout(store.subdomain));
              }}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--store)] text-sm font-bold text-[var(--store-ink)] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-subtle"
            >
              <Lock className="size-4" aria-hidden /> Checkout
            </button>
            <Link href={p.storeProducts(store.subdomain)} className="block text-center text-sm font-semibold text-ink-muted hover:text-ink">
              Continue shopping
            </Link>
          </Card>
        </aside>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Checkout (FR-C-13..19)                                              */
/* ------------------------------------------------------------------ */

const METHOD_HELP: Record<PaymentMethod, { text: string; icon: typeof Wallet }> = {
  cod: { text: 'Pay in cash when the order arrives.', icon: Truck },
  bkash: { text: 'Pay with the bKash app, then enter the transaction ID.', icon: Smartphone },
  nagad: { text: 'Pay with the Nagad app, then enter the transaction ID.', icon: Smartphone },
  rocket: { text: 'Pay with Rocket, then enter the transaction ID. The store verifies it.', icon: Smartphone },
  sslcommerz: { text: 'Card, mobile banking or net banking on the secure SSLCommerz page.', icon: CreditCard },
};

type Draft = { delivery?: Partial<CheckoutDeliveryInput>; method?: PaymentMethod; step?: number };

export function CheckoutFlow() {
  const store = useStore();
  const services = useServices();
  const { session } = useSession();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const cart = useCart(store.id);
  const native = useNative();
  const isCustomer = session?.user.role === 'customer';
  const draft = useMemo(() => checkoutDraft.get<Draft>(store.id) ?? {}, [store.id]);
  const [step, setStep] = useState(Math.min(draft.step ?? 0, 1));
  const [method, setMethod] = useState<PaymentMethod | null>(draft.method && store.enabledPaymentMethods.includes(draft.method) ? draft.method : null);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<{ text: string; cart?: boolean } | null>(null);
  const idem = useRef(newIdempotencyKey('order'));
  const addresses = useAsync<Address[]>(() => (isCustomer ? services.account.listAddresses() : Promise.resolve([])), [isCustomer]);
  const [addressId, setAddressId] = useState<string | 'new'>('new');

  const form = useZodForm(checkoutDeliverySchema, {
    recipientName: draft.delivery?.recipientName ?? (isCustomer ? session!.user.fullName : ''),
    phone: draft.delivery?.phone ?? (isCustomer ? (session!.user.phone ?? '') : ''),
    email: draft.delivery?.email ?? (isCustomer ? session!.user.email : ''),
    address: draft.delivery?.address ?? '',
    district: draft.delivery?.district ?? '',
    postalCode: draft.delivery?.postalCode ?? '',
    saveAddress: draft.delivery?.saveAddress ?? false,
  });
  const district = form.watch('district');
  const check = useCartCheck(district || undefined);

  // Saved address pre-fills the delivery step (FR-C-14 note / FR-C-33).
  useEffect(() => {
    const def = addresses.data?.find((a) => a.isDefault);
    if (def && !draft.delivery?.address) pickAddress(def);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addresses.data]);

  // Persist the draft so a session expiry returns the customer to checkout with their details (FR-C-22).
  useEffect(() => {
    const sub = form.watch((v) => checkoutDraft.set(store.id, { delivery: v, method, step }));
    return () => sub.unsubscribe();
  }, [form, store.id, method, step]);
  useEffect(() => checkoutDraft.set(store.id, { delivery: form.getValues(), method, step }), [form, store.id, method, step]);

  function pickAddress(a: Address) {
    setAddressId(a.id);
    form.reset({
      ...form.getValues(),
      recipientName: a.recipientName,
      phone: a.phone,
      address: a.address,
      district: a.district,
      postalCode: a.postalCode ?? '',
      saveAddress: false,
    });
  }

  if (!cart || cart.items.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="sr-only">Checkout</h1>
        <EmptyState
          icon={<ShoppingBag className="size-6" aria-hidden />}
          title="Nothing to check out"
          description="Your cart for this store is empty."
          action={
            <Link href={p.storeProducts(store.subdomain)} className="text-sm font-semibold text-[var(--store)] hover:underline">
              Browse products
            </Link>
          }
        />
      </main>
    );
  }

  const v = check.data;
  const delivery = form.getValues();

  const place = async () => {
    if (!method) return;
    setPlacing(true);
    setError(null);
    try {
      const res = await services.checkout.placeOrder({
        storeId: store.id,
        items: cart.items.map((i) => ({ productId: i.productId, variantId: i.variantId, quantity: i.quantity, expectedUnitPrice: i.unitPrice })),
        delivery: {
          recipientName: delivery.recipientName,
          phone: delivery.phone,
          email: delivery.email || null,
          address: delivery.address,
          district: delivery.district,
          postalCode: delivery.postalCode || null,
        },
        paymentMethod: method,
        saveAddress: isCustomer && delivery.saveAddress,
        idempotencyKey: idem.current,
      });
      lastOrderStore.set({ orderId: res.order.id, orderNumber: res.order.orderNumber, phone: res.order.orderPhone, subdomain: store.subdomain, method });
      cartStore.clear(store.id);
      checkoutDraft.clear(store.id);
      if (res.nextAction === 'redirect_sslcommerz') {
        const s = await services.checkout.startSslcommerz(res.order.id, { phone: res.order.orderPhone });
        goToGateway(s, navigate, p, native.openUrl);
        return;
      }
      navigate(p.orderSuccess(store.subdomain, res.order.orderNumber), { replace: true });
    } catch (err) {
      setPlacing(false);
      if (isServiceError(err) && err.code === 'VALIDATION' && applyServerErrors(form, err)) {
        setStep(0);
        setError({ text: 'Please fix your delivery details.' });
        return;
      }
      // Stock or price changed: send the customer back to the cart to review (FR-C-12/21).
      const cartIssue = isServiceError(err) && err.code === 'CONFLICT' && !/payment|not available for this store/i.test(err.message);
      setError({ text: errorMessage(err), cart: cartIssue });
      idem.current = newIdempotencyKey('order');
      void check.reload();
    }
  };

  const steps = ['Delivery', 'Payment', 'Review'];
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Link href={p.storeCart(store.subdomain)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-ink-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Back to cart
      </Link>
      <h1 className="mt-1 text-2xl font-bold text-ink">Checkout</h1>
      <div className="mt-4 max-w-xl">
        <Stepper steps={steps} current={step} />
      </div>
      {!isCustomer && step === 0 && (
        <p className="mt-3 text-[13px] text-ink-muted">
          Checking out as a guest.{' '}
          <Link href={p.login(p.storeCheckout(store.subdomain))} className="font-semibold text-[var(--store)] hover:underline">
            Sign in
          </Link>{' '}
          to use saved addresses and see this order in your account.
        </p>
      )}
      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          {error && (
            <Alert
              tone="danger"
              title="We couldn’t place your order"
              action={
                error.cart ? (
                  <Link href={p.storeCart(store.subdomain)} className="text-sm font-semibold underline">
                    Review cart
                  </Link>
                ) : undefined
              }
            >
              {error.text}
            </Alert>
          )}

          {step === 0 && (
            <Card className="p-5">
              <form noValidate onSubmit={form.handleSubmit(() => setStep(1))} className="space-y-4" aria-labelledby="delivery-h">
                <h2 id="delivery-h" className="flex items-center gap-2 text-base font-bold text-ink">
                  <MapPin className="size-4" aria-hidden /> Delivery information
                </h2>
                {(addresses.data?.length ?? 0) > 0 && (
                  <fieldset>
                    <legend className="text-sm font-semibold text-ink">Saved addresses</legend>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {addresses.data!.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => pickAddress(a)}
                          aria-pressed={addressId === a.id}
                          className={cn(
                            'rounded-xl border p-3 text-left text-[13px]',
                            addressId === a.id ? 'border-[var(--store)] ring-1 ring-[var(--store)]' : 'border-line-strong hover:border-ink-subtle',
                          )}
                        >
                          <span className="flex items-center gap-1.5 font-semibold text-ink">
                            {a.label}
                            {a.isDefault && <Badge tone="success">Default</Badge>}
                          </span>
                          <span className="mt-1 block text-ink-muted">
                            {a.address}, {a.district}
                          </span>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setAddressId('new');
                          form.reset({ ...form.getValues(), address: '', district: '', postalCode: '' });
                        }}
                        aria-pressed={addressId === 'new'}
                        className={cn(
                          'rounded-xl border border-dashed p-3 text-left text-[13px] font-semibold',
                          addressId === 'new' ? 'border-[var(--store)] text-ink' : 'border-line-strong text-ink-muted',
                        )}
                      >
                        + New address
                      </button>
                    </div>
                  </fieldset>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <TextField
                    label="Full name"
                    required
                    autoComplete="name"
                    {...form.register('recipientName')}
                    error={form.formState.errors.recipientName?.message}
                  />
                  <TextField
                    label="Phone"
                    required
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="01XXXXXXXXX"
                    hint="Bangladesh mobile, 11 digits"
                    {...form.register('phone')}
                    error={form.formState.errors.phone?.message}
                  />
                  <TextField
                    label="Email (optional)"
                    type="email"
                    autoComplete="email"
                    hint="For an email confirmation"
                    containerClassName="sm:col-span-2"
                    {...form.register('email')}
                    error={form.formState.errors.email?.message}
                  />
                  <TextField
                    label="Address"
                    required
                    autoComplete="street-address"
                    placeholder="House, road, area"
                    containerClassName="sm:col-span-2"
                    {...form.register('address')}
                    error={form.formState.errors.address?.message}
                  />
                  <SelectField
                    label="District"
                    required
                    placeholder="Choose district"
                    options={BD_DISTRICTS.map((d) => ({ value: d, label: d }))}
                    {...form.register('district')}
                    error={form.formState.errors.district?.message}
                  />
                  <TextField
                    label="Postal code (optional)"
                    inputMode="numeric"
                    maxLength={4}
                    {...form.register('postalCode')}
                    error={form.formState.errors.postalCode?.message}
                  />
                </div>
                {isCustomer && addressId === 'new' && (
                  <Controller
                    control={form.control}
                    name="saveAddress"
                    render={({ field }) => (
                      <Checkbox
                        label="Save this address to my account"
                        description="Up to 3 saved addresses."
                        checked={Boolean(field.value)}
                        onChange={field.onChange}
                      />
                    )}
                  />
                )}
                <div className="flex justify-end">
                  <Button type="submit" size="lg">
                    Continue to payment
                  </Button>
                </div>
              </form>
            </Card>
          )}

          {step === 1 && (
            <Card className="p-5">
              <h2 className="text-base font-bold text-ink">Payment method</h2>
              <p className="text-[13px] text-ink-muted">Only methods {store.name} has turned on are shown.</p>
              <div role="radiogroup" aria-label="Payment method" className="mt-4 space-y-2">
                {store.enabledPaymentMethods.map((m) => {
                  const Icon = METHOD_HELP[m].icon;
                  return (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={method === m}
                      onClick={() => setMethod(m)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border p-3.5 text-left',
                        method === m ? 'border-[var(--store)] bg-white ring-1 ring-[var(--store)]' : 'border-line-strong bg-white hover:border-ink-subtle',
                      )}
                    >
                      <PaymentMethodMark method={m} size={36} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{PAYMENT_METHOD_LABEL[m]}</span>
                        <span className="block text-[12.5px] text-ink-muted">{METHOD_HELP[m].text}</span>
                      </span>
                      <Icon className="size-4 text-ink-subtle" aria-hidden />
                      <span
                        className={cn(
                          'size-4 rounded-full border-2',
                          method === m ? 'border-[var(--store)] bg-[var(--store)] shadow-[inset_0_0_0_3px_white]' : 'border-line-strong',
                        )}
                        aria-hidden
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex justify-between">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                <Button size="lg" disabled={!method} onClick={() => setStep(2)}>
                  Review order
                </Button>
              </div>
            </Card>
          )}

          {step === 2 && method && (
            <Card className="space-y-5 p-5">
              <h2 className="text-base font-bold text-ink">Review your order</h2>
              <section aria-label="Items">
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {cart.items.map((i) => (
                    <li key={lineKey(i)} className="flex items-center gap-3 p-3">
                      <ProductArt name={i.name} url={i.imageUrl} className="size-12 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{i.name}</p>
                        <p className="text-[12.5px] text-ink-muted">
                          {i.variantLabel ? `${i.variantLabel} · ` : ''}
                          {i.quantity} × {formatBDT(i.unitPrice)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular">{formatBDT(i.unitPrice * i.quantity)}</p>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">Deliver to</p>
                    <button type="button" className="text-[13px] font-semibold text-[var(--store)]" onClick={() => setStep(0)}>
                      Edit
                    </button>
                  </div>
                  <p className="mt-1 text-ink-muted">
                    {delivery.recipientName} · {delivery.phone}
                    <br />
                    {delivery.address}, {delivery.district} {delivery.postalCode}
                  </p>
                </div>
                <div className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">Payment</p>
                    <button type="button" className="text-[13px] font-semibold text-[var(--store)]" onClick={() => setStep(1)}>
                      Edit
                    </button>
                  </div>
                  <p className="mt-1 flex items-center gap-2 text-ink-muted">
                    <PaymentMethodMark method={method} size={22} /> {PAYMENT_METHOD_LABEL[method]}
                  </p>
                </div>
              </div>
              <section className="rounded-xl bg-canvas p-3 text-[13px] text-ink-muted" aria-label="Policies">
                <p>
                  <strong className="text-ink">Shipping:</strong>{' '}
                  {delivery.district === 'Dhaka' ? `${store.shipping.estimatedDaysInsideDhaka}` : `${store.shipping.estimatedDaysOutsideDhaka}`}-day estimated
                  delivery to {delivery.district}.
                </p>
                <p className="mt-1">
                  <strong className="text-ink">Returns:</strong> you can request a return within {store.returnWindowDays} days of delivery from your account.
                </p>
                <p className="mt-1">
                  By placing this order you agree to the{' '}
                  <Link href={p.policy('tos')} className="font-semibold underline">
                    Terms of Service
                  </Link>{' '}
                  and{' '}
                  <Link href={p.policy('privacy')} className="font-semibold underline">
                    Privacy Policy
                  </Link>
                  .
                </p>
              </section>
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(1)} disabled={placing}>
                  Back
                </Button>
                <button
                  type="button"
                  onClick={place}
                  disabled={placing || !v || v.hasChanges}
                  aria-busy={placing}
                  className="inline-flex h-12 items-center gap-2 rounded-xl bg-[var(--store)] px-6 text-sm font-bold text-[var(--store-ink)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Lock className="size-4" aria-hidden /> {placing ? 'Placing order…' : `Place order · ${formatBDT(v?.total ?? 0)}`}
                </button>
              </div>
              {v?.hasChanges && <p className="text-[13px] text-amber-800">Your cart changed (price or stock). Review the cart before placing the order.</p>}
            </Card>
          )}
        </div>
        <aside>
          <Card className="space-y-3 p-5 lg:sticky lg:top-20">
            <h2 className="text-base font-bold">Summary</h2>
            <p className="text-[13px] text-ink-muted">
              {(() => {
                const n = cart.items.reduce((s, i) => s + i.quantity, 0);
                return `${n} item${n === 1 ? '' : 's'} from ${store.name}`;
              })()}
            </p>
            {!v ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Subtotal</dt>
                  <dd className="tabular">{formatBDT(v.subtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Delivery {district ? `(${district})` : ''}</dt>
                  <dd className="tabular">{district ? formatBDT(v.deliveryCharge) : 'Choose district'}</dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base">
                  <dt className="font-bold">Total</dt>
                  <dd className="font-extrabold tabular">{formatBDT(v.total)}</dd>
                </div>
              </dl>
            )}
            <p className="flex items-start gap-2 text-[12px] text-ink-subtle">
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> Prices and stock are re-checked by the server when you place the order.
            </p>
          </Card>
        </aside>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Order success + wallet reference (FR-C-16/19)                       */
/* ------------------------------------------------------------------ */

export function OrderSuccess({ orderNumber }: { orderNumber: string }) {
  const store = useStore();
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const { session } = useSession();
  const last = useMemo(() => lastOrderStore.get(orderNumber), [orderNumber]);
  const [tick, setTick] = useState(0);
  const order = useAsync<TrackingResult | null>(
    () => (last ? services.storefront.trackOrder(orderNumber, last.phone) : Promise.resolve(null)),
    [orderNumber, last, tick],
  );
  const o = order.data;
  const walletPending = o && ['bkash', 'nagad', 'rocket'].includes(o.paymentMethod) && (o.paymentStatus === 'pending' || o.paymentStatus === 'failed');
  const cardRetry = o && o.paymentMethod === 'sslcommerz' && (o.paymentStatus === 'failed' || o.paymentStatus === 'pending');

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <CheckCircle2 className="size-8" aria-hidden />
        </span>
        <h1 className="mt-4 text-2xl font-bold text-ink">Order placed</h1>
        <p className="mt-1 text-sm text-ink-muted">Thank you for shopping at {store.name}.</p>
        <p className="mx-auto mt-4 inline-flex flex-col rounded-2xl border border-line bg-white px-6 py-3">
          <span className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Order ID</span>
          <span className="text-lg font-extrabold tracking-wide text-ink" data-testid="order-number">
            {orderNumber}
          </span>
        </p>
        <p className="mt-3 text-[13px] text-ink-muted">
          We’ve sent an SMS with your Order ID and tracking link{o?.deliveryAddress ? '' : ''}. Keep it to track your order with your phone number.
        </p>
      </div>

      {order.loading ? (
        <Skeleton className="mt-6 h-40 w-full" />
      ) : o ? (
        <Card className="mt-6 space-y-4 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <PaymentMethodMark method={o.paymentMethod} size={24} /> {PAYMENT_METHOD_LABEL[o.paymentMethod]}
            </p>
            <PaymentStatusBadge status={o.paymentStatus} />
          </div>
          {walletPending && (
            <WalletPayPanel
              orderNumber={orderNumber}
              method={o.paymentMethod}
              amount={o.totalAmount}
              phone={last!.phone}
              onDone={() => setTick((t) => t + 1)}
            />
          )}
          {o.paymentStatus === 'pending_verification' && (
            <Alert tone="info" title="Payment is being verified">
              {o.paymentMethod === 'rocket'
                ? `${store.name} will check your Rocket payment and confirm.`
                : 'We’re confirming your payment with the provider. You’ll get an SMS when it’s verified.'}
            </Alert>
          )}
          {cardRetry && (
            <Alert
              tone="warning"
              title={o.paymentStatus === 'failed' ? 'Card payment failed' : 'Card payment not completed'}
              action={<CardRetryButton orderNumber={orderNumber} phone={last!.phone} />}
            >
              Your order is saved. You can try the payment again.
            </Alert>
          )}
          <ul className="divide-y divide-line text-sm">
            {o.items.map((i, idx) => (
              <li key={idx} className="flex justify-between py-2">
                <span>
                  {i.productName}
                  {i.variantLabel ? ` · ${i.variantLabel}` : ''} × {i.quantity}
                </span>
                <span className="tabular">{formatBDT(i.subtotal)}</span>
              </li>
            ))}
            <li className="flex justify-between py-2 text-ink-muted">
              <span>Delivery</span>
              <span className="tabular">{formatBDT(o.deliveryCharge)}</span>
            </li>
            <li className="flex justify-between py-2 font-bold">
              <span>Total</span>
              <span className="tabular">{formatBDT(o.totalAmount)}</span>
            </li>
          </ul>
        </Card>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          href={p.track(orderNumber)}
          className="inline-flex h-11 items-center rounded-full bg-[var(--store)] px-5 text-sm font-bold text-[var(--store-ink)]"
        >
          Track this order
        </Link>
        {session?.user.role === 'customer' && (
          <Link href={p.orders} className="inline-flex h-11 items-center rounded-full border border-line-strong bg-white px-5 text-sm font-semibold">
            My orders
          </Link>
        )}
        <Link
          href={p.store(store.subdomain)}
          className="inline-flex h-11 items-center rounded-full border border-line-strong bg-white px-5 text-sm font-semibold"
        >
          Continue shopping
        </Link>
      </div>
    </main>
  );
}

function WalletPayPanel({
  orderNumber,
  method,
  amount,
  phone,
  onDone,
}: {
  orderNumber: string;
  method: PaymentMethod;
  amount: number;
  phone: string;
  onDone: () => void;
}) {
  const services = useServices();
  const toast = useToast();
  const last = lastOrderStore.get(orderNumber)!;
  const [busy, setBusy] = useState(false);
  const [idem, setIdem] = useState(() => newIdempotencyKey('wallet'));
  const form = useZodForm(walletReferenceSchema, { reference: '' });
  const submit = form.handleSubmit(async ({ reference }) => {
    setBusy(true);
    try {
      const r = await services.checkout.submitWalletReference(last.orderId, { phone, reference, idempotencyKey: idem });
      if (r.paymentStatus === 'paid') toast.success('Payment verified', `${PAYMENT_METHOD_LABEL[method]} payment confirmed.`);
      else if (r.paymentStatus === 'failed') toast.error('Payment not verified', 'The provider couldn’t confirm that transaction ID. Check it and try again.');
      else toast.info('Payment submitted', PAYMENT_STATUS_LABEL[r.paymentStatus]);
      setIdem(newIdempotencyKey('wallet'));
      onDone();
    } catch (err) {
      if (!applyServerErrors(form, err)) form.setError('reference', { message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  });
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
        <AlertTriangle className="size-4" aria-hidden /> Complete your {PAYMENT_METHOD_LABEL[method]} payment
      </p>
      <ol className="list-decimal space-y-0.5 pl-5 text-[13px] text-amber-950">
        <li>
          Open {PAYMENT_METHOD_LABEL[method]} and choose <strong>Payment</strong>.
        </li>
        <li>
          Pay <strong>{formatBDT(amount)}</strong> to the store’s merchant account and use <strong>{orderNumber}</strong> as the reference.
        </li>
        <li>Enter the transaction ID from the confirmation SMS below.</li>
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <TextField
          label="Transaction ID"
          placeholder="e.g. 9BX4K2LQ7M"
          autoComplete="off"
          containerClassName="flex-1"
          className="uppercase"
          {...form.register('reference')}
          error={form.formState.errors.reference?.message}
        />
        <Button type="submit" loading={busy} className="sm:mt-6">
          Submit
        </Button>
      </div>
      <p className="text-[12px] text-amber-900">The ID is checked by the server; entering it does not mark the order paid by itself.</p>
    </form>
  );
}

function CardRetryButton({ orderNumber, phone }: { orderNumber: string; phone: string }) {
  const services = useServices();
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const native = useNative();
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const last = lastOrderStore.get(orderNumber)!;
  return (
    <Button
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const s = await services.checkout.startSslcommerz(last.orderId, { phone });
          goToGateway(s, navigate, p, native.openUrl);
        } catch (err) {
          toast.error('Couldn’t start payment', errorMessage(err));
          setBusy(false);
        }
      }}
    >
      Pay now
    </Button>
  );
}

/* ------------------------------------------------------------------ */
/* SSLCommerz sandbox (stands in for the hosted gateway page)          */
/* ------------------------------------------------------------------ */

export function SslCommerzSandbox({ token }: { token: string }) {
  const services = useServices();
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finish = async (outcome: 'success' | 'failed' | 'cancelled') => {
    setBusy(outcome);
    setError(null);
    try {
      const r = await services.checkout.completeSslcommerzSandbox(token, outcome);
      const prev = lastOrderStore.get(r.orderNumber);
      if (prev) lastOrderStore.set({ ...prev, phone: r.phone });
      navigate(p.orderSuccess(r.subdomain, r.orderNumber), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0b3d5c] px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between bg-[#0e5a85] px-5 py-4 text-white">
          <p className="text-lg font-extrabold tracking-tight">SSLCOMMERZ</p>
          <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-bold uppercase">Sandbox</span>
        </div>
        <div className="space-y-4 p-5">
          <Alert tone="info" title="Test gateway">
            This page simulates the hosted SSLCommerz checkout. In production the store is told the result only by the gateway’s signed server-to-server
            notification (IPN), never by this redirect.
          </Alert>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="grid grid-cols-1 gap-2">
            <Button size="lg" block loading={busy === 'success'} disabled={Boolean(busy)} onClick={() => finish('success')}>
              Pay successfully (test card)
            </Button>
            <Button size="lg" block variant="danger-outline" loading={busy === 'failed'} disabled={Boolean(busy)} onClick={() => finish('failed')}>
              Simulate declined card
            </Button>
            <Button size="lg" block variant="ghost" loading={busy === 'cancelled'} disabled={Boolean(busy)} onClick={() => finish('cancelled')}>
              Cancel and return to store
            </Button>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-[12px] text-ink-subtle">
            <Lock className="size-3.5" aria-hidden /> Card details are never entered on BazarHQ.
          </p>
        </div>
      </div>
    </main>
  );
}
