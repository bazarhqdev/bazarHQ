/**
 * Shared form validation (zod). The same schemas run in web and mobile so
 * error messages are identical. The server re-validates everything.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { checkSubdomainSyntax } from '../formatters/subdomain';

/* ------------------------------ Primitives -------------------------- */

/** AUTH-01 / FR-M-01: ≥ 8 characters and at least one number. */
export const passwordSchema = z
  .string()
  .min(LIMITS.passwordMinLength, `Password must be at least ${LIMITS.passwordMinLength} characters.`)
  .regex(/\d/, 'Password must include at least one number.');

export const emailSchema = z.string().trim().min(1, 'Enter your email address.').email('Enter a valid email address.');

/** ASM-01: Bangladeshi 11-digit mobile number, e.g. 01306060688. */
export const bdPhoneSchema = z
  .string()
  .trim()
  .regex(/^01[3-9]\d{8}$/, 'Enter an 11-digit Bangladeshi mobile number, e.g. 01306060688.');

export const moneySchema = z
  .number({ error: 'Enter an amount.' })
  .finite('Enter an amount.')
  .max(LIMITS.maxMoney, 'Amount is too large.')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, { message: 'Use at most 2 decimal places.' });

export function passwordRuleChecks(password: string) {
  return [
    { label: `At least ${LIMITS.passwordMinLength} characters`, ok: password.length >= LIMITS.passwordMinLength },
    { label: 'Include at least one number', ok: /\d/.test(password) },
  ];
}

/* -------------------------------- Auth ------------------------------ */

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(100, 'Name is too long.'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match.',
  });
export type RegisterInput = z.infer<typeof registerSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match.' })
  .refine((v) => v.password !== v.currentPassword, {
    path: ['password'],
    message: 'Choose a password you have not just used.',
  });

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(100, 'Name is too long.'),
  phone: z.union([z.literal(''), bdPhoneSchema]),
});

export const totpCodeSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app.');

/* -------------------------------- Store ----------------------------- */

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .superRefine((value, ctx) => {
    const res = checkSubdomainSyntax(value);
    if (!res.ok) ctx.addIssue({ code: 'custom', message: res.message });
  });

export const hexColourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Pick a valid colour.');

export const storeBasicsSchema = z.object({
  name: z.string().trim().min(2, 'Enter a store name (at least 2 characters).').max(60, 'Store name is too long.'),
  subdomain: subdomainSchema,
  category: z.string().min(1, 'Choose a store category.'),
  tagline: z.string().trim().max(120, 'Keep the tagline under 120 characters.'),
});
export type StoreBasicsInput = z.infer<typeof storeBasicsSchema>;

export const storeBrandingSchema = z.object({
  themeId: z.string().min(1, 'Choose a theme.'),
  brandColour: hexColourSchema,
  tagline: z.string().trim().max(120, 'Keep the tagline under 120 characters.'),
});

export const storeProfileSchema = z.object({
  name: z.string().trim().min(2, 'Enter a store name (at least 2 characters).').max(60, 'Store name is too long.'),
  tagline: z.string().trim().max(120, 'Keep the tagline under 120 characters.'),
  returnWindowDays: z
    .number({ error: 'Enter a number of days.' })
    .int('Use whole days.')
    .min(1, 'Return window must be at least 1 day.')
    .max(LIMITS.maxReturnWindowDays, `Return window can be at most ${LIMITS.maxReturnWindowDays} days.`),
});

export const shippingSchema = z.object({
  insideDhakaCharge: z.number({ error: 'Enter a charge.' }).min(0, 'Charge cannot be negative.').max(100000),
  outsideDhakaCharge: z.number({ error: 'Enter a charge.' }).min(0, 'Charge cannot be negative.').max(100000),
  estimatedDaysInsideDhaka: z.number().int('Use whole days.').min(1, 'At least 1 day.').max(30),
  estimatedDaysOutsideDhaka: z.number().int('Use whole days.').min(1, 'At least 1 day.').max(30),
});

/* ------------------------------- Products --------------------------- */

const variantInputSchema = z.object({
  id: z.string().optional(),
  variantLabel: z.string().trim().min(1, 'Enter a variant name, e.g. "1 kg" or "Large".').max(60, 'Too long.'),
  priceAdjustment: z.number({ error: 'Enter a price adjustment (0 if none).' }).finite(),
  stockQuantity: z.number({ error: 'Enter stock for this variant.' }).int('Stock must be a whole number.').min(0, 'Stock cannot be negative.'),
  status: z.enum(['active', 'inactive']),
});

