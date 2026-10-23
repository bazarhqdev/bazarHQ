'use client';

/**
 * Store-scoped carts (FR-C-10/37). Carts are kept on the device only — browser
 * localStorage on the web, the WebView's storage on Android — and are never
 * server-persisted for guests. One cart per store; products from different
 * stores are never combined.
 */
import { useSyncExternalStore } from 'react';
import type { Cart, CartItem } from '@bazarhq/shared';

const KEY = 'bazarhq.carts.v1';
type CartMap = Record<string, Cart>;

let memory: CartMap = {};
let loaded = false;
let snapshot: CartMap = {};
const listeners = new Set<() => void>();

function load(): CartMap {
  if (loaded) return memory;
  loaded = true;
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as CartMap) : {};
  } catch {
    memory = {};
  }
  snapshot = memory;
  return memory;
}

function commit(next: CartMap) {
  memory = next;
  snapshot = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable (private mode): the cart lives for this tab only */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      loaded = false;
      load();
      cb();
    }
  };
  globalThis.addEventListener?.('storage', onStorage);
  return () => {
    listeners.delete(cb);
    globalThis.removeEventListener?.('storage', onStorage);
  };
}

const EMPTY: CartMap = {};
const getSnapshot = () => (load(), snapshot);
const getServerSnapshot = () => EMPTY;

const sameLine = (a: Pick<CartItem, 'productId' | 'variantId'>, b: Pick<CartItem, 'productId' | 'variantId'>) =>
  a.productId === b.productId && a.variantId === b.variantId;

export const cartStore = {
  all: (): Cart[] => Object.values(load()).filter((c) => c.items.length > 0),
  get: (storeId: string): Cart | null => load()[storeId] ?? null,
  /** Adds or increases a line, capped at `maxQuantity`. Returns the resulting quantity and whether it was capped. */
  add(store: { id: string; subdomain: string; name: string }, item: CartItem, maxQuantity: number): { quantity: number; capped: boolean } {
    const carts = { ...load() };
    const cart: Cart = carts[store.id]
      ? { ...carts[store.id]!, items: [...carts[store.id]!.items] }
      : { storeId: store.id, subdomain: store.subdomain, storeName: store.name, items: [], updatedAt: '' };
    const idx = cart.items.findIndex((i) => sameLine(i, item));
    const wanted = (idx >= 0 ? cart.items[idx]!.quantity : 0) + item.quantity;
    const quantity = Math.max(0, Math.min(wanted, maxQuantity));
    if (idx >= 0) cart.items[idx] = { ...cart.items[idx]!, quantity, unitPrice: item.unitPrice };
    else if (quantity > 0) cart.items.push({ ...item, quantity });
    cart.updatedAt = new Date().toISOString();
    carts[store.id] = cart;
    commit(carts);
    return { quantity, capped: quantity < wanted };
  },
  setQuantity(storeId: string, line: Pick<CartItem, 'productId' | 'variantId'>, quantity: number) {
    const carts = { ...load() };
    const cart = carts[storeId];
    if (!cart) return;
    carts[storeId] = {
      ...cart,
      items: quantity <= 0 ? cart.items.filter((i) => !sameLine(i, line)) : cart.items.map((i) => (sameLine(i, line) ? { ...i, quantity } : i)),
      updatedAt: new Date().toISOString(),
    };
    commit(carts);
  },
  /** Accepts the server's current prices (FR-C-12) after the customer has been told. */
  acceptPrice(storeId: string, line: Pick<CartItem, 'productId' | 'variantId'>, unitPrice: number) {
    const carts = { ...load() };
    const cart = carts[storeId];
    if (!cart) return;
    carts[storeId] = { ...cart, items: cart.items.map((i) => (sameLine(i, line) ? { ...i, unitPrice } : i)) };
    commit(carts);
  },
  remove(storeId: string, line: Pick<CartItem, 'productId' | 'variantId'>) {
    cartStore.setQuantity(storeId, line, 0);
  },
  clear(storeId: string) {
    const carts = { ...load() };
    delete carts[storeId];
    commit(carts);
  },
};

export function useCart(storeId: string | null | undefined): Cart | null {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return storeId ? (map[storeId] ?? null) : null;
}

export function useAllCarts(): Cart[] {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return Object.values(map).filter((c) => c.items.length > 0);
}

export function useCartCount(storeId?: string | null): number {
  const map = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const carts = storeId ? [map[storeId]].filter(Boolean) : Object.values(map);
  return carts.reduce((n, c) => n + (c?.items.reduce((s, i) => s + i.quantity, 0) ?? 0), 0);
}

/** Cart mutations are module-level and stable; this hook only reads well at call sites. */
export const useCartActions = () => cartStore;

/** Checkout drafts survive a session expiry (FR-C-22) — kept per store for this tab. */
export const checkoutDraft = {
  get<T>(storeId: string): T | null {
    try {
      const raw = globalThis.sessionStorage?.getItem(`bazarhq.checkout.${storeId}`);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  set(storeId: string, value: unknown) {
    try {
      globalThis.sessionStorage?.setItem(`bazarhq.checkout.${storeId}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  clear(storeId: string) {
    try {
      globalThis.sessionStorage?.removeItem(`bazarhq.checkout.${storeId}`);
    } catch {
      /* ignore */
    }
  },
};
