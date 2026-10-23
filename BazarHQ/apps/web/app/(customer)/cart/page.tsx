'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { formatBDT } from '@bazarhq/shared';
import { Card, EmptyState, ProductArt, useAllCarts } from '@bazarhq/ui';
import { customerPaths as p } from '@/lib/paths';

/** Carts are per store (FR-C-37): this page lists them; each store has its own cart and checkout. */
export default function CartsPage() {
  const carts = useAllCarts();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <title>Your carts · BazarHQ</title>
      <h1 className="text-2xl font-bold text-ink">Your carts</h1>
      <p className="mt-1 text-sm text-ink-muted">Each store has its own cart and checkout. Items from different stores are never combined.</p>
      {carts.length === 0 ? (
        <EmptyState
          className="mt-6"
          icon={<ShoppingBag className="size-6" aria-hidden />}
          title="No items yet"
          description="Find a store and start shopping."
          action={
            <Link href={p.stores()} className="text-sm font-semibold text-brand-700 hover:underline">
              Find a store
            </Link>
          }
        />
      ) : (
        <ul className="mt-5 space-y-3">
          {carts.map((c) => (
            <li key={c.storeId}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-ink">{c.storeName}</p>
                    <p className="text-[13px] text-ink-muted">
                      {c.items.reduce((s, i) => s + i.quantity, 0)} items · {formatBDT(c.items.reduce((s, i) => s + i.unitPrice * i.quantity, 0))}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={p.storeCart(c.subdomain)}
                      className="inline-flex h-9 items-center rounded-lg border border-line-strong px-3 text-sm font-semibold hover:bg-canvas"
                    >
                      View cart
                    </Link>
                    <Link
                      href={p.storeCheckout(c.subdomain)}
                      className="inline-flex h-9 items-center rounded-lg bg-navy-900 px-3 text-sm font-semibold text-white hover:bg-navy-800"
                    >
                      Checkout
                    </Link>
                  </div>
                </div>
                <ul className="mt-3 flex gap-2 overflow-x-auto">
                  {c.items.map((i) => (
                    <li key={`${i.productId}:${i.variantId}`} title={i.name}>
                      <ProductArt name={i.name} url={i.imageUrl} className="size-12" />
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
