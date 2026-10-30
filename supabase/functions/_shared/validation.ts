/**
 * Server-side input validation (Zod). These rules mirror the database checks so
 * the user gets field-level messages early; the database still enforces every
 * rule itself (client and Edge checks are never the final boundary).
 */
import { z } from './deps.ts';
import { invalid } from './errors.ts';

export { z };

export const uuid = z.string().uuid({ error: 'Invalid identifier.' });
/** 8–200 characters; letters, digits and - _ : . */
export const idempotencyKey = z
  .string()
  .trim()
  .min(8, { error: 'A valid idempotency key is required.' })
  .max(200, { error: 'A valid idempotency key is required.' })
  .regex(/^[A-Za-z0-9_:.-]+$/, { error: 'A valid idempotency key is required.' });
/** Bangladeshi mobile number, 01XXXXXXXXX (FR-C-14); +880 / 880 prefixes accepted. */
export const bdPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?880/, '0'))
  .pipe(z.string().regex(/^01[3-9]\d{8}$/, { error: 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX).' }));
export const money = z
  .number({ error: 'Enter an amount.' })
  .positive({ error: 'Amount must be more than 0.' })
  .max(10_000_000, { error: 'Amount is too large.' })
  .refine((v) => Math.round(v * 100) === v * 100, { error: 'Use at most 2 decimal places.' });
export const note = (min: number, max: number, label = 'Note') =>
  z
    .string()
    .trim()
    .min(min, { error: `${label} must be at least ${min} characters.` })
    .max(max, { error: `${label} must be at most ${max} characters.` });
export const optionalNote = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: `Keep it under ${max} characters.` })
    .optional()
    .transform((v) => (v ? v : null));

export const paymentMethod = z.enum(['bkash', 'nagad', 'rocket', 'sslcommerz', 'cod'], { error: 'Choose a payment method.' });
export const orderStatus = z.enum(['confirmed', 'processing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'], {
  error: 'Choose a valid order status.',
});

/** Parses or throws a 422 with per-field messages ("delivery.phone": "…"). */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = Object.values(fieldErrors)[0] ?? 'Please check the highlighted fields.';
  throw invalid(first, fieldErrors);
}
