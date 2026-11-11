'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ImagePlus, Info, Plus, Star, Trash2 } from 'lucide-react';
import {
  errorMessage,
  formatBDT,
  isServiceError,
  LIMITS,
  productInputSchema,
  toFieldErrors,
  type Category,
  type FieldErrors,
  type Product,
  type ProductInput,
  type ProductStatus,
  type ProductType,
  type VariantStatus,
} from '@bazarhq/shared';
import { cn } from '../cn';
import { useNavigation, useServices } from '../context';
import { readImageFile } from '../files';
import { useNative } from '../native';
import { Modal, useToast } from '../components';
import { Alert, Button, Card, CardHeader, IconButton, SelectField, Switch, TextArea, TextField } from '../components';

interface VariantRow {
  key: string;
  id?: string;
  variantLabel: string;
  priceAdjustment: string;
  stockQuantity: string;
  status: VariantStatus;
  existing: boolean;
}
interface ImageRow {
  key: string;
  id?: string;
  storagePath: string;
  url: string | null;
  isPrimary: boolean;
}
interface FormState {
  name: string;
  description: string;
  categoryId: string;
  basePrice: string;
  compareAtPrice: string;
  productType: ProductType;
  stockQuantity: string;
  lowStockThreshold: string;
  status: ProductStatus;
  sku: string;
  variants: VariantRow[];
  images: ImageRow[];
}

let keySeq = 0;
const k = () => `row-${++keySeq}`;

function fromProduct(p?: Product): FormState {
  if (!p) {
    return {
      name: '',
      description: '',
      categoryId: '',
      basePrice: '',
      compareAtPrice: '',
      productType: 'simple',
      stockQuantity: '',
      lowStockThreshold: String(LIMITS.defaultLowStockThreshold),
      status: 'active',
      sku: '',
      variants: [],
      images: [],
    };
  }
  return {
    name: p.name,
    description: p.description,
    categoryId: p.categoryId ?? '',
    basePrice: String(p.basePrice),
    compareAtPrice: p.extensions.compareAtPrice === null ? '' : String(p.extensions.compareAtPrice),
    productType: p.productType,
    stockQuantity: p.stockQuantity === null ? '' : String(p.stockQuantity),
    lowStockThreshold: String(p.lowStockThreshold),
    status: p.status,
    sku: p.extensions.sku ?? '',
    variants: p.variants.map((v) => ({
      key: k(),
      id: v.id,
      variantLabel: v.variantLabel,
      priceAdjustment: String(v.priceAdjustment),
      stockQuantity: String(v.stockQuantity),
      status: v.status,
      existing: true,
    })),
    images: [...p.images]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((i) => ({ key: k(), id: i.id, storagePath: i.storagePath, url: i.url, isPrimary: i.isPrimary })),
  };
}

const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

function toInput(f: FormState): ProductInput {
  // Normalize composed Bengali/Unicode sequences only on submit. Never normalize
  // each keystroke: doing so can interrupt Android Gboard/IME composition.
  return {
    name: f.name.normalize('NFC').trim(),
    description: f.description.normalize('NFC').trim(),
    categoryId: f.categoryId,
    basePrice: num(f.basePrice),
    compareAtPrice: f.compareAtPrice.trim() === '' ? null : num(f.compareAtPrice),
    productType: f.productType,
    stockQuantity: f.productType === 'simple' ? (f.stockQuantity.trim() === '' ? null : num(f.stockQuantity)) : null,
    lowStockThreshold: num(f.lowStockThreshold),
    status: f.status,
    sku: f.sku,
    variants:
      f.productType === 'variant'
        ? f.variants.map((v) => ({
            id: v.id,
            variantLabel: v.variantLabel,
            priceAdjustment: v.priceAdjustment.trim() === '' ? 0 : num(v.priceAdjustment),
            stockQuantity: num(v.stockQuantity),
            status: v.status,
          }))
        : [],
    images: f.images.map((i) => ({ id: i.id, storagePath: i.storagePath, url: i.url, isPrimary: i.isPrimary })),
  };
}

