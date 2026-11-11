'use client';

/**
 * Public storefront (SRS §11.1–11.2): store-scoped browsing, product detail
 * with zoom + compare, and the store chrome. Everything here is readable by
 * guests; nothing aggregates products across stores (FR-C-01/37).
 */
import { createContext, useContext, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  GitCompareArrows,
  Mail,
  Minus,
  PackageSearch,
  Phone,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store as StoreIcon,
  Truck,
  User,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  displayPrice,
  errorMessage,
  formatBDT,
  PAYMENT_METHOD_LABEL,
  productPriceRange,
  productSlug,
  productStockState,
  productTotalStock,
  sellableVariants,
  STORE_CATEGORY_LABEL,
  type Category,
  type Product,
  type ProductVariant,
  type StorefrontSort,
  type StorefrontStore,
} from '@bazarhq/shared';
import { cn } from '../../cn';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Modal,
  PaymentMethodMark,
  PriceTag,
  SearchInput,
  SelectField,
  Skeleton,
  Switch,
  useToast,
} from '../../components';
import { useAsync, useCustomerPaths, useDebounced, useNavigation, useServiceEvents, useServices, useSession } from '../../context';
import { ProductArt, StoreLogo } from './art';
import { cartStore, useCartCount } from './cart';
import { COMPARE_LIMIT, compareStore, useCompareIds } from './compare';

/* ------------------------------------------------------------------ */
/* Store context + chrome                                              */
/* ------------------------------------------------------------------ */

const StoreCtx = createContext<StorefrontStore | null>(null);

export function useStore(): StorefrontStore {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore must be used inside <StoreShell>');
  return s;
}

/** Chooses white or near-black text for a merchant brand colour (WCAG contrast). */
export function readableOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (L + 0.05) >= 4.5 ? '#ffffff' : '#0f1d2e';
}

export function storeStyle(store: Pick<StorefrontStore, 'brandColour' | 'themeAccent'>): CSSProperties {
  return {
    '--store': store.brandColour,
    '--store-ink': readableOn(store.brandColour),
    '--store-theme-accent': store.themeAccent ?? store.brandColour,
  } as CSSProperties;
}

function storeThemeKey(name: string | null): string {
  return (name ?? 'default').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'default';
}

export function StoreUnavailable({ message }: { message?: string }) {
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-navy-50 text-navy-700">
        <StoreIcon className="size-7" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-bold text-ink">Store unavailable</h1>
      <p className="mt-2 text-sm text-ink-muted">{message ?? 'This store is unavailable. Check the address or search for another store.'}</p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href={p.stores()} className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
          Find a store
        </Link>
        <Link
          href={p.track()}
          className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-white px-4 text-sm font-semibold text-ink hover:bg-canvas"
        >
          Track an order
        </Link>
      </div>
    </main>
  );
}