const imageInputSchema = z.object({
  id: z.string().optional(),
  storagePath: z.string(),
  url: z.string().nullable(),
  isPrimary: z.boolean(),
});

export const productInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a product name.').max(150, 'Product name is too long.'),
    description: z.string().trim().min(10, 'Describe the product in at least 10 characters.').max(5000, 'Too long.'),
    categoryId: z.string().min(1, 'Choose a category.'),
    basePrice: z
      .number({ error: 'Enter a price.' })
      .positive('Price must be greater than 0.')
      .max(LIMITS.maxMoney, 'Price is too large.')
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places.'),
    /** Original / asking price (display only). Must be higher than the base price when set. */
    compareAtPrice: z
      .number()
      .positive('Original price must be greater than 0.')
      .max(LIMITS.maxMoney, 'Price is too large.')
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places.')
      .nullable()
      .default(null),
    productType: z.enum(['simple', 'variant']),
    stockQuantity: z.number().int('Stock must be a whole number.').min(0, 'Stock cannot be negative.').nullable(),
    lowStockThreshold: z.number({ error: 'Enter a low-stock threshold.' }).int('Use a whole number.').min(0, 'Threshold cannot be negative.'),
    status: z.enum(['draft', 'active', 'inactive']),
    sku: z
      .string()
      .trim()
      .max(64, 'SKU is too long.')
      .regex(/^[A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, dashes or underscores.'),
    variants: z.array(variantInputSchema),
    images: z.array(imageInputSchema).max(LIMITS.maxProductImages, `Up to ${LIMITS.maxProductImages} images.`),
  })
  .superRefine((p, ctx) => {
    if (p.compareAtPrice !== null && Number.isFinite(p.basePrice) && p.compareAtPrice <= p.basePrice) {
      ctx.addIssue({ code: 'custom', path: ['compareAtPrice'], message: 'Original price must be higher than the base price, or leave it empty.' });
    }
    // FR-M-15 / DB-08 mutually exclusive stock model.
    if (p.productType === 'simple') {
      if (p.stockQuantity === null || Number.isNaN(p.stockQuantity)) {
        ctx.addIssue({ code: 'custom', path: ['stockQuantity'], message: 'Enter the stock quantity.' });
      }
      if (p.variants.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants'],
          message: 'Simple products cannot have variants. Switch to "Has variants" instead.',
        });
      }
    } else {
      if (p.variants.length === 0) {
        ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Add at least one variant with its own stock.' });
      }
      const seen = new Set<string>();
      p.variants.forEach((v, i) => {
        const key = v.variantLabel.trim().toLowerCase();
        if (key && seen.has(key)) {
          ctx.addIssue({ code: 'custom', path: ['variants', i, 'variantLabel'], message: 'Variant names must be unique.' });
        }
        seen.add(key);
        if (p.basePrice + v.priceAdjustment <= 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['variants', i, 'priceAdjustment'],
            message: 'Final variant price must be greater than 0.',
          });
        }
      });
    }
    if (p.images.length > 0 && p.images.filter((i) => i.isPrimary).length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['images'], message: 'Choose exactly one primary image.' });
    }
  });
export type ProductInput = z.infer<typeof productInputSchema>;

export const categoryNameSchema = z.string().trim().min(2, 'Enter a category name.').max(60, 'Too long.');

/* ------------------------------ Inventory --------------------------- */

export function stockAdjustmentSchema(currentStock: number) {
  return z
    .object({
      delta: z
        .number({ error: 'Enter how many units to add or remove.' })
        .int('Use a whole number.')
        .refine((d) => d !== 0, 'Enter a non-zero amount.'),
      note: z.string().trim().min(3, 'Add a short reason for the audit log.').max(200, 'Too long.'),
    })
    .refine((v) => currentStock + v.delta >= 0, {
      path: ['delta'],
      message: `Stock cannot go below 0 (currently ${currentStock}).`,
    });
}

/* -------------------------------- Orders ---------------------------- */

export const cancelOrderSchema = z.object({
  reason: z.string().trim().min(5, 'Give the customer a reason (at least 5 characters).').max(300, 'Too long.'),
});

export const statusNoteSchema = z.object({
  note: z.string().trim().max(300, 'Keep the note under 300 characters.'),
});

export function codCollectionSchema(orderTotal: number) {
  return z.object({
    amount: z
      .number({ error: 'Enter the amount collected.' })
      .positive('Amount must be greater than 0.')
      .refine((a) => Math.abs(a - orderTotal) < 0.005, {
        message: 'Collected amount must match the order total. Contact support for partial collections.',
      }),
    confirm: z.literal(true, { error: 'Confirm that the cash has actually been collected.' }),
  });
}