/** Live preview of how the price reads on the storefront. */
function PricePreview({ base, original }: { base: number; original: number }) {
  if (!Number.isFinite(base) || base <= 0) return null;
  const valid = Number.isFinite(original) && original > base;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2.5 sm:col-span-2" aria-live="polite">
      <span className="text-[12.5px] font-semibold text-ink-muted">Customers see</span>
      <span className="text-base font-bold tabular text-ink">{formatBDT(base)}</span>
      {valid && (
        <>
          <span className="text-sm tabular text-ink-subtle line-through">{formatBDT(original)}</span>
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[12px] font-bold text-red-700">{Math.round(((original - base) / original) * 100)}% off</span>
        </>
      )}
      {Number.isFinite(original) && !valid && <span className="text-[12px] text-amber-800">Regular price must be higher than the selling price to show a discount.</span>}
    </div>
  );
}

export interface ProductFormProps {
  product?: Product;
  categories: Category[];
  onCategoriesChange: (c: Category[]) => void;
  onSubmit: (input: ProductInput) => Promise<void>;
  onCancel: () => void;
  layout?: 'web' | 'mobile';
}

export function ProductForm({ product, categories, onCategoriesChange, onSubmit, onCancel, layout = 'web' }: ProductFormProps) {
  const services = useServices();
  const toast = useToast();
  const { Link, paths } = useNavigation();
  const [form, setForm] = useState<FormState>(() => fromProduct(product));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [catOpen, setCatOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = useNative();
  const editing = Boolean(product);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  };

  const setVariant = (key: string, patch: Partial<VariantRow>) =>
    setForm((f) => ({ ...f, variants: f.variants.map((v) => (v.key === key ? { ...v, ...patch } : v)) }));

  const basePrice = num(form.basePrice);

  async function onFiles(files: FileList | File[] | null) {
    if (!files?.length) return;
    const room = LIMITS.maxProductImages - form.images.length;
    const list = [...files].slice(0, Math.max(room, 0));
    if (files.length > list.length) toast.info(`Up to ${LIMITS.maxProductImages} images per product.`);
    for (const file of list) {
      const { upload, error } = await readImageFile(file);
      if (error || !upload) {
        setErrors((e) => ({ ...e, images: `${file.name}: ${error}` }));
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await services.products.uploadImage(upload, product?.id);
        setForm((f) => ({ ...f, images: [...f.images, { key: k(), storagePath: res.storagePath, url: res.url, isPrimary: f.images.length === 0 }] }));
        setErrors((e) => {
          const next = { ...e };
          delete next.images;
          return next;
        });
      } catch (e) {
        setErrors((er) => ({ ...er, images: errorMessage(e) }));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const input = toInput(form);
    const res = productInputSchema.safeParse(input);
    if (!res.success) {
      setErrors(toFieldErrors(res.error));
      setFormError('Please fix the highlighted fields.');
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(res.data);
    } catch (err) {
      if (isServiceError(err) && err.fieldErrors) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);
  const mobile = layout === 'mobile';

  return (
    <form onSubmit={submit} noValidate className={cn('grid grid-cols-1 gap-5', !mobile && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
      <div className="space-y-5">
        {formError && <Alert tone="danger">{formError}</Alert>}

        <Card>
          <CardHeader title="Product details" description="Name, description and category are required." />
          <div className="grid grid-cols-1 gap-4 px-5 pb-5">
            <TextField
              label="Product name"
              lang="bn"
              required
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              error={errors.name}
              placeholder="e.g. Fresh Tomato (Local)"
              maxLength={150}
            />
            <TextArea
              label="Description"
              lang="bn"
              required
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              error={errors.description}
              hint="Bengali or English. Describe size, origin and quality."
              rows={4}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <SelectField
                label="Category"
                required
                value={form.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
                error={errors.categoryId}
                placeholder={categories.length ? 'Choose a category' : 'Create a category first'}
                options={categoryOptions}
              />
              <div className="flex items-end">
                <Button variant="secondary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setCatOpen(true)} className="w-full sm:w-auto">
                  New category
                </Button>
              </div>
            </div>
            <TextField
              label="SKU"
              value={form.sku}
              onChange={(e) => set('sku', e.target.value)}
              error={errors.sku}
              hint="Optional. Leave blank and BazarHQ will generate a unique SKU automatically."
              maxLength={64}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Images" description={`Up to ${LIMITS.maxProductImages} JPG, PNG or WebP images, each under 2 MB. Mark one as primary.`} />
          <div className="px-5 pb-5">
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {form.images.map((img) => (
                <div
                  key={img.key}
                  className={cn(
                    'group relative aspect-square overflow-hidden rounded-xl border bg-canvas',
                    img.isPrimary ? 'border-brand-600 ring-2 ring-brand-600/30' : 'border-line',
                  )}
                >
                  {img.url && <img src={img.url} alt="" className="size-full object-cover" />}
                  <div className="absolute inset-x-1 bottom-1 flex justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, images: f.images.map((x) => ({ ...x, isPrimary: x.key === img.key })) }))}
                      aria-pressed={img.isPrimary}
                      aria-label={img.isPrimary ? 'Primary image' : 'Set as primary image'}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold',
                        img.isPrimary ? 'bg-brand-600 text-white' : 'bg-white/95 text-ink hover:bg-white',
                      )}
                    >
                      <Star className="size-3" aria-hidden fill={img.isPrimary ? 'currentColor' : 'none'} />
                      {img.isPrimary ? 'Primary' : 'Set'}
                    </button>
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() =>
                        setForm((f) => {
                          const rest = f.images.filter((x) => x.key !== img.key);
                          if (img.isPrimary && rest[0]) rest[0] = { ...rest[0], isPrimary: true };
                          return { ...f, images: rest };
                        })
                      }
                      className="rounded-md bg-white/95 p-1 text-red-600 hover:bg-white"
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
              {form.images.length < LIMITS.maxProductImages && (
                <button
                  type="button"
                  onClick={() => (native.pickImage ? void native.pickImage().then((f) => f && onFiles([f])) : fileRef.current?.click())}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line-strong text-ink-muted transition-colors hover:border-brand-600 hover:bg-brand-50 hover:text-brand-700"
                >
                  <ImagePlus className="size-6" aria-hidden />
                  <span className="text-[12px] font-semibold">{uploading ? 'Uploading…' : 'Add photos'}</span>
                </button>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={LIMITS.imageMimeTypes.join(',')}
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => void onFiles(e.target.files)}
            />
            {errors.images && (
              <p className="mt-2 text-[12.5px] font-medium text-red-700" role="alert">
                {errors.images}
              </p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Pricing & stock" description="Simple products keep one stock count. Variant products keep stock per variant." />
          <div className="grid grid-cols-1 gap-4 px-5 pb-5">
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold text-ink">Product type</legend>
              <div className="grid grid-cols-2 gap-2" role="radiogroup">
                {(['simple', 'variant'] as const).map((t) => (
                  <label
                    key={t}
                    className={cn(
                      'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors',
                      form.productType === t ? 'border-brand-600 bg-brand-50' : 'border-line-strong hover:bg-canvas',
                      editing && 'cursor-not-allowed opacity-70',
                    )}
                  >
                    <input
                      type="radio"
                      name="productType"
                      value={t}
                      checked={form.productType === t}
                      disabled={editing}
                      onChange={() => {
                        set('productType', t);
                        if (t === 'variant' && form.variants.length === 0) {
                          setForm((f) => ({
                            ...f,
                            productType: t,
                            variants: [{ key: k(), variantLabel: '', priceAdjustment: '0', stockQuantity: '', status: 'active', existing: false }],
                          }));
                        }
                      }}
                      className="mt-0.5 accent-brand-600"
                    />
                    <span>
                      <span className="block font-semibold">{t === 'simple' ? 'Simple product' : 'Has variants'}</span>
                      <span className="text-[12.5px] text-ink-muted">{t === 'simple' ? 'One price, one stock count' : 'e.g. sizes or pack sizes'}</span>
                    </span>
                  </label>
                ))}
              </div>
              {editing && (
                <p className="mt-2 text-[12.5px] text-ink-subtle">Product type can’t be changed after creation. Duplicate the product to switch type.</p>
              )}
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                label="Selling price"
                required
                inputMode="decimal"
                type="number"
                min={0}
                step="0.01"
                prefix="৳"
                value={form.basePrice}
                onChange={(e) => set('basePrice', e.target.value)}
                error={errors.basePrice}
                hint="Required. The price customers will pay."
              />
              <TextField
                label="Regular price / MRP"
                inputMode="decimal"
                type="number"
                min={0}
                step="0.01"
                prefix="৳"
                value={form.compareAtPrice}
                onChange={(e) => set('compareAtPrice', e.target.value)}
                error={errors.compareAtPrice}
                hint="Optional. Shown crossed out when higher than the selling price."
              />
              <PricePreview base={basePrice} original={num(form.compareAtPrice)} />
              <TextField
                label="Low-stock threshold"
                required
                inputMode="numeric"
                type="number"
                min={0}
                step="1"
                value={form.lowStockThreshold}
                onChange={(e) => set('lowStockThreshold', e.target.value)}
                error={errors.lowStockThreshold}
                hint={form.productType === 'variant' ? 'Flagged when any variant reaches this level.' : 'Flagged when stock reaches this level.'}
              />
            </div>

            {form.productType === 'simple' ? (
              editing ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-ink">Stock quantity</p>
                    <p className="text-2xl font-bold tabular text-ink">{form.stockQuantity || 0}</p>
                  </div>
                  <Link href={paths.inventoryFor(product!.id)} className="text-sm font-semibold text-brand-700 hover:underline">
                    Adjust stock in Inventory →
                  </Link>
                </div>
              ) : (
                <TextField
                  label="Opening stock quantity"
                  required
                  inputMode="numeric"
                  type="number"
                  min={0}
                  step="1"
                  value={form.stockQuantity}
                  onChange={(e) => set('stockQuantity', e.target.value)}
                  error={errors.stockQuantity}
                  hint="Recorded in the inventory log. Later changes go through Inventory."
                />
              )
            ) : (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[13px] font-semibold text-ink">Variants</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Plus className="size-4" aria-hidden />}
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        variants: [...f.variants, { key: k(), variantLabel: '', priceAdjustment: '0', stockQuantity: '', status: 'active', existing: false }],
                      }))
                    }
                  >
                    Add variant
                  </Button>
                </div>
                {errors.variants && (
                  <p className="mb-2 text-[12.5px] font-medium text-red-700" role="alert">
                    {errors.variants}
                  </p>
                )}
                <div className="space-y-3">
                  {form.variants.map((v, i) => {
                    const finalPrice = Number.isFinite(basePrice) ? basePrice + (Number(v.priceAdjustment) || 0) : null;
                    return (
                      <div key={v.key} className="rounded-xl border border-line p-3">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_1fr_1fr_auto] sm:items-start">
                          <TextField
                            label="Variant name"
                            value={v.variantLabel}
                            onChange={(e) => setVariant(v.key, { variantLabel: e.target.value })}
                            error={errors[`variants.${i}.variantLabel`]}
                            placeholder="e.g. 1 kg"
                          />
                          <TextField
                            label="Price adjustment"
                            type="number"
                            step="0.01"
                            inputMode="decimal"
                            prefix="৳"
                            value={v.priceAdjustment}
                            onChange={(e) => setVariant(v.key, { priceAdjustment: e.target.value })}
                            error={errors[`variants.${i}.priceAdjustment`]}
                            hint={
                              finalPrice !== null
                                ? `Sells at ${formatBDT(finalPrice)}${num(form.compareAtPrice) > basePrice ? ` (was ${formatBDT(num(form.compareAtPrice) + (Number(v.priceAdjustment) || 0))})` : ''}`
                                : undefined
                            }
                          />
                          {v.existing ? (
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[13px] font-semibold text-ink">Stock</span>
                              <span className="flex h-10 items-center text-sm font-bold tabular">{v.stockQuantity}</span>
                            </div>
                          ) : (
                            <TextField
                              label="Opening stock"
                              type="number"
                              min={0}
                              step="1"
                              inputMode="numeric"
                              value={v.stockQuantity}
                              onChange={(e) => setVariant(v.key, { stockQuantity: e.target.value })}
                              error={errors[`variants.${i}.stockQuantity`]}
                            />
                          )}
                          <div className="flex items-center gap-2 sm:pt-7">
                            <Switch
                              size="sm"
                              checked={v.status === 'active'}
                              onChange={(on) => setVariant(v.key, { status: on ? 'active' : 'inactive' })}
                              label={`Variant ${v.variantLabel || i + 1} available`}
                            />
                            {!v.existing && (
                              <IconButton
                                label="Remove variant"
                                tone="danger"
                                onClick={() => setForm((f) => ({ ...f, variants: f.variants.filter((x) => x.key !== v.key) }))}
                              >
                                <Trash2 className="size-4" aria-hidden />
                              </IconButton>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {editing && (
                  <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-ink-subtle">
                    <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                    Existing variants can be hidden but not deleted, because past orders reference them. Adjust their stock in Inventory.
                  </p>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader title="Visibility" />
          <div className="space-y-2 px-5 pb-5">
            {(
              [
                ['active', 'Active', 'Visible on your storefront.'],
                ['inactive', 'Hidden', 'Saved but not shown to customers.'],
                ['draft', 'Draft', 'Work in progress; not shown.'],
              ] as const
            ).map(([value, label, desc]) => (
              <label
                key={value}
                className={cn(
                  'flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm',
                  form.status === value ? 'border-brand-600 bg-brand-50' : 'border-line hover:bg-canvas',
                )}
              >
                <input
                  type="radio"
                  name="status"
                  value={value}
                  checked={form.status === value}
                  onChange={() => set('status', value)}
                  className="mt-0.5 accent-brand-600"
                />
                <span>
                  <span className="block font-semibold">{label}</span>
                  <span className="text-[12.5px] text-ink-muted">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
        <div
          className={cn(
            'flex gap-2',
            mobile
              ? 'sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))]'
              : 'lg:sticky lg:top-20 flex-col',
          )}
        >
          <Button type="submit" variant="brand" size={mobile ? 'lg' : 'md'} loading={submitting} disabled={uploading > 0} block>
            {editing ? 'Save changes' : 'Add product'}
          </Button>
          <Button variant="secondary" size={mobile ? 'lg' : 'md'} onClick={onCancel} disabled={submitting} block>
            Cancel
          </Button>
        </div>
      </div>

      <NewCategoryModal
        open={catOpen}
        onClose={() => setCatOpen(false)}
        onCreated={(c) => {
          onCategoriesChange([...categories, c]);
          set('categoryId', c.id);
        }}
      />
    </form>
  );
}

function NewCategoryModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (c: Category) => void }) {
  const services = useServices();
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const c = await services.products.createCategory(name);
      onCreated(c);
      setName('');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New category"
      size="sm"
      busy={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={() => void submit()} loading={busy}>
            Create
          </Button>
        </>
      }
    >
      <TextField
        label="Category name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={error}
        data-autofocus
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          }
        }}
      />
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Duplicate (FR-M-19)                                                 */
/* ------------------------------------------------------------------ */

/**
 * Duplicate with options. The copy is always a Draft with stock 0 — stock only
 * enters through the inventory ledger — so it never appears on the storefront
 * by surprise.
 */
export function DuplicateProductDialog({
  product,
  onClose,
  onDuplicated,
}: {
  product: Product | null;
  onClose: () => void;
  onDuplicated: (copy: Product) => void;
}) {
  const services = useServices();
  const toast = useToast();
  const [name, setName] = useState('');
  const [includeImages, setIncludeImages] = useState(true);
  const [includePricing, setIncludePricing] = useState(true);
  const [copySku, setCopySku] = useState(true);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  // Reset the form whenever a different product is chosen.
  if (product && product.id !== forId) {
    setForId(product.id);
    setName(`${product.name} (Copy)`);
    setIncludeImages(true);
    setIncludePricing(true);
    setCopySku(true);
    setError(undefined);
  }
  if (!product) return null;
  const submit = async () => {
    if (name.trim().length < 2) return setError('Enter a product name (at least 2 characters).');
    setBusy(true);
    setError(undefined);
    try {
      const copy = await services.products.duplicate(product.id, { name: name.trim(), includeImages, includePricing, copySku });
      toast.success('Draft copy created', 'Stock starts at 0 — add stock in Inventory, then make it visible.');
      onDuplicated(copy);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      title={`Duplicate ${product.name}`}
      description="Creates a new draft product you can edit before publishing."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="brand" onClick={submit} loading={busy}>
            Create copy
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name of the copy" required value={name} onChange={(e) => setName(e.target.value)} error={error} maxLength={150} autoFocus />
        <fieldset className="space-y-2.5">
          <legend className="mb-1 text-[13px] font-semibold text-ink">Also copy</legend>
          {[
            {
              label: 'Images',
              detail: product.images.length ? `${product.images.length} photo${product.images.length === 1 ? '' : 's'}` : 'None on this product',
              checked: includeImages,
              set: setIncludeImages,
              off: product.images.length === 0,
            },
            {
              label: 'Regular price / MRP',
              detail: product.extensions.compareAtPrice !== null ? formatBDT(product.extensions.compareAtPrice) : 'None set',
              checked: includePricing,
              set: setIncludePricing,
              off: product.extensions.compareAtPrice === null,
            },
            {
              label: 'SKU',
              detail: product.extensions.sku ? `Saved as ${product.extensions.sku}-COPY` : 'None set',
              checked: copySku,
              set: setCopySku,
              off: !product.extensions.sku,
            },
          ].map((o) => (
            <div key={o.label} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{o.label}</p>
                <p className="truncate text-[12.5px] text-ink-muted">{o.detail}</p>
              </div>
              <Switch checked={o.checked && !o.off} onChange={o.set} disabled={o.off} label={`Copy ${o.label.toLowerCase()}`} />
            </div>
          ))}
        </fieldset>
        <ul className="space-y-1 rounded-xl bg-canvas p-3 text-[12.5px] text-ink-muted">
          <li>
            Always copied: description, category, base price{product.productType === 'variant' ? `, ${product.variants.length} variants` : ''}, low-stock
            threshold.
          </li>
          <li>Stock starts at 0 and the copy is saved as a Draft (hidden from customers).</li>
        </ul>
      </div>
    </Modal>
  );
}

/** "Start from an existing product" on the Add product screen. */
export function StartFromExisting({ onDuplicated }: { onDuplicated: (copy: Product) => void }) {
  const services = useServices();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [choice, setChoice] = useState('');
  const [source, setSource] = useState<Product | null>(null);
  const load = async () => {
    if (!products) setProducts(await services.products.list());
  };
  return (
    <Card className="mb-5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <SelectField
          label="Start from an existing product (optional)"
          hint="Copies its details into a new draft — handy for similar items or a different pack size."
          value={choice}
          onFocus={() => void load()}
          onPointerDown={() => void load()}
          onChange={(e) => setChoice(e.target.value)}
          placeholder={products ? 'Choose a product' : 'Loading products…'}
          options={(products ?? []).map((p) => ({ value: p.id, label: `${p.name}${p.extensions.sku ? ` · ${p.extensions.sku}` : ''}` }))}
          containerClassName="flex-1"
        />
        <Button variant="secondary" disabled={!choice} onClick={() => setSource(products?.find((p) => p.id === choice) ?? null)}>
          Duplicate…
        </Button>
      </div>
      <DuplicateProductDialog
        product={source}
        onClose={() => setSource(null)}
        onDuplicated={(copy) => {
          setSource(null);
          onDuplicated(copy);
        }}
      />
    </Card>
  );
}
