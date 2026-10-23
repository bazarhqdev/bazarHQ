# Schema gaps and SRS conflicts — Merchant frontend

The Merchant brief asked for several UI fields that have **no column in SRS V2.1 §18.1** and two features the SRS excludes. Nothing here changes the database. Each item needs a Project Owner decision before the Supabase adapter is written.

## UI fields with no SRS column (implemented, kept separate in code)

These sit in `StoreExtensions` / `ProductExtensions` in `packages/shared/src/types.ts`, so the gap is visible wherever they're used. The mock service saves them. A real backend can't until a migration adds them.

| Field | Where in the UI | Suggested resolution |
|---|---|---|
| `stores.category` | Onboarding → Store details; Store settings | Add `category text` with a CHECK list, or drop it |
| `stores.banner_url` | Onboarding → Theme; Store settings | Add `banner_storage_path`. The bucket path contract would also need a banners sub-path |
| Delivery charges and estimated days (inside/outside Dhaka) | Store settings → Shipping | FR-C-08 says delivery charge is "based on merchant configuration" but defines no column. Add `shipping_settings jsonb` or a `store_shipping_rates` table |
| Notification preferences (email/SMS per event) | Store settings → Notifications | Add `notification_preferences jsonb` on `profiles` or `stores` |
| `products.sku` | Product form, product list search | Add `sku text` with a unique `(store_id, sku)` index where the value is not null |
| `products.compare_at_price` (original / asking price) | Product form, product cards, product detail, compare view, merchant list | Add `compare_at_price numeric(12,2) NULL` with `CHECK (compare_at_price IS NULL OR compare_at_price > base_price)` — **only if the Project Owner accepts the SRS §25 change below** |
| Payment config environment (sandbox/live) | Payment settings | Currently implied by constraint 5.2 (sandbox only). It could live inside `credentials_encrypted` or as a column |

## Requested features omitted because the SRS excludes them

| Requested | SRS position | What the UI does |
|---|---|---|
| Optional **sale price** | §25: "Coupon / discount engine — no … discount pricing" | Phase 1 omitted it. **Since added at the Project Owner's explicit request** as a *display-only* “Original / asking price”. See *SRS conflict: original price* below |
| Merchant **creates** support tickets | §4.3: Submit support tickets — Merchant ✗. Merchants manage tickets assigned to their store only | The support screen is an inbox: reply, status workflow and resolution note. There is no "New ticket" button |
| Payouts / withdrawals, Marketing, Delivery Agent | §25 out of scope | Not built, even though the visual reference shows them |
| Customer **status toggle** (active/inactive switch in the reference) | No merchant FR to change customer accounts | Customers are derived from own-store orders. The status column is computed (New, Active or Inactive) and read-only |

## SRS conflict: original / asking price

SRS §25 excludes discount pricing, and the SRS is the final authority. The original price was added later at the Project Owner's explicit request, and its scope is kept as small as possible:

- **It is display-only.** The order total, `order_items.unit_price`, stock and payment all use `base_price + price_adjustment`, exactly as before. Checkout never reads `compareAtPrice`.
- **It is not a discount engine.** There are no coupons, schedules, percentage rules or per-customer pricing. The merchant types one optional number, which must be higher than the base price (validated client-side and in the mock service).
- **What customers see:** the base price, the struck-through original and an “N% off” label. Variant products use the same adjustment on both prices.
- **Before release**, the SRS needs a change note (§25 and the product data dictionary), and a migration must add the column. Until then the Supabase adapter cannot store it, and the field should be hidden if the change is not approved.

## Assumptions to confirm

1. **Confirming a pending order (§13.1 "payment/COD preconditions are checked server-side").** The mock server accepts `pending → confirmed` only when `payment_status` is `paid` or `cod_pending`. It's defined in `CONFIRMABLE_PAYMENT_STATUSES` (`packages/shared/src/rules.ts`). Replace it with the server's rule.
2. **COD collection (DM-05).** It can be recorded only while the order is `out_for_delivery` or `delivered`, and the amount must equal the order total. Partial collections aren't modelled.
3. **Product status values.** The frontend uses `draft | active | inactive`. Align these with the `products.status` CHECK constraint in migration 001.
4. **Inventory reasons.** The frontend uses `sale | return | manual_adjustment | cancellation_release | payment_failure_release`. Opening stock on product creation is logged as `manual_adjustment`, because the SRS lists no "initial stock" reason.
5. **Duplicate product (FR-M-19).** The copy is saved as a Draft with stock 0, so a copy never creates inventory without a ledger entry. The merchant names the copy and chooses whether to copy the images, the original price and the SKU (saved as `<SKU>-COPY`, `-COPY-2`, … to stay unique per store). Variants are copied with new ids. A Supabase build should run this as one RPC or Edge Function so the copy is atomic.
6. **Return window upper bound.** The UI caps it at 90 days as a sanity limit. The SRS sets no maximum.