export function StoreShell({ subdomain, children }: { subdomain: string; children: ReactNode }) {
  const services = useServices();
  const state = useAsync(() => services.storefront.resolveStore(subdomain), [subdomain]);
  if (state.loading) {
    return (
      <div className="min-h-dvh bg-canvas" aria-busy>
        <div className="h-16 border-b border-line bg-white" />
        <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (state.error || !state.data) return <StoreUnavailable message={state.error ?? undefined} />;
  return (
    <StoreCtx.Provider value={state.data}>
      <div className="storefront-shell flex min-h-dvh flex-col bg-canvas" data-store-theme={storeThemeKey(state.data.themeName)} style={storeStyle(state.data)}>
        <StoreHeader />
        <div className="flex-1">{children}</div>
        <StoreFooter />
        <CompareTray />
      </div>
    </StoreCtx.Provider>
  );
}

function StoreHeader() {
  const store = useStore();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const count = useCartCount(store.id);
  const { session } = useSession();
  const [q, setQ] = useState('');
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4">
        <Link href={p.store(store.subdomain)} className="flex min-w-0 items-center gap-2.5">
          <StoreLogo name={store.name} url={store.logoUrl} colour={store.brandColour} size={36} />
          <span className="truncate text-[15px] font-bold text-ink">{store.name}</span>
        </Link>
        <form
          role="search"
          className="ml-auto hidden max-w-sm flex-1 md:block"
          onSubmit={(e) => {
            e.preventDefault();
            navigate(p.storeProducts(store.subdomain, q.trim() ? `q=${encodeURIComponent(q.trim())}` : undefined));
          }}
        >
          <label htmlFor="store-search" className="sr-only">
            Search {store.name}
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
            <input
              id="store-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${store.name}`}
              className="h-10 w-full rounded-full border border-line-strong bg-canvas pl-9 pr-4 text-sm outline-none focus:border-[var(--store)] focus:bg-white"
            />
          </div>
        </form>
        <nav aria-label="Store" className="ml-auto flex items-center gap-1 md:ml-2">
          <Link
            href={p.storeProducts(store.subdomain)}
            className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-canvas hover:text-ink sm:inline-flex"
          >
            Products
          </Link>
          <Link href={p.track()} className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-ink-muted hover:bg-canvas hover:text-ink sm:inline-flex">
            Track order
          </Link>
          <Link
            href={session?.user.role === 'customer' ? p.account : p.login()}
            aria-label={session?.user.role === 'customer' ? 'My account' : 'Sign in'}
            className="inline-flex size-10 items-center justify-center rounded-lg text-ink-muted hover:bg-canvas hover:text-ink"
          >
            <User className="size-5" aria-hidden />
          </Link>
          <Link
            href={p.storeCart(store.subdomain)}
            aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
            className="relative inline-flex size-10 items-center justify-center rounded-lg text-ink hover:bg-canvas"
          >
            <ShoppingCart className="size-5" aria-hidden />
            {count > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-[var(--store)] px-1 text-[11px] font-bold text-[var(--store-ink)]"
                aria-hidden
              >
                {count > 99 ? '99+' : count}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}

function StoreFooter() {
  const store = useStore();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  return (
    <footer className="mt-12 border-t border-line bg-white">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-10 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2.5">
            <StoreLogo name={store.name} url={store.logoUrl} colour={store.brandColour} size={32} />
            <p className="font-bold text-ink">{store.name}</p>
          </div>
          {store.tagline && <p className="mt-2 text-sm text-ink-muted">{store.tagline}</p>}
          <ul className="mt-3 space-y-1 text-sm text-ink-muted">
            {store.contact.phone && (
              <li className="flex items-center gap-2">
                <Phone className="size-4" aria-hidden />{' '}
                <a href={`tel:${store.contact.phone}`} className="hover:text-ink">
                  {store.contact.phone}
                </a>
              </li>
            )}
            {store.contact.email && (
              <li className="flex items-center gap-2">
                <Mail className="size-4" aria-hidden />{' '}
                <a href={`mailto:${store.contact.email}`} className="hover:text-ink">
                  {store.contact.email}
                </a>
              </li>
            )}
          </ul>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-ink">Shopping here</p>
          <ul className="mt-2 space-y-1.5 text-ink-muted">
            <li>
              Delivery in Dhaka {formatBDT(store.shipping.insideDhakaCharge)} · {store.shipping.estimatedDaysInsideDhaka} day
              {store.shipping.estimatedDaysInsideDhaka === 1 ? '' : 's'}
            </li>
            <li>
              Outside Dhaka {formatBDT(store.shipping.outsideDhakaCharge)} · {store.shipping.estimatedDaysOutsideDhaka} days
            </li>
            <li>{store.returnWindowDays}-day returns on delivered orders</li>
          </ul>
          <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Accepted payment methods">
            {store.enabledPaymentMethods.map((m) => (
              <span key={m} title={PAYMENT_METHOD_LABEL[m]}>
                <PaymentMethodMark method={m} size={28} />
              </span>
            ))}
          </div>
        </div>
        <div className="text-sm">
          <p className="font-semibold text-ink">Help</p>
          <ul className="mt-2 space-y-1.5">
            <li>
              <Link href={p.track()} className="text-ink-muted hover:text-ink">
                Track an order
              </Link>
            </li>
            <li>
              <Link href={p.support} className="text-ink-muted hover:text-ink">
                Get support
              </Link>
            </li>
            <li>
              <Link href={p.policy('tos')} className="text-ink-muted hover:text-ink">
                Terms of Service
              </Link>
            </li>
            <li>
              <Link href={p.policy('privacy')} className="text-ink-muted hover:text-ink">
                Privacy Policy
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <p className="border-t border-line py-4 text-center text-[12px] text-ink-subtle">
        Powered by{' '}
        <Link href={p.home} className="font-semibold text-navy-800 hover:underline">
          BazarHQ
        </Link>
      </p>
    </footer>
  );
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

function primaryImage(p: Product) {
  return (p.images.find((i) => i.isPrimary) ?? p.images[0])?.url ?? null;
}

export function ProductCard({ product, categoryName }: { product: Product; categoryName?: string | null }) {
  const store = useStore();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const toast = useToast();
  const stock = productStockState(product);
  const total = productTotalStock(product);
  const compareIds = useCompareIds(store.id);
  const comparing = compareIds.includes(product.id);
  const { percentOff } = displayPrice(product);
  return (
    <div className="storefront-product-card group relative flex w-full flex-col overflow-hidden border border-line bg-white transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <Link href={p.product(store.subdomain, productSlug(product))} className="flex flex-1 flex-col">
        <div className="relative aspect-square">
          <ProductArt
            name={product.name}
            url={primaryImage(product)}
            rounded="rounded-none"
            className={cn('h-full w-full', stock === 'out_of_stock' && 'opacity-60')}
          />
          {stock === 'out_of_stock' ? (
            <span className="absolute left-2 top-2 rounded-full bg-ink/85 px-2 py-0.5 text-[11px] font-semibold text-white">Sold out</span>
          ) : stock === 'low_stock' && total > 0 ? (
            <span className="absolute left-2 top-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Only {total} left</span>
          ) : percentOff !== null ? (
            <span className="absolute left-2 top-2 rounded-full bg-red-600 px-2 py-0.5 text-[11px] font-bold text-white">{percentOff}% off</span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col p-3">
          {categoryName && <p className="text-[11.5px] font-medium uppercase tracking-wide text-ink-subtle">{categoryName}</p>}
          <p className="mt-0.5 line-clamp-2 text-sm font-semibold text-ink group-hover:text-[var(--store)]">{product.name}</p>
          <PriceTag product={product} range className="mt-auto pt-2" />
        </div>
      </Link>
      <button
        type="button"
        aria-pressed={comparing}
        aria-label={comparing ? `Remove ${product.name} from compare` : `Add ${product.name} to compare`}
        title={comparing ? 'Remove from compare' : 'Compare'}
        onClick={() => {
          const r = compareStore.toggle(store.id, product.id);
          if (r === 'full') toast.info(`You can compare up to ${COMPARE_LIMIT} products`, 'Remove one from the compare bar first.');
        }}
        className={cn(
          'absolute right-2 top-2 inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 text-[11.5px] sm:px-2.5 font-semibold shadow-sm ring-1 transition',
          comparing ? 'bg-[var(--store)] text-[var(--store-ink)] ring-transparent' : 'bg-white/95 text-ink ring-line hover:bg-white',
        )}
      >
        {comparing ? <Check className="size-3.5" aria-hidden /> : <GitCompareArrows className="size-3.5" aria-hidden />}
        <span className="sr-only sm:not-sr-only">{comparing ? 'Comparing' : 'Compare'}</span>
      </button>
      <div className="storefront-product-actions px-3 pb-3">
        {product.productType === 'variant' ? (
          <Link
            href={p.product(store.subdomain, productSlug(product))}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-[var(--store)] px-3 text-sm font-bold text-[var(--store)] transition hover:bg-[var(--store)] hover:text-[var(--store-ink)]"
          >
            Choose options <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <button
            type="button"
            disabled={stock === 'out_of_stock' || total <= 0}
            onClick={() => {
              const result = cartStore.add(
                { id: store.id, subdomain: store.subdomain, name: store.name },
                {
                  productId: product.id,
                  slug: productSlug(product),
                  variantId: null,
                  name: product.name,
                  variantLabel: null,
                  imageUrl: primaryImage(product),
                  categoryName: categoryName ?? null,
                  unitPrice: product.basePrice,
                  quantity: 1,
                },
                total,
              );
              if (result.capped) toast.info('Stock limit', `Only ${total} available — your cart now has ${result.quantity}.`);
              else toast.success('Added to cart', `${product.name} added to your cart.`);
            }}
            className="storefront-add-button inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--store)] px-3 text-sm font-bold text-[var(--store-ink)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ShoppingCart className="size-4" aria-hidden />
            {stock === 'out_of_stock' || total <= 0 ? 'Sold out' : 'Add to cart'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Sticky bar listing the products picked for comparison in this store. */
export function CompareTray() {
  const store = useStore();
  const services = useServices();
  const ids = useCompareIds(store.id);
  const { platform } = useNavigation();
  const [open, setOpen] = useState(false);
  const items = useAsync(() => Promise.all(ids.map((id) => services.storefront.getProduct(store.id, id).catch(() => null))), [store.id, ids.join(',')]);
  if (ids.length === 0) return null;
  const list = (items.data ?? []).filter((x): x is NonNullable<typeof x> => Boolean(x));
  return (
    <>
      <div className="h-20" aria-hidden />
      <section
        aria-label="Compare products"
        className={cn(
          'fixed inset-x-0 z-30 border-t border-line bg-white/95 shadow-[0_-8px_24px_-12px_rgb(15_29_46/0.25)] backdrop-blur',
          // Sits above the Android tab bar; on the web it docks to the bottom edge.
          platform === 'mobile' ? 'bottom-[calc(64px+env(safe-area-inset-bottom))]' : 'bottom-0',
        )}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <GitCompareArrows className="hidden size-5 text-[var(--store)] sm:block" aria-hidden />
          <ul className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
            {list.map((v) => (
              <li key={v.product.id} className="flex shrink-0 items-center gap-2 rounded-xl border border-line bg-white py-1 pl-1 pr-2">
                <ProductArt name={v.product.name} url={primaryImage(v.product)} className="size-9" />
                <span className="hidden max-w-32 truncate text-[12.5px] font-semibold sm:inline">{v.product.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${v.product.name}`}
                  onClick={() => compareStore.remove(store.id, v.product.id)}
                  className="rounded p-0.5 text-ink-subtle hover:text-red-700"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
            {Array.from({ length: COMPARE_LIMIT - ids.length }, (_, i) => (
              <li key={`slot-${i}`} className="hidden size-11 shrink-0 rounded-xl border border-dashed border-line-strong sm:block" aria-hidden />
            ))}
          </ul>
          <button
            type="button"
            onClick={() => compareStore.clear(store.id)}
            className="hidden text-[13px] font-semibold text-ink-subtle hover:text-ink sm:inline"
          >
            Clear
          </button>
          <button
            type="button"
            disabled={ids.length < 2}
            onClick={() => setOpen(true)}
            className="inline-flex h-10 shrink-0 items-center rounded-full bg-[var(--store)] px-4 text-sm font-bold text-[var(--store-ink)] disabled:cursor-not-allowed disabled:opacity-50"
            title={ids.length < 2 ? 'Pick at least 2 products' : undefined}
          >
            Compare ({ids.length})
          </button>
        </div>
      </section>
      <CompareModal open={open} onClose={() => setOpen(false)} ids={ids} onRemove={(id) => compareStore.remove(store.id, id)} />
    </>
  );
}

export function ProductGrid({ products, categories, loading }: { products: Product[]; categories?: Category[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4" aria-busy>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] rounded-2xl" />
        ))}
      </div>
    );
  }
  const name = (id: string | null) => categories?.find((c) => c.id === id)?.name ?? null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <li key={p.id} className="flex">
          <div className="flex w-full">
            <ProductCard product={p} categoryName={name(p.categoryId)} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Store home (FR-C-03)                                                */
/* ------------------------------------------------------------------ */

export function StoreHome() {
  const store = useStore();
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const cats = useAsync(() => services.storefront.listCategories(store.id), [store.id]);
  const popular = useAsync(() => services.storefront.listProducts(store.id, { sort: 'popular' }), [store.id]);
  const newest = useAsync(() => services.storefront.listProducts(store.id, { sort: 'newest' }), [store.id]);
  useServiceEvents(() => void popular.reload());

  return (
    <main>
      <section className="storefront-hero relative overflow-hidden bg-[var(--store)] text-[var(--store-ink)]">
        <div
          className="absolute inset-0 opacity-[0.12]"
          aria-hidden
          style={{
            backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0 2px, transparent 3px), radial-gradient(circle at 70% 60%, #fff 0 2px, transparent 3px)',
            backgroundSize: '42px 42px',
          }}
        />
        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-4 py-12 md:grid-cols-[1.2fr_1fr] md:py-16">
          <div>
            {store.category && <p className="text-[12px] font-semibold uppercase tracking-[0.14em] opacity-80">{STORE_CATEGORY_LABEL[store.category]}</p>}
            <h1 className="storefront-hero-title mt-2 text-3xl font-extrabold leading-tight sm:text-4xl">{store.name}</h1>
            {store.tagline && <p className="mt-3 max-w-md text-base opacity-90">{store.tagline}</p>}
            <div className="mt-6 flex flex-wrap gap-2">
              <Link
                href={p.storeProducts(store.subdomain)}
                className="storefront-hero-cta inline-flex h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-bold text-ink shadow-sm hover:bg-white/90"
              >
                Shop all products <ChevronRight className="size-4" aria-hidden />
              </Link>
              <Link
                href={p.track()}
                className="inline-flex h-11 items-center rounded-full border border-current/40 px-5 text-sm font-semibold hover:bg-white/10"
              >
                Track an order
              </Link>
            </div>
          </div>
          <div className="hidden grid-cols-3 gap-3 md:grid" aria-hidden>
            {(popular.data ?? []).slice(0, 6).map((prod, i) => (
              <div key={prod.id} className={cn('overflow-hidden rounded-2xl ring-4 ring-white/25', i % 2 ? 'translate-y-4' : '')}>
                <ProductArt name={prod.name} url={primaryImage(prod)} rounded="rounded-2xl" className="aspect-square w-full" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-white">
        <ul className="mx-auto grid max-w-6xl grid-cols-1 gap-3 px-4 py-4 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2.5 text-ink-muted">
            <Truck className="size-5 text-[var(--store)]" aria-hidden /> Delivery across all 64 districts
          </li>
          <li className="flex items-center gap-2.5 text-ink-muted">
            <RotateCcw className="size-5 text-[var(--store)]" aria-hidden /> {store.returnWindowDays}-day returns
          </li>
          <li className="flex items-center gap-2.5 text-ink-muted">
            <ShieldCheck className="size-5 text-[var(--store)]" aria-hidden /> Payments verified by the server
          </li>
        </ul>
      </section>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-8">
        {(cats.data?.length ?? 0) > 0 && (
          <section aria-labelledby="cats">
            <h2 id="cats" className="text-lg font-bold text-ink">
              Shop by category
            </h2>
            <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {cats.data!.map((c) => (
                <li key={c.id} className="shrink-0">
                  <Link
                    href={p.storeProducts(store.subdomain, `category=${c.id}`)}
                    className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong bg-white px-4 text-sm font-semibold text-ink hover:border-[var(--store)]"
                  >
                    {c.name}
                    <span className="text-[12px] font-medium text-ink-subtle">{c.productCount}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="popular">
          <div className="flex items-end justify-between">
            <h2 id="popular" className="text-lg font-bold text-ink">
              Popular right now
            </h2>
            <Link href={p.storeProducts(store.subdomain, 'sort=popular')} className="text-sm font-semibold text-[var(--store)] hover:underline">
              See all
            </Link>
          </div>
          <div className="mt-3">
            {popular.error ? (
              <ErrorState message={popular.error} onRetry={popular.reload} />
            ) : (
              <ProductGrid products={(popular.data ?? []).slice(0, 8)} categories={cats.data} loading={popular.loading} />
            )}
          </div>
        </section>
        {(newest.data?.length ?? 0) > 4 && (
          <section aria-labelledby="new">
            <h2 id="new" className="text-lg font-bold text-ink">
              New arrivals
            </h2>
            <div className="mt-3">
              <ProductGrid products={newest.data!.slice(0, 4)} categories={cats.data} />
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Listing with search + filters (FR-C-04)                             */
/* ------------------------------------------------------------------ */

export function ProductListing({ initial }: { initial?: { q?: string; category?: string; sort?: StorefrontSort } }) {
  const store = useStore();
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const [q, setQ] = useState(initial?.q ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'all');
  const [sort, setSort] = useState<StorefrontSort>(initial?.sort ?? 'popular');
  const [inStock, setInStock] = useState(false);
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const dq = useDebounced(q, 250);
  const dmin = useDebounced(min, 400);
  const dmax = useDebounced(max, 400);
  const cats = useAsync(() => services.storefront.listCategories(store.id), [store.id]);
  const products = useAsync(
    () =>
      services.storefront.listProducts(store.id, {
        search: dq,
        categoryId: category,
        sort,
        inStockOnly: inStock,
        minPrice: dmin ? Number(dmin) : undefined,
        maxPrice: dmax ? Number(dmax) : undefined,
      }),
    [store.id, dq, category, sort, inStock, dmin, dmax],
  );
  const filtered = Boolean(dq || category !== 'all' || inStock || dmin || dmax);
  const reset = () => {
    setQ('');
    setCategory('all');
    setInStock(false);
    setMin('');
    setMax('');
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="text-[13px] text-ink-subtle">
        <Link href={p.store(store.subdomain)} className="hover:text-ink">
          {store.name}
        </Link>{' '}
        / <span className="text-ink">Products</span>
      </nav>
      <h1 className="mt-1 text-2xl font-bold text-ink">All products</h1>
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start" aria-label="Filters">
          <SearchInput value={q} onChange={setQ} placeholder="Search this store" label="Search products" />
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-sm font-semibold text-ink">Category</p>
            <ul className="mt-2 space-y-0.5 text-sm">
              {[{ id: 'all', name: 'All categories', productCount: undefined as number | undefined }, ...(cats.data ?? [])].map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setCategory(c.id)}
                    aria-pressed={category === c.id}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left',
                      category === c.id ? 'bg-canvas font-semibold text-ink' : 'text-ink-muted hover:bg-canvas',
                    )}
                  >
                    {c.name}
                    {c.productCount !== undefined && <span className="text-[12px] text-ink-subtle">{c.productCount}</span>}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm font-semibold text-ink">Price (৳)</p>
            <div className="mt-2 flex items-center gap-2">
              <label className="sr-only" htmlFor="min-price">
                Minimum price
              </label>
              <input
                id="min-price"
                inputMode="numeric"
                value={min}
                onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))}
                placeholder="Min"
                className="h-9 w-full min-w-0 rounded-lg border border-line-strong px-2 text-sm"
              />
              <span className="text-ink-subtle">–</span>
              <label className="sr-only" htmlFor="max-price">
                Maximum price
              </label>
              <input
                id="max-price"
                inputMode="numeric"
                value={max}
                onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))}
                placeholder="Max"
                className="h-9 w-full min-w-0 rounded-lg border border-line-strong px-2 text-sm"
              />
            </div>
            <div className="mt-4">
              <Switch checked={inStock} onChange={setInStock} label="In stock only" />
            </div>
          </div>
        </aside>
        <section aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink-muted">
              {products.loading ? 'Loading…' : `${products.data?.length ?? 0} product${products.data?.length === 1 ? '' : 's'}`}
            </p>
            <SelectField
              aria-label="Sort products"
              value={sort}
              onChange={(e) => setSort(e.target.value as StorefrontSort)}
              containerClassName="w-48"
              options={[
                { value: 'popular', label: 'Most popular' },
                { value: 'newest', label: 'Newest' },
                { value: 'price_asc', label: 'Price: low to high' },
                { value: 'price_desc', label: 'Price: high to low' },
              ]}
            />
          </div>
          {products.error ? (
            <ErrorState message={products.error} onRetry={products.reload} />
          ) : !products.loading && (products.data?.length ?? 0) === 0 ? (
            <EmptyState
              icon={<PackageSearch className="size-6" aria-hidden />}
              title="No products found"
              description={filtered ? 'Try a different search or clear the filters to browse everything in this store.' : 'This store has no products yet.'}
              action={
                filtered ? (
                  <Button variant="secondary" onClick={reset}>
                    Browse all products
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ProductGrid products={products.data ?? []} categories={cats.data} loading={products.loading} />
          )}
        </section>
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Product detail (FR-C-05/06/07): gallery + zoom, variants, compare   */
/* ------------------------------------------------------------------ */

export function ProductDetail({ productSlug: key }: { productSlug: string }) {
  const store = useStore();
  const services = useServices();
  const toast = useToast();
  const { Link, navigate } = useNavigation();
  const p = useCustomerPaths();
  const view = useAsync(() => services.storefront.getProduct(store.id, key), [store.id, key]);
  useServiceEvents(() => void view.reload());
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [imageIdx, setImageIdx] = useState(0);
  const [zoom, setZoom] = useState(false);
  const compareIds = useCompareIds(store.id);
  const cartQty = useCartCount(store.id);

  const product = view.data?.product;
  const variants = useMemo(() => product?.variants ?? [], [product]);
  const sellable = useMemo(() => (product ? sellableVariants(product) : []), [product]);
  // Preselect the first in-stock option so price and stock are always concrete.
  const variant: ProductVariant | null = variants.find((v) => v.id === (variantId ?? sellable[0]?.id)) ?? null;

  if (view.loading) {
    return (
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-8 md:grid-cols-2">
        <Skeleton className="aspect-square rounded-3xl" />
        <div className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </main>
    );
  }
  if (view.error || !product) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-12">
        <EmptyState
          icon={<PackageSearch className="size-6" aria-hidden />}
          title="Product not available"
          description={view.error ?? 'This product is no longer available in this store.'}
          action={
            <Link href={p.storeProducts(store.subdomain)} className="text-sm font-semibold text-[var(--store)] hover:underline">
              Browse products
            </Link>
          }
        />
      </main>
    );
  }

  const isVariant = product.productType === 'variant';
  const price = product.basePrice + (variant?.priceAdjustment ?? 0);
  const available = isVariant ? (variant && variant.status === 'active' ? variant.stockQuantity : 0) : (product.stockQuantity ?? 0);
  const soldOut = isVariant ? sellable.length === 0 : available <= 0;
  const images = product.images.length ? [...product.images].sort((a, b) => a.displayOrder - b.displayOrder) : [null];
  const current = images[Math.min(imageIdx, images.length - 1)];
  const inCompare = compareIds.includes(product.id);

  const add = (goToCart: boolean) => {
    if (soldOut || available <= 0) return;
    const res = cartStore.add(
      { id: store.id, subdomain: store.subdomain, name: store.name },
      {
        productId: product.id,
        slug: productSlug(product),
        variantId: variant?.id ?? null,
        name: product.name,
        variantLabel: variant?.variantLabel ?? null,
        imageUrl: current?.url ?? null,
        categoryName: view.data!.categoryName,
        unitPrice: price,
        quantity: qty,
      },
      available,
    );
    if (res.capped) toast.info('Quantity adjusted', `Only ${available} available — your cart now has ${res.quantity}.`);
    else toast.success('Added to cart', `${product.name}${variant ? ` (${variant.variantLabel})` : ''} × ${qty}`);
    setQty(1);
    if (goToCart) navigate(p.storeCart(store.subdomain));
  };

  const toggleCompare = () => {
    const r = compareStore.toggle(store.id, product.id);
    if (r === 'full') toast.info(`You can compare up to ${COMPARE_LIMIT} products`, 'Remove one from the compare bar first.');
    else if (r === 'added')
      toast.info(
        'Added to compare',
        compareIds.length >= 1 ? `Comparing ${compareIds.length + 1} products — use the compare bar.` : 'Add another product from this store to compare.',
      );
  };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[13px] text-ink-subtle">
        <Link href={p.storeProducts(store.subdomain)} className="inline-flex items-center gap-1 hover:text-ink">
          <ArrowLeft className="size-3.5" aria-hidden /> Products
        </Link>
        {view.data!.categoryName && <span>/ {view.data!.categoryName}</span>}
      </nav>
      <div className="mt-3 grid grid-cols-1 gap-8 md:grid-cols-2">
        <section aria-label="Product images">
          <button
            type="button"
            onClick={() => setZoom(true)}
            className="group relative block w-full overflow-hidden rounded-3xl border border-line bg-white"
            aria-label="Zoom image"
          >
            <ProductArt
              name={product.name}
              url={current?.url}
              rounded="rounded-3xl"
              className="aspect-square w-full transition duration-300 group-hover:scale-[1.03]"
            />
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-ink shadow-sm">
              <ZoomIn className="size-3.5" aria-hidden /> Zoom
            </span>
          </button>
          {images.length > 1 && (
            <ul className="mt-3 flex gap-2">
              {images.map((img, i) => (
                <li key={img?.id ?? i}>
                  <button
                    type="button"
                    onClick={() => setImageIdx(i)}
                    aria-label={`Image ${i + 1}`}
                    aria-pressed={i === imageIdx}
                    className={cn('block size-16 overflow-hidden rounded-xl border-2', i === imageIdx ? 'border-[var(--store)]' : 'border-transparent')}
                  >
                    <ProductArt name={product.name} url={img?.url} className="h-full w-full" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="pname">
          {view.data!.categoryName && <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">{view.data!.categoryName}</p>}
          <h1 id="pname" className="mt-1 text-2xl font-bold text-ink sm:text-3xl">
            {product.name}
          </h1>
          <p className="mt-3" aria-live="polite">
            <PriceTag product={product} variant={variant} size="lg" />
          </p>
          {displayPrice(product, variant).original !== null && (
            <p className="mt-1 text-[13px] font-semibold text-red-700">You save {formatBDT(displayPrice(product, variant).original! - price)}</p>
          )}
          <div className="mt-2" aria-live="polite">
            {soldOut ? (
              <Badge tone="danger">Out of stock</Badge>
            ) : available > 0 && available < 5 ? (
              <Badge tone="warning">Only {available} left in stock</Badge>
            ) : available > 0 ? (
              <Badge tone="success">In stock</Badge>
            ) : (
              <Badge tone="danger">This option is sold out</Badge>
            )}
          </div>

          {isVariant && (
            <fieldset className="mt-5">
              <legend className="text-sm font-semibold text-ink">Choose an option</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {variants.map((v) => {
                  const out = v.status !== 'active' || v.stockQuantity <= 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled={out}
                      aria-pressed={variant?.id === v.id}
                      onClick={() => {
                        setVariantId(v.id);
                        setQty(1);
                      }}
                      className={cn(
                        'min-w-14 rounded-xl border px-3 py-2 text-sm font-semibold transition',
                        variant?.id === v.id
                          ? 'border-[var(--store)] bg-[var(--store)] text-[var(--store-ink)]'
                          : 'border-line-strong bg-white text-ink hover:border-ink-subtle',
                        out && 'cursor-not-allowed border-dashed bg-canvas text-ink-subtle line-through hover:border-line-strong',
                      )}
                    >
                      {v.variantLabel}
                      {out && <span className="sr-only"> (sold out)</span>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <div className="inline-flex h-11 items-center rounded-xl border border-line-strong bg-white">
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={qty <= 1}
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="flex size-11 items-center justify-center text-ink disabled:text-ink-subtle"
              >
                <Minus className="size-4" aria-hidden />
              </button>
              <span className="w-8 text-center text-sm font-bold tabular" aria-live="polite" aria-label={`Quantity ${qty}`}>
                {qty}
              </span>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={soldOut || qty >= available}
                onClick={() => {
                  if (qty >= available) toast.info('Stock limit', `Only ${available} available.`);
                  else setQty((q) => q + 1);
                }}
                className="flex size-11 items-center justify-center text-ink disabled:text-ink-subtle"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            <button
              type="button"
              disabled={soldOut || available <= 0}
              onClick={() => add(false)}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--store)] px-5 text-sm font-bold text-[var(--store-ink)] hover:brightness-95 disabled:cursor-not-allowed disabled:bg-line-strong disabled:text-ink-subtle sm:flex-none"
            >
              <ShoppingCart className="size-4" aria-hidden /> Add to cart
            </button>
            <Button variant="secondary" size="lg" disabled={soldOut || available <= 0} onClick={() => add(true)}>
              Buy now
            </Button>
          </div>
          {cartQty > 0 && (
            <p className="mt-2 text-[13px] text-ink-muted">
              {cartQty} item{cartQty === 1 ? '' : 's'} in your {store.name} cart ·{' '}
              <Link href={p.storeCart(store.subdomain)} className="font-semibold text-[var(--store)] hover:underline">
                View cart
              </Link>
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon={inCompare ? <Check className="size-4" aria-hidden /> : <GitCompareArrows className="size-4" aria-hidden />}
              onClick={toggleCompare}
              aria-pressed={inCompare}
            >
              {inCompare ? 'In compare list' : 'Compare'}
            </Button>
          </div>

          <div className="mt-6 rounded-2xl border border-line bg-white p-4">
            <h2 className="text-sm font-semibold text-ink">Description</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-muted">{product.description || 'No description provided.'}</p>
          </div>
          <ul className="mt-4 grid grid-cols-1 gap-2 text-[13px] text-ink-muted sm:grid-cols-2">
            <li className="flex items-center gap-2">
              <Truck className="size-4 text-[var(--store)]" aria-hidden /> Dhaka {formatBDT(store.shipping.insideDhakaCharge)} · outside{' '}
              {formatBDT(store.shipping.outsideDhakaCharge)}
            </li>
            <li className="flex items-center gap-2">
              <RotateCcw className="size-4 text-[var(--store)]" aria-hidden /> {store.returnWindowDays}-day returns after delivery
            </li>
          </ul>
        </section>
      </div>

      {view.data!.related.length > 0 && (
        <section className="mt-12" aria-labelledby="related">
          <h2 id="related" className="text-lg font-bold text-ink">
            More from {store.name}
          </h2>
          <div className="mt-3">
            <ProductGrid products={view.data!.related.slice(0, 4)} />
          </div>
        </section>
      )}

      <Modal open={zoom} onClose={() => setZoom(false)} title={product.name} size="lg">
        <ZoomImage name={product.name} url={current?.url ?? null} />
      </Modal>
    </main>
  );
}

/** Pointer-follow zoom (2.2×) with a keyboard-friendly fallback (the modal itself is the larger view). */
function ZoomImage({ name, url }: { name: string; url: string | null }) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  return (
    <div
      className="relative aspect-square w-full cursor-zoom-in overflow-hidden rounded-2xl bg-canvas"
      onPointerMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setOrigin({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
      }}
      onPointerLeave={() => setOrigin(null)}
    >
      <ProductArt
        name={name}
        url={url}
        rounded="rounded-2xl"
        className="h-full w-full transition-transform duration-150"
        style={origin ? { transform: 'scale(2.2)', transformOrigin: `${origin.x}% ${origin.y}%` } : undefined}
      />
      <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-2.5 py-1 text-[12px] text-ink-muted">
        Move over the image to zoom
      </p>
    </div>
  );
}

function CompareModal({ open, onClose, ids, onRemove }: { open: boolean; onClose: () => void; ids: string[]; onRemove: (id: string) => void }) {
  const store = useStore();
  const services = useServices();
  const { Link } = useNavigation();
  const p = useCustomerPaths();
  const state = useAsync(
    async () => (open ? Promise.all(ids.map((id) => services.storefront.getProduct(store.id, id).catch(() => null))) : []),
    [open, ids.join(','), store.id],
  );
  const items = (state.data ?? []).filter((x): x is NonNullable<typeof x> => Boolean(x));
  const lowest = items.length ? Math.min(...items.map((v) => productPriceRange(v.product)[0])) : 0;
  const rows: [string, (v: (typeof items)[number]) => ReactNode][] = [
    [
      'Price',
      (v) => (
        <span className="flex flex-col items-start gap-1">
          <PriceTag product={v.product} range size="sm" />
          {items.length > 1 && productPriceRange(v.product)[0] === lowest && <Badge tone="success">Lowest price</Badge>}
        </span>
      ),
    ],
    [
      'You save',
      (v) => {
        const d = displayPrice(v.product);
        return d.original !== null ? <span className="font-semibold text-red-700">{formatBDT(d.original - d.price)}</span> : '—';
      },
    ],
    ['Category', (v) => v.categoryName ?? '—'],
    ['Availability', (v) => (productStockState(v.product) === 'out_of_stock' ? 'Sold out' : `${productTotalStock(v.product)} in stock`)],
    [
      'Options',
      (v) =>
        v.product.productType === 'variant'
          ? v.product.variants
              .filter((x) => x.status === 'active')
              .map((x) => x.variantLabel)
              .join(', ')
          : 'Single option',
    ],
    ['Description', (v) => <span className="line-clamp-4">{v.product.description}</span>],
    [
      '',
      (v) => (
        <Link
          href={p.product(store.subdomain, productSlug(v.product))}
          className="inline-flex h-9 items-center rounded-lg bg-[var(--store)] px-3 text-[13px] font-bold text-[var(--store-ink)]"
        >
          {productStockState(v.product) === 'out_of_stock' ? 'View' : 'View & buy'}
        </Link>
      ),
    ],
  ];
  return (
    <Modal open={open} onClose={onClose} title="Compare products" description={`Up to ${COMPARE_LIMIT} products from ${store.name}, side by side.`} size="lg">
      {/* The modal renders outside the store shell, so carry the store's brand colours in. */}
      <div style={storeStyle(store)}>
        {state.loading ? (
          <Skeleton className="h-48 w-full" />
        ) : state.error ? (
          <p className="text-sm text-red-700">{errorMessage(state.error)}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr>
                  <th scope="col" className="w-28" />
                  {items.map((v) => (
                    <th key={v.product.id} scope="col" className="p-2 text-left align-top">
                      <ProductArt name={v.product.name} url={v.product.images[0]?.url} className="aspect-square w-full max-w-28" />
                      <Link href={p.product(store.subdomain, productSlug(v.product))} className="mt-2 block font-semibold text-ink hover:text-[var(--store)]">
                        {v.product.name}
                      </Link>
                      <button
                        type="button"
                        onClick={() => onRemove(v.product.id)}
                        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-ink-subtle hover:text-red-700"
                      >
                        <X className="size-3" aria-hidden /> Remove
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(([label, cell]) => (
                  <tr key={label}>
                    <th scope="row" className="p-2 text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
                      {label}
                    </th>
                    {items.map((v) => (
                      <td key={v.product.id} className="p-2 align-top text-ink-muted">
                        {cell(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
