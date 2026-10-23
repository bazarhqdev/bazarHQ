'use client';

/**
 * Root-site pages: store discovery (FR-C-01), public order tracking
 * (FR-C-23..29) and published platform policies.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, Circle, Clock3, Mail, PackageSearch, Phone, RefreshCw, Search, ShieldCheck, Store as StoreIcon, Truck, X } from 'lucide-react';
import {
  errorMessage,
  formatBDT,
  formatDate,
  formatDateTime,
  ORDER_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  STORE_CATEGORY_LABEL,
  trackOrderSchema,
  type OrderStatus,
  type Policy,
  type StoreSearchResult,
  type TrackingResult,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import { Alert, Button, Card, EmptyState, OrderStatusBadge, PaymentMethodMark, PaymentStatusBadge, Skeleton, TextField } from '../../components';
import { useAsync, useCustomerPaths, useDebounced, useNavigation, useServices } from '../../context';
import { useZodForm } from '../../form';
import { StoreLogo } from './art';
import { useAllCarts } from './cart';

/* ------------------------------------------------------------------ */
/* Discovery                                                           */
/* ------------------------------------------------------------------ */

export function StoreResultCard({ store }: { store: StoreSearchResult }) {
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  return (
    <Link
      href={p.store(store.subdomain)}
      className="group flex items-center gap-4 rounded-2xl border border-line bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]"
    >
      <StoreLogo name={store.name} url={store.logoUrl} colour={store.brandColour} size={56} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-bold text-ink group-hover:text-brand-700">{store.name}</p>
        <p className="truncate text-[13px] text-ink-muted">{store.tagline ?? (store.category ? STORE_CATEGORY_LABEL[store.category] : '')}</p>
        <p className="mt-1 text-[12px] text-ink-subtle">
          {store.subdomain}.bazarhq.com · {store.productCount} products
        </p>
      </div>
      <ArrowRight className="size-4 shrink-0 text-ink-subtle transition group-hover:translate-x-0.5 group-hover:text-ink" aria-hidden />
    </Link>
  );
}

export function StoreSearchBox({ initial = '', autoFocus, size = 'lg' }: { initial?: string; autoFocus?: boolean; size?: 'lg' | 'md' }) {
  const { navigate } = useNavigation();
  const p = useCustomerPaths();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        navigate(p.stores(q.trim()));
      }}
      className="relative"
    >
      <label htmlFor="store-q" className="sr-only">
        Search stores by name or address
      </label>
      <Search className={cn('pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-subtle', size === 'lg' ? 'size-5' : 'size-4')} aria-hidden />
      <input
        id="store-q"
        autoFocus={autoFocus}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Store name, or paste a store link"
        className={cn(
          'w-full rounded-full border border-line-strong bg-white text-ink shadow-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-100',
          size === 'lg' ? 'h-14 pl-12 pr-32 text-base' : 'h-11 pl-10 pr-28 text-sm',
        )}
      />
      <button
        type="submit"
        className={cn(
          'absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full bg-navy-900 font-semibold text-white hover:bg-navy-800',
          size === 'lg' ? 'h-11 px-5 text-sm' : 'h-8 px-4 text-[13px]',
        )}
      >
        Find store
      </button>
    </form>
  );
}

