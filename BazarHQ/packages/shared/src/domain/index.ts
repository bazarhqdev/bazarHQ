/** Stock model (FR-M-15/18/21, DB-08) and onboarding checklist (FR-M-11) helpers. */
import type { InventoryRow, OnboardingProgress, PaymentConfig, Product, ProductVariant, StockState, Store } from '../types';

/* ------------------------------ Stock ------------------------------- */

export function stockState(quantity: number, threshold: number): StockState {
  if (quantity <= 0) return 'out_of_stock';
  if (quantity <= threshold) return 'low_stock';
  return 'in_stock';
}

export function sellableVariants(product: Pick<Product, 'variants'>): ProductVariant[] {
  return product.variants.filter((v) => v.status === 'active');
}

/** Total units across the authoritative stock owner(s) — display only. */
export function productTotalStock(product: Pick<Product, 'productType' | 'stockQuantity' | 'variants'>): number {
  if (product.productType === 'simple') return product.stockQuantity ?? 0;
  return product.variants.reduce((sum, v) => sum + (v.status === 'active' ? v.stockQuantity : 0), 0);
}

/**
 * FR-M-21: simple products compare products.stock_quantity with the threshold;
 * variant products are flagged if ANY sellable variant is at/below threshold.
 * FR-M-18: a variant product is out of stock only when every sellable variant is.
 */
export function productStockState(product: Pick<Product, 'productType' | 'stockQuantity' | 'variants' | 'lowStockThreshold'>): StockState {
  if (product.productType === 'simple') {
    return stockState(product.stockQuantity ?? 0, product.lowStockThreshold);
  }
  const variants = sellableVariants(product);
  if (variants.length === 0 || variants.every((v) => v.stockQuantity <= 0)) return 'out_of_stock';
  if (variants.some((v) => v.stockQuantity <= product.lowStockThreshold)) return 'low_stock';
  return 'in_stock';
}

export function productPriceRange(product: Pick<Product, 'productType' | 'basePrice' | 'variants'>): [number, number] {
  if (product.productType === 'simple' || product.variants.length === 0) {
    return [product.basePrice, product.basePrice];
  }
  const prices = product.variants.map((v) => product.basePrice + v.priceAdjustment);
  return [Math.min(...prices), Math.max(...prices)];
}

export function inventoryRowsForProduct(product: Product, categoryName: string | null): InventoryRow[] {
  const primary = product.images.find((i) => i.isPrimary) ?? product.images[0];
  const base = {
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    categoryName,
    productStatus: product.status,
    lowStockThreshold: product.lowStockThreshold,
    imageUrl: primary?.url ?? null,
  };
  if (product.productType === 'simple') {
    const qty = product.stockQuantity ?? 0;
    return [{ ...base, variantId: null, variantLabel: null, stockQuantity: qty, state: stockState(qty, product.lowStockThreshold) }];
  }
  return product.variants.map((v) => ({
    ...base,
    variantId: v.id,
    variantLabel: v.variantLabel,
    stockQuantity: v.stockQuantity,
    state: stockState(v.stockQuantity, product.lowStockThreshold),
  }));
}

/* ----------------------------- Onboarding --------------------------- */

/** FR-M-11 checklist: subdomain, logo, payment method, first product. */
export function computeOnboarding(store: Store | null, paymentConfigs: Pick<PaymentConfig, 'isEnabled'>[], productCount: number): OnboardingProgress {
  const anyPayment = paymentConfigs.some((c) => c.isEnabled);
  const steps = [
    { key: 'subdomain' as const, label: 'Choose your store address', done: Boolean(store?.subdomain) },
    { key: 'logo' as const, label: 'Upload a store logo', done: Boolean(store?.logoUrl) },
    { key: 'payment_method' as const, label: 'Enable a payment method', done: anyPayment },
    { key: 'first_product' as const, label: 'Add your first product', done: productCount > 0 },
  ];
  const done = steps.filter((s) => s.done).length;
  const percent = Math.round((done / steps.length) * 100);
  return { steps, percent, publishable: percent === 100 && anyPayment };
}

/**
 * Price shown to customers for a product (or one variant): the base price plus
 * the variant adjustment, and — when the merchant set an original/asking price
 * above it — that price with the same adjustment and the percentage saved.
 */
export function displayPrice(
  product: Pick<Product, 'basePrice' | 'extensions'>,
  variant?: Pick<ProductVariant, 'priceAdjustment'> | null,
): { price: number; original: number | null; percentOff: number | null } {
  const adj = variant?.priceAdjustment ?? 0;
  const price = product.basePrice + adj;
  const cmp = product.extensions?.compareAtPrice ?? null;
  if (cmp === null || cmp + adj <= price) return { price, original: null, percentOff: null };
  const original = cmp + adj;
  return { price, original, percentOff: Math.round(((original - price) / original) * 100) };
}
