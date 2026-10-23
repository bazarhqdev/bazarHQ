'use client';

/**
 * Product comparison list (FR-C-05 "comparison with other products"). Kept per
 * store — like the cart, products from different stores are never mixed — and
 * capped at 3 so the comparison stays readable on a phone. Stored on this
 * device only.
 */
import { useSyncExternalStore } from 'react';

export const COMPARE_LIMIT = 3;
const KEY = 'bazarhq.compare.v1';
type CompareMap = Record<string, string[]>;

let state: CompareMap = {};
let loaded = false;
const listeners = new Set<() => void>();

function load(): CompareMap {
  if (loaded) return state;
  loaded = true;
  try {
    state = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as CompareMap;
  } catch {
    state = {};
  }
  return state;
}

function commit(next: CompareMap) {
  state = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: list lives for this tab only */
  }
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const EMPTY: CompareMap = {};

export const compareStore = {
  ids: (storeId: string): string[] => load()[storeId] ?? [],
  has: (storeId: string, productId: string) => compareStore.ids(storeId).includes(productId),
  /** Adds or removes a product. Returns `full` when the list already holds the limit. */
  toggle(storeId: string, productId: string): 'added' | 'removed' | 'full' {
    const ids = compareStore.ids(storeId);
    if (ids.includes(productId)) {
      commit({ ...load(), [storeId]: ids.filter((x) => x !== productId) });
      return 'removed';
    }
    if (ids.length >= COMPARE_LIMIT) return 'full';
    commit({ ...load(), [storeId]: [...ids, productId] });
    return 'added';
  },
  remove(storeId: string, productId: string) {
    commit({ ...load(), [storeId]: compareStore.ids(storeId).filter((x) => x !== productId) });
  },
  clear(storeId: string) {
    const next = { ...load() };
    delete next[storeId];
    commit(next);
  },
};

const NONE: string[] = [];

export function useCompareIds(storeId: string | null | undefined): string[] {
  const map = useSyncExternalStore(
    subscribe,
    () => load(),
    () => EMPTY,
  );
  return storeId ? (map[storeId] ?? NONE) : NONE;
}