---

# Phase 2 additions — Customer and Super Admin

Same rule as above: **no migration was changed**. The fields below exist only in the TypeScript types and the mock service. Each needs a Project Owner decision (new migration) before the Supabase adapter can persist it.

## Fields the UI needs that Stage 1 tables don't define

| Field / concept | Used by | Suggested resolution |
|---|---|---|
| Return **dispute** state (`status`, `decision`, `admin_note`, `escalated_at`) | Customer "Escalate to BazarHQ", Super Admin Disputes (FR-RET-09, FR-SA-21) | A `return_disputes` table (1:1 with `returns`) or four nullable columns on `returns` |
| Ticket **dispute** state and explicit **queue** (`store` / `platform`) | Admin support queue, FR-SUP-03 routing | `queue` can be derived from `assigned_to`'s role; dispute fields need columns or a shared `disputes` table keyed by resource |
| `products.slug` | Storefront route `/store/[subdomain]/products/[slug]` (brief) | Add `slug text` with a unique `(store_id, slug)` index; until then the slug is derived from the name and ids still resolve |
| `returns.return_method` (`customer_drop_off` / `merchant_pickup`) | Merchant return workflow | Add a CHECK-constrained text column |
| `returns.refund_amount_requested` | Return review, dispute view | Add a numeric column, or derive from `order_items` |
| Refund **history** (initiated → processing → completed/failed, actor, note) | Refund timeline (FR-REF-06) | Append-only `refund_events`, or rely on `audit_logs` rows filtered by `resource_id` |
| Refund `method` values `original_method | bkash | nagad | rocket | bank_transfer` | Refund modal | Confirm against the `refunds.method` CHECK |
| `themes.breaking_change_effective_at` | 7-day notice for breaking theme updates (FR-SA-15) | Add a nullable timestamptz |
| `announcements.audience` values `all | merchants | customers` | Announcement composer | Confirm the CHECK list |
| `policies.status = archived` (shown as “Superseded”) | Policy history | Confirm the status list; the mock archives the previous published version on publish |
| `profiles.status = deleted` | Customer self-deletion (FR-C-36), merchant deletion (FR-SA-13) | Confirm the CHECK list, or use a `deleted_at` soft-delete column |
| Public tracking **rate limit** counter | FR-C-23 | Edge-level limiter (e.g. Upstash/KV) — not a table |
| System **health** components and logs | Admin System health | External monitoring (Supabase status + uptime checks), not a table |
| Super Admin **IP allowlist** and **TOTP** | FR-SA-01/02 | Edge allowlist (`ADMIN_IP_ALLOWLIST`, see `apps/web/middleware.ts`) and Supabase MFA (AAL2) — not tables |

## Assumptions to confirm (Phase 2)

1. **Ticket routing (FR-SUP-03).** Order, payment, delivery and return tickets go to the order's store; account/other tickets, and any ticket whose store is suspended or deleted, go to the platform queue.
2. **Return eligibility.** Delivered orders only; window counted from the `delivered` delivery event; one return per order; default 7 days (`stores.return_window_days`).
3. **Refund completion** requires a settlement reference and marks the order `refunded` and the return `closed`. COD orders cannot be refunded to `original_method`.
4. **Manual payment review** (Option B `pending_verification → paid|failed`) is offered to the store owner and to Super Admins, with a mandatory reason, audited. Rocket references always go to manual review in the mock; bKash/Nagad auto-verify (references starting with `FAIL` simulate a provider rejection).
5. **Super Admin order access is read-only.** The admin service exposes no order-status mutation.
6. **Merchant reinstatement** leaves the store unpublished until the merchant republishes it (FR-SA-12).
7. **Truncated brief.** The Phase 2 prompt was cut off after the canonical order-status list. The remaining Customer, Super Admin and mobile scope was taken from SRS V2.1 §11, §12, §14, §15 and §16.