export function Landing() {
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const featured = useAsync(() => services.storefront.featuredStores(), []);
  const carts = useAllCarts();
  return (
    <main>
      <section className="relative overflow-hidden bg-navy-950 text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-30"
          style={{
            background: 'radial-gradient(60% 80% at 85% 10%, #10b981 0%, transparent 60%), radial-gradient(50% 60% at 0% 100%, #3a5b8c 0%, transparent 70%)',
          }}
        />
        <div className="relative mx-auto max-w-5xl px-4 pb-16 pt-14 text-center sm:pt-20">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] font-semibold text-brand-200">
            <ShieldCheck className="size-3.5" aria-hidden /> Shop directly from Bangladeshi stores
          </p>
          <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl">Find the store. Shop the store.</h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-navy-100">
            Every BazarHQ shop has its own storefront, its own cart and its own checkout — bKash, Nagad, Rocket, card or cash on delivery.
          </p>
          <div className="mx-auto mt-8 max-w-xl text-left">
            <StoreSearchBox />
          </div>
          <p className="mt-4 text-[13px] text-navy-200">
            Already ordered?{' '}
            <Link href={p.track()} className="font-semibold text-white underline underline-offset-4">
              Track your order
            </Link>
          </p>
        </div>
      </section>

      {carts.length > 0 && (
        <section className="mx-auto max-w-5xl px-4 pt-8" aria-labelledby="carts-h">
          <h2 id="carts-h" className="text-sm font-semibold uppercase tracking-wide text-ink-subtle">
            Your carts
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {carts.map((c) => (
              <li key={c.storeId}>
                <Link
                  href={p.storeCart(c.subdomain)}
                  className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-white px-4 py-2 text-sm font-semibold hover:border-brand-600"
                >
                  {c.storeName} <span className="rounded-full bg-brand-50 px-2 text-[12px] text-brand-800">{c.items.reduce((s, i) => s + i.quantity, 0)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mx-auto max-w-5xl px-4 py-10" aria-labelledby="featured-h">
        <div className="flex items-end justify-between">
          <h2 id="featured-h" className="text-xl font-bold text-ink">
            Stores on BazarHQ
          </h2>
          <Link href={p.stores()} className="text-sm font-semibold text-brand-700 hover:underline">
            Browse all
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {featured.loading
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
            : (featured.data ?? []).map((s) => <StoreResultCard key={s.id} store={s} />)}
        </div>
      </section>

      <section className="border-y border-line bg-white">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-4 py-10 sm:grid-cols-3">
          {[
            {
              icon: <StoreIcon className="size-5" aria-hidden />,
              title: 'One store at a time',
              text: 'Search finds stores, not a mixed catalogue. Each store keeps its own cart.',
            },
            {
              icon: <Truck className="size-5" aria-hidden />,
              title: 'Track with your phone',
              text: 'Use your Order ID and the phone number from checkout — no account needed.',
            },
            {
              icon: <ShieldCheck className="size-5" aria-hidden />,
              title: 'Verified payments',
              text: 'Wallet and card payments are confirmed by the server, not by the browser.',
            },
          ].map((f) => (
            <div key={f.title}>
              <span className="flex size-10 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{f.icon}</span>
              <p className="mt-3 font-semibold text-ink">{f.title}</p>
              <p className="mt-1 text-sm text-ink-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <div className="flex flex-col items-start justify-between gap-4 rounded-3xl bg-brand-50 p-6 sm:flex-row sm:items-center sm:p-8">
          <div>
            <p className="text-lg font-bold text-brand-900">Sell on BazarHQ</p>
            <p className="mt-1 text-sm text-brand-900/80">Open your own store with a subdomain, payments and order tracking in minutes.</p>
          </div>
          <Link
            href={p.merchantLogin}
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white hover:bg-navy-800"
          >
            Merchant portal <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </section>
    </main>
  );
}

/** Accepts a store name, a subdomain, or a pasted link like https://greenbasket.bazarhq.com/... */
export function normaliseStoreQuery(q: string): string {
  const t = q.trim();
  const host = t.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.bazarhq\.com/i)?.[1];
  if (host) return host.toLowerCase();
  const path = t.match(/\/store\/([a-z0-9-]+)/i)?.[1];
  return path ? path.toLowerCase() : t;
}

export function StoreSearch({ initial = '' }: { initial?: string }) {
  const services = useServices();
  const [q, setQ] = useState(initial);
  const dq = useDebounced(normaliseStoreQuery(q), 250);
  const results = useAsync(() => services.storefront.searchStores(dq), [dq]);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Find a store</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Search by store name or subdomain, or paste a store link. Results show stores — browse products inside each store.
      </p>
      <div className="relative mt-4">
        <label htmlFor="stores-q" className="sr-only">
          Search stores
        </label>
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <input
          id="stores-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="e.g. Green Basket or greenbasket"
          className="h-12 w-full rounded-xl border border-line-strong bg-white pl-10 pr-10 text-sm outline-none focus:border-brand-600 focus:ring-4 focus:ring-brand-100"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Clear search"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
      <section className="mt-5 space-y-2.5" aria-live="polite" aria-busy={results.loading}>
        {results.loading && !results.data ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-24 rounded-2xl" />)
        ) : results.error ? (
          <Alert tone="danger">{results.error}</Alert>
        ) : (results.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<StoreIcon className="size-6" aria-hidden />}
            title="No stores found"
            description="Check the spelling, or ask the store for its BazarHQ link."
          />
        ) : (
          <>
            <p className="text-[13px] text-ink-subtle">
              {results.data!.length} store{results.data!.length === 1 ? '' : 's'}
            </p>
            {results.data!.map((s) => (
              <StoreResultCard key={s.id} store={s} />
            ))}
          </>
        )}
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Order tracking                                                      */
/* ------------------------------------------------------------------ */

const FLOW: OrderStatus[] = ['pending', 'confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered'];

export function TrackingTimeline({
  status,
  events,
  cancellationReason,
}: {
  status: OrderStatus;
  events: { eventType: string; createdAt: string }[];
  cancellationReason?: string | null;
}) {
  const at = (s: string) => events.find((e) => e.eventType === s)?.createdAt;
  if (status === 'cancelled') {
    const lastReached = [...FLOW].reverse().find((s) => at(s)) ?? 'pending';
    const shown = FLOW.slice(0, FLOW.indexOf(lastReached) + 1);
    return (
      <ol className="space-y-0">
        {shown.map((s) => (
          <TimelineRow key={s} done label={ORDER_STATUS_LABEL[s]} at={at(s)} />
        ))}
        <TimelineRow done cancelled label="Cancelled" at={at('cancelled')} note={cancellationReason ? `Reason: ${cancellationReason}` : undefined} last />
      </ol>
    );
  }
  const idx = FLOW.indexOf(status);
  return (
    <ol>
      {FLOW.map((s, i) => (
        <TimelineRow key={s} done={i <= idx} current={i === idx} label={ORDER_STATUS_LABEL[s]} at={at(s)} last={i === FLOW.length - 1} />
      ))}
    </ol>
  );
}

function TimelineRow({
  done,
  current,
  cancelled,
  label,
  at,
  note,
  last,
}: {
  done?: boolean;
  current?: boolean;
  cancelled?: boolean;
  label: string;
  at?: string;
  note?: string;
  last?: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden className={cn('absolute left-[11px] top-6 h-[calc(100%-18px)] w-0.5', done ? 'bg-brand-500' : 'bg-line-strong')} />}
      <span
        aria-hidden
        className={cn(
          'relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full',
          cancelled ? 'bg-red-600 text-white' : done ? 'bg-brand-600 text-white' : 'border-2 border-line-strong bg-white text-transparent',
          current && 'ring-4 ring-brand-100',
        )}
      >
        {cancelled ? <X className="size-3.5" /> : done ? <Check className="size-3.5" /> : <Circle className="size-2" />}
      </span>
      <div className="min-w-0 pt-0.5">
        <p className={cn('text-sm', done ? 'font-semibold text-ink' : 'text-ink-subtle', cancelled && 'text-red-700')}>
          {label}
          {current && <span className="sr-only"> (current status)</span>}
        </p>
        {at && <p className="text-[12px] text-ink-subtle">{formatDateTime(at)}</p>}
        {note && <p className="mt-0.5 text-[13px] text-red-800">{note}</p>}
      </div>
    </li>
  );
}

export function TrackOrder({ initialOrderNumber = '' }: { initialOrderNumber?: string }) {
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [query, setQuery] = useState<{ orderNumber: string; phone: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const form = useZodForm(trackOrderSchema, { orderNumber: initialOrderNumber, phone: '' });

  const lookup = async (q: { orderNumber: string; phone: string }, silent = false) => {
    if (!silent) setBusy(true);
    try {
      const r = await services.storefront.trackOrder(q.orderNumber, q.phone);
      setResult(r);
      setQuery(q);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      if (!silent) {
        setResult(null);
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  // FR-C-26: live-ish updates. Production uses a Realtime channel scoped to this
  // order; the mock polls within the tracking rate limit.
  const live = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!query || result?.archived || result?.status === 'delivered' || result?.status === 'cancelled') return;
    live.current = setInterval(() => void lookup(query, true), 20_000);
    return () => {
      if (live.current) clearInterval(live.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, result?.status, result?.archived]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-bold text-ink">Track your order</h1>
      <p className="mt-1 text-sm text-ink-muted">Enter the Order ID from your SMS and the phone number used at checkout.</p>
      <Card className="mt-4 p-5">
        <form onSubmit={form.handleSubmit((v) => lookup(v))} noValidate className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr_auto] sm:items-start">
          <TextField
            label="Order ID"
            placeholder="ORD-20261020-BHQ000123"
            autoComplete="off"
            className="uppercase"
            {...form.register('orderNumber')}
            error={form.formState.errors.orderNumber?.message}
          />
          <TextField label="Phone number" inputMode="tel" placeholder="01XXXXXXXXX" {...form.register('phone')} error={form.formState.errors.phone?.message} />
          <Button type="submit" loading={busy} icon={<PackageSearch className="size-4" aria-hidden />} className="sm:mt-6">
            Track
          </Button>
        </form>
      </Card>

      {error && (
        <Alert tone="danger" className="mt-4" title="Order not found">
          {error}
        </Alert>
      )}

      {result && (
        <section className="mt-5 space-y-4" aria-live="polite">
          <Card className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Order</p>
                <p className="text-lg font-extrabold text-ink">{result.orderNumber}</p>
                <p className="text-[13px] text-ink-muted">
                  from{' '}
                  <Link href={p.store(result.storeSubdomain)} className="font-semibold text-brand-700 hover:underline">
                    {result.storeName}
                  </Link>{' '}
                  · placed {formatDate(result.createdAt)}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <OrderStatusBadge status={result.status} />
                <PaymentStatusBadge status={result.paymentStatus} />
              </div>
            </div>
            {result.archived ? (
              <Alert tone="info" className="mt-4" title="Tracking archived">
                This order was delivered more than 90 days ago, so live tracking is no longer available. Signed-in customers can still see it in their order
                history.
              </Alert>
            ) : (
              <div className="mt-5">
                <TrackingTimeline status={result.status} events={result.events} cancellationReason={result.cancellationReason} />
                {updatedAt && result.status !== 'delivered' && result.status !== 'cancelled' && (
                  <p className="mt-4 flex items-center gap-1.5 text-[12px] text-ink-subtle">
                    <Clock3 className="size-3.5" aria-hidden /> Updates automatically · last checked {updatedAt.toLocaleTimeString()}
                    <button type="button" onClick={() => query && lookup(query)} className="ml-1 inline-flex items-center gap-1 font-semibold text-brand-700">
                      <RefreshCw className="size-3" aria-hidden /> Refresh
                    </button>
                  </p>
                )}
              </div>
            )}
          </Card>
          {!result.archived && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Card className="p-5">
                <h2 className="text-sm font-bold text-ink">Items</h2>
                <ul className="mt-2 divide-y divide-line text-sm">
                  {result.items.map((i, idx) => (
                    <li key={idx} className="flex justify-between gap-3 py-2">
                      <span className="min-w-0">
                        {i.productName}
                        {i.variantLabel && <span className="text-ink-muted"> · {i.variantLabel}</span>} × {i.quantity}
                      </span>
                      <span className="tabular">{formatBDT(i.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="mt-2 space-y-1 border-t border-line pt-2 text-sm">
                  <Row label="Delivery">{formatBDT(result.deliveryCharge)}</Row>
                  <Row label="Total" strong>
                    {formatBDT(result.totalAmount)}
                  </Row>
                </dl>
              </Card>
              <Card className="space-y-4 p-5 text-sm">
                <div>
                  <h2 className="text-sm font-bold text-ink">Payment</h2>
                  <p className="mt-1 flex items-center gap-2 text-ink-muted">
                    <PaymentMethodMark method={result.paymentMethod} size={22} /> {PAYMENT_METHOD_LABEL[result.paymentMethod]}
                  </p>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-ink">Delivery address</h2>
                  <p className="mt-1 text-ink-muted">
                    {result.deliveryAddress.recipientName}
                    <br />
                    {result.deliveryAddress.address}, {result.deliveryAddress.district}
                  </p>
                </div>
                <div>
                  <h2 className="text-sm font-bold text-ink">Contact {result.storeName}</h2>
                  <ul className="mt-1 space-y-1 text-ink-muted">
                    {result.merchantContact.phone && (
                      <li className="flex items-center gap-2">
                        <Phone className="size-4" aria-hidden />
                        <a href={`tel:${result.merchantContact.phone}`} className="hover:text-ink">
                          {result.merchantContact.phone}
                        </a>
                      </li>
                    )}
                    {result.merchantContact.email && (
                      <li className="flex items-center gap-2">
                        <Mail className="size-4" aria-hidden />
                        <a href={`mailto:${result.merchantContact.email}`} className="break-all hover:text-ink">
                          {result.merchantContact.email}
                        </a>
                      </li>
                    )}
                  </ul>
                </div>
              </Card>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Row({ label, children, strong }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className={strong ? 'font-bold' : 'text-ink-muted'}>{label}</dt>
      <dd className={cn('tabular', strong && 'font-bold')}>{children}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Policies                                                            */
/* ------------------------------------------------------------------ */

export function PolicyView({ type }: { type: 'tos' | 'privacy' }) {
  const services = useServices();
  const policy = useAsync<Policy | null>(() => services.storefront.getPublishedPolicy(type), [type]);
  const title = type === 'tos' ? 'Terms of Service' : 'Privacy Policy';
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold text-ink">{title}</h1>
      {policy.loading ? (
        <Skeleton className="mt-6 h-64 w-full" />
      ) : !policy.data ? (
        <p className="mt-4 text-sm text-ink-muted">No published version yet.</p>
      ) : (
        <>
          <p className="mt-2 text-[13px] text-ink-subtle">
            Version {policy.data.version} · effective {formatDate(policy.data.effectiveDate)}
          </p>
          <article className="mt-6 whitespace-pre-line rounded-2xl border border-line bg-white p-6 text-[15px] leading-relaxed text-ink-muted">
            {policy.data.content}
          </article>
        </>
      )}
    </main>
  );
}