/* ---------------------------- Payment configs ----------------------- */

const walletNumber = bdPhoneSchema;
const nonEmptyKey = (label: string) => z.string().trim().min(8, `${label} looks too short.`).max(512, `${label} is too long.`);

export const credentialSchemas = {
  bkash: z.object({
    merchantNumber: walletNumber,
    appKey: nonEmptyKey('App key'),
    appSecret: nonEmptyKey('App secret'),
    username: z.string().trim().min(3, 'Enter the API username.'),
    password: z.string().min(6, 'Enter the API password.'),
  }),
  nagad: z.object({
    merchantId: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, 'Merchant ID should be 6–20 digits.'),
    merchantNumber: walletNumber,
    publicKey: nonEmptyKey('Public key'),
    privateKey: nonEmptyKey('Private key'),
  }),
  rocket: z.object({
    merchantNumber: z
      .string()
      .trim()
      .regex(/^01[3-9]\d{8}\d?$/, 'Enter the 11–12 digit Rocket merchant number.'),
    billerId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9]{4,20}$/, 'Biller ID should be 4–20 letters or numbers.'),
    apiKey: nonEmptyKey('API key'),
  }),
  sslcommerz: z.object({
    storeId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_]{4,40}$/, 'Store ID should be 4–40 letters, numbers or underscores.'),
    storePassword: z.string().min(6, 'Enter the store password.'),
  }),
} as const;

/* -------------------------------- Support --------------------------- */

export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply.').max(5000, 'Reply is too long.'),
});

export const resolutionNoteSchema = z.object({
  resolutionNote: z.string().trim().min(5, 'A resolution note is required to resolve a ticket.').max(1000),
});

/* -------------------------------- Helpers --------------------------- */

export type FieldErrors = Record<string, string>;

/** Flatten zod issues into { "variants.0.variantLabel": "message" }. First message per path wins. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

export function validate<T>(schema: z.ZodType<T>, value: unknown): { ok: true; data: T } | { ok: false; errors: FieldErrors } {
  const res = schema.safeParse(value);
  if (res.success) return { ok: true, data: res.data };
  return { ok: false, errors: toFieldErrors(res.error) };
}

export { z };

/* -------------------------------- Customer -------------------------- */

const districtSchema = z.string().trim().min(2, 'Choose your district.');

/** FR-C-14: full name, BD phone, address, district. Invalid phone blocks progression. */
export const checkoutDeliverySchema = z.object({
  recipientName: z.string().trim().min(2, 'Enter the recipient’s full name.').max(100, 'Name is too long.'),
  phone: bdPhoneSchema,
  email: z.union([z.literal(''), emailSchema]),
  address: z.string().trim().min(8, 'Enter the full delivery address (house, road, area).').max(300, 'Address is too long.'),
  district: districtSchema,
  postalCode: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Postal codes in Bangladesh have 4 digits.'),
  ]),
  saveAddress: z.boolean(),
});
export type CheckoutDeliveryInput = z.infer<typeof checkoutDeliverySchema>;

export const addressSchema = z.object({
  label: z.string().trim().min(2, 'Give this address a label, e.g. Home.').max(30, 'Keep the label short.'),
  recipientName: z.string().trim().min(2, 'Enter the recipient’s name.').max(100, 'Name is too long.'),
  phone: bdPhoneSchema,
  address: z.string().trim().min(8, 'Enter the full address.').max(300, 'Address is too long.'),
  district: districtSchema,
  postalCode: z.union([
    z.literal(''),
    z
      .string()
      .trim()
      .regex(/^\d{4}$/, 'Postal codes in Bangladesh have 4 digits.'),
  ]),
  isDefault: z.boolean(),
});
export type AddressInput = z.infer<typeof addressSchema>;

export const customerRegisterSchema = registerSchema;

/** FR-C-16: the wallet transaction ID the customer received from bKash/Nagad/Rocket. Untrusted input. */
export const walletReferenceSchema = z.object({
  reference: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{8,20}$/, 'Enter the 8–20 character transaction ID from your payment SMS.'),
});

export const trackOrderSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^ORD-\d{8}-BHQ\d{6}$/, 'Order IDs look like ORD-20261020-BHQ000123.'),
  phone: bdPhoneSchema,
});

export const storeSearchSchema = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters.').max(60) });

