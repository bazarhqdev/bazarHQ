'use client';

import { displayPrice, formatBDT, productPriceRange, type Product, type ProductVariant } from '@bazarhq/shared';
import { cn } from './cn';

/**
 * Base (selling) price with the optional regular price / MRP struck through
 * and the saving. Display only: checkout always charges the base price.
 */
export function PriceTag({
  product,
  variant,
  size = 'md',
  range = false,
  className,
}: {
  product: Pick<Product, 'basePrice' | 'extensions' | 'productType' | 'variants'>;
  variant?: Pick<ProductVariant, 'priceAdjustment'> | null;
  size?: 'sm' | 'md' | 'lg';
  /** Show "৳min – ৳max" for variant products when no variant is chosen. */
  range?: boolean;
  className?: string;
}) {
  const { price, original, percentOff } = displayPrice(product, variant);
  const [lo, hi] = productPriceRange(product);
  const showRange = range && !variant && lo !== hi;
  const main = { sm: 'text-sm', md: 'text-[15px]', lg: 'text-3xl font-extrabold' }[size];
  const sub = { sm: 'text-[12px]', md: 'text-[13px]', lg: 'text-base' }[size];
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5', className)}>
      <span className={cn('font-bold tabular text-ink', main)}>{showRange ? `${formatBDT(lo)} – ${formatBDT(hi)}` : formatBDT(showRange ? lo : price)}</span>
      {original !== null && !showRange && (
        <>
          <span className={cn('tabular text-ink-subtle line-through', sub)}>
            <span className="sr-only">Regular price </span>
            {formatBDT(original)}
          </span>
          <span className={cn('rounded-full bg-red-50 px-1.5 py-px font-bold text-red-700', size === 'lg' ? 'text-sm' : 'text-[11px]')}>{percentOff}% off</span>
        </>
      )}
      {original !== null && showRange && (
        <span className={cn('rounded-full bg-red-50 px-1.5 py-px text-[11px] font-bold text-red-700')}>Up to {percentOff}% off</span>
      )}
    </span>
  );
}