/** FR-RET-02 */
export const returnRequestSchema = z.object({
  reason: z.enum(['wrong_item', 'damaged', 'not_as_described', 'change_of_mind', 'other'], { error: 'Choose a reason.' }),
  conditionDescription: z.string().trim().min(10, 'Describe the item’s condition in at least 10 characters.').max(1000, 'Too long.'),
});
export type ReturnRequestInput = z.infer<typeof returnRequestSchema>;

/** FR-SUP-01 */
export const ticketCreateSchema = z.object({
  category: z.enum(['order_issue', 'payment_issue', 'delivery_issue', 'return_refund', 'account_issue', 'other'], { error: 'Choose a category.' }),
  subject: z.string().trim().min(5, 'Write a short subject (at least 5 characters).').max(120, 'Subject is too long.'),
  description: z.string().trim().min(20, 'Describe the issue in at least 20 characters.').max(5000, 'Too long.'),
  priority: z.enum(['normal', 'urgent']),
  orderId: z.string(),
});
export type TicketCreateInput = z.infer<typeof ticketCreateSchema>;

/* -------------------------------- Merchant returns ------------------ */

export const returnDecisionSchema = z
  .object({ decision: z.enum(['approved', 'rejected']), reason: z.string().trim().max(500) })
  .refine((v) => v.decision === 'approved' || v.reason.length >= 5, {
    path: ['reason'],
    message: 'A reason is required when rejecting a return (at least 5 characters).',
  });

export function refundCreateSchema(maxAmount: number) {
  return z.object({
    amount: z
      .number({ error: 'Enter the refund amount.' })
      .positive('Amount must be greater than 0.')
      .max(maxAmount, `Refund can’t exceed the order total (৳${maxAmount}).`),
    method: z.enum(['original_method', 'bkash', 'nagad', 'rocket', 'bank_transfer']),
  });
}

/** FR-REF-02/03/07: completion needs settlement evidence. */
export const refundSettlementSchema = z.object({
  reference: z.string().trim().min(4, 'Enter the transfer or transaction reference.').max(100, 'Too long.'),
  note: z.string().trim().max(500, 'Too long.'),
});

export const paymentReviewSchema = z.object({
  decision: z.enum(['paid', 'failed']),
  reason: z.string().trim().min(10, 'Explain what you checked (at least 10 characters). This is audited.').max(500, 'Too long.'),
});

/* ------------------------------ Super Admin ------------------------- */

export const adminLoginSchema = loginSchema;

export const suspendMerchantSchema = z.object({
  reason: z.string().trim().min(10, 'A suspension reason of at least 10 characters is required. It is shown to the merchant.').max(500),
});

/** FR-SA-13: confirmation phrase "DELETE <merchant_email>". */
export function deleteMerchantSchema(email: string) {
  return z.object({
    phrase: z.string().refine((v) => v === `DELETE ${email}`, { message: `Type exactly: DELETE ${email}` }),
  });
}

export const themeSchema = z.object({
  name: z.string().trim().min(2, 'Enter a theme name.').max(40, 'Too long.'),
  description: z.string().trim().min(10, 'Describe the theme in at least 10 characters.').max(200, 'Too long.'),
  accent: hexColourSchema,
  isActive: z.boolean(),
});

export const announcementSchema = z
  .object({
    title: z.string().trim().min(5, 'Enter a title (at least 5 characters).').max(120, 'Too long.'),
    body: z.string().trim().min(20, 'Write at least 20 characters.').max(4000, 'Too long.'),
    audience: z.enum(['all', 'merchants', 'customers']),
    sendMode: z.enum(['now', 'schedule']),
    scheduledAt: z.string(),
  })
  .refine((v) => v.sendMode === 'now' || (v.scheduledAt && Date.parse(v.scheduledAt) > Date.now()), {
    path: ['scheduledAt'],
    message: 'Choose a future date and time.',
  });
export type AnnouncementInput = z.infer<typeof announcementSchema>;

export const policySchema = z.object({
  type: z.enum(['tos', 'privacy']),
  version: z
    .string()
    .trim()
    .regex(/^\d+\.\d+$/, 'Use a version like 2.0 or 2.1.'),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an effective date.'),
  content: z.string().trim().min(50, 'Policy text must be at least 50 characters.').max(50_000, 'Too long.'),
});
export type PolicyInput = z.infer<typeof policySchema>;

export const resolutionSchema = z.object({
  note: z.string().trim().min(10, 'A resolution note of at least 10 characters is required. It is audited.').max(1000),
});
