# Database RPCs, direct reads, Auth, Storage and Realtime

Everything here runs **as the caller**. PostgREST passes the verified JWT to Postgres, Row-Level Security filters every row, and the SECURITY DEFINER functions below take the actor from `auth.uid()`; it is never a parameter. Functions that move money, stock or order/payment/refund state are **not** callable by clients. They are executable by `service_role` only and are reached through the [Edge Functions](EDGE_FUNCTIONS.md).

Call an RPC with `POST /rest/v1/rpc/<name>` and a JSON body of named parameters (e.g. `{ "p_subdomain": "freshmart" }`). With supabase-js, use `sb.rpc(name, args)`. Errors follow the SQLSTATE mapping in [README.md](README.md).

## RPCs callable by clients

### Public (anon and signed-in)

| RPC | Purpose | Notes |
|---|---|---|
| `resolve_store(p_subdomain)` | Storefront header data (FR-C-01/02) | Published store with an active owner only. Unknown, draft and suspended stores raise the same `BQ003`. Returns theme, shipping, enabled payment methods and merchant `contact { phone, email }` (FR-C-25). |
| `search_stores(p_query, p_limit)` | Store discovery (FR-C-01) | Accepts a name, subdomain or pasted `*.bazarhq.com` link. Returns stores only, never a cross-store product list. |
| `validate_cart(p_store_id, p_items, p_district)` | Cart revalidation (FR-C-09/12) | Current price, available stock, capped quantity and delivery charge per line. Changes nothing. |
| `storefront_product_popularity(p_store_id)` | "Most popular" sort | Only `(product_id, units)` over 90 days of non-cancelled orders; nothing for unpublished stores. |
| `record_storefront_visit(p_store_id, p_path, p_session_id)` | Visitor analytics (FR-M-37) | Stores a salted hash of a random per-tab id; no IP or user id. |
| `current_user_id()`, `current_active_app_role()`, `current_store_id()`, `is_super_admin()`, `is_merchant()`, `is_customer()`, `owns_store(id)`, `owns_product(id)`, `owns_order(id)`, `can_read_order(id)`, `can_read_return(id)`, `can_access_ticket(id)` | Authorization helpers used by RLS | They answer only about the caller. |

### Signed-in users

| RPC | Role | Purpose |
|---|---|---|
| `list_my_sessions()` / `revoke_my_session(p_session_id)` | any | Active sessions (device, last active, current) / sign one out (FR-M-43, AUTH-06) |
| `delete_my_account(p_confirmation)` | customer, merchant | Anonymise the account and keep transaction history (FR-C-36, §20.6). Blocked while orders are open. |
| `become_merchant()` | new customer | Google sign-up from the merchant page (FR-M-05). Only a brand-new account with no activity, once; audited. |
| `mark_all_notifications_read()` | any | Marks the caller's notifications read |
| `check_subdomain(p_subdomain)` | merchant | Format, reserved list, uniqueness and suggestions (FR-M-06..08) |
| `create_store(p_name, p_subdomain, p_category, p_tagline)` | merchant | One store per merchant, created as a draft (FR-M-09/10) |
| `get_onboarding_progress()` | merchant | Checklist: subdomain, logo, payment method, first product |
| `publish_store()` / `unpublish_store()` | merchant | Publishing needs the full checklist and ≥ 1 enabled payment method (FR-M-11) |
| `get_payment_configs()` | merchant | Method, enabled, validation, environment, masked hint. Never credentials. |
| `set_payment_method_enabled(p_method, p_enabled)` | merchant | Wallets and cards need validated credentials first (saved through `payment-credentials`) |
| `create_product(p_input)` / `update_product(p_product_id, p_input)` | merchant | Simple or variant stock model (DB-08), category from the same store, original price above base price. Opening stock goes through the ledger. `update_product` never changes stock (use `adjust-inventory`). |
| `set_product_status`, `delete_product` (soft delete), `duplicate_product(p_product_id, p_options)` | merchant | The duplicate is a draft with stock 0 and a unique `-COPY` SKU (FR-M-19) |
| `merchant_customers()` | merchant | Customers derived from the merchant's own orders (registered and guest) |
| `merchant_dashboard(p_from, p_to)` | merchant | Revenue, orders, visitors, popular pages, low stock, series |
| `refund_timeline(p_refund_id)` | participant | Refund history with actor names (FR-REF-06) |
| `get_ticket_thread(p_ticket_id)`, `ticket_customer_names(p_ticket_ids)` | ticket participant | Messages and the ticket's audit trail, with sender names and roles |
| `reply_to_ticket(p_ticket_id, p_body, p_attachment_path)` | participant | The first merchant reply is recorded as the response for the 72-hour rule. Closed tickets are read-only. |
| `update_ticket_status(p_ticket_id, p_to_status, p_resolution_note)` | store merchant, admin | `open → in_progress → waiting_for_customer ↔ in_progress → resolved → closed`. Resolving needs a note. |
| `set_ticket_priority`, `reopen_ticket` | customer | A closed ticket can be reopened within 7 days of closure |
| `create_support_ticket(...)`, `escalate_ticket(p_ticket_id)` | customer | Use the Edge Functions of the same names, which add rate limits |
| `attach_return_evidence(p_return_id, p_storage_path)` | return's customer | Called by `request-return` |
| `admin_dashboard(p_from, p_to)`, `admin_list_merchants(p_search, p_status)`, `admin_list_customers(p_search)`, `admin_user_session_count(p_user_id)`, `admin_announcement_recipient_count(p_audience)`, `admin_assign_ticket(p_ticket_id, p_assignee)`, `admin_resolve_ticket_dispute(p_ticket_id, p_action, p_note)` | Super Admin (aal2 + allowlisted IP, re-checked inside) | Read-only console data, ticket assignment and dispute decisions (audited) |

### Service role only (Edge Functions)

`create_order`, `submit_wallet_reference`, `prepare_sslcommerz_payment`, `apply_payment_result`, `create_payment_attempt`, `record_payment_transaction_state`, `transition_order_status`, `record_cod_collection`, `adjust_inventory`, `request_return`, `escalate_return`, `decide_return`, `set_return_method`, `confirm_return_receipt`, `close_return`, `create_refund`, `update_refund_status`, `track_order`, `register_device_token`, `unregister_device_token`, `claim_pending_push_notifications`, `store_payment_credentials`, `get_payment_credentials`, `consume_rate_limit`, `get_actor_context`, `admin_network_check`, `admin_set_merchant_status`, `admin_delete_merchant`, `admin_save_theme`, `admin_delete_theme`, `admin_save_announcement`, `admin_unschedule_announcement`, `admin_delete_announcement`, `admin_submit_policy`, `admin_approve_policy`, `admin_publish_policy`, `admin_resolve_return_dispute`, `admin_intervene_refund`, and the payment readers `payment_snapshot`, `pending_verification_attempt` and `sslcommerz_attempt_context` (migration 014). `service_role` has no direct DML on order, payment, stock, refund or audit tables, and no direct access at all to `payment_transactions`.

## Direct reads under RLS

| Table | anon | customer | merchant | Super Admin (aal2 + IP) |
|---|---|---|---|---|
| `stores` | published | published | own (any status) + published | all |
| `products`, `product_variants`, `product_images`, `categories` | active items of published stores | same | own store (all statuses); categories and images writable | all |
| `themes` | active | active | active | all |
| `policies` | published | published | published | all |
| `announcements` | sent to "all" | sent to customers/all | sent to merchants/all | all |
| `profiles` | — | own (name, phone and avatar writable; role/status never) | own | all |
| `orders`, `order_items`, `delivery_events`, `payment_transactions` (safe columns) | — | own orders | own store | all (read-only) |
| `inventory_movements` | — | — | own store | all |
| `returns`, `refunds` | — | own | own store | all |
| `support_tickets`, `ticket_messages`, `ticket_audit_log` | — | own | store-queue tickets of own store | all |
| `customer_addresses` | — | own (insert/update/delete; max 3; one default) | — | — |
| `notifications` | — | own (mark read) | own | own |
| `device_tokens` | — | masked, via the function only | same | same |
| `audit_logs` | — | — | — | read only (append-only table) |
| `payment_configs`, `storefront_visits`, `private.*` | — | — | — (functions only) | — (functions only) |

Writes not listed here are not possible from a client, whatever the request.

## Authentication

Supabase Auth (`/auth/v1`), configured in `supabase/config.toml`:

- **Email + password:** sign-up with email confirmation and passwords of 8+ characters including a digit. `account_type` in the sign-up metadata only chooses between the two public sign-up paths (`customer` or `merchant`); `super_admin` can never come from a client. Super Admins are created only with `select private.grant_super_admin('<user id>', '<reason>')`, run as `postgres`, which is audited.
- **Google OAuth (PKCE):** web redirects back to the page; Android opens the system browser and returns on `bazarhq://auth/callback`.
- **Access-token hook** `public.custom_access_token_hook`: adds the `app_role` claim (used by the web middleware for routing only) and refuses tokens for suspended or deleted accounts.
- **Password-verification hook** `public.hook_password_verification_attempt`: locks an account for 15 minutes after 5 consecutive failures (AUTH-07).
- **MFA (TOTP):** required for Super Admin data. Every admin check requires `aal2` in addition to the role and network.
- **Sessions:** refresh-token rotation; suspension or deletion deletes all of the user's sessions (trigger in migration 011).

## Storage

Private buckets (migration 002/009), with `storage.objects` RLS on every operation:

| Bucket | Path | Who can write | Who can read | Limits |
|---|---|---|---|---|
| `product-images` | `stores/{store_id}/products/{product_id}/{file}` | owning merchant (product must exist in that store) | public for active products of published stores; owner; admin | 2 MB, JPEG/PNG/WebP |
| `store-logos` (the brief's "store-assets") | `stores/{store_id}/logos/{file}`, `stores/{store_id}/banners/{file}` | owning merchant | public for published stores; owner; admin | 2 MB, JPEG/PNG/WebP |
| `profile-images` | `users/{user_id}/{file}` | that user | that user; admin | 2 MB, JPEG/PNG/WebP |
| `return-evidence` | `returns/{return_id}/{file}` | the return's customer | the return's customer, store merchant, admin | 5 MB, JPEG/PNG/WebP |
| `delivery-evidence` | `orders/{order_id}/delivery/{file}` | owning merchant | anyone who can read the order | 5 MB, JPEG/PNG/WebP |
| `support-attachments` | `tickets/{ticket_id}/{file}` | ticket participants | ticket participants | 5 MB, JPEG/PNG/PDF |

Files are served with short-lived signed URLs (1 hour). Database columns store only the object path, and migration 011 checks that the path is inside the owner's own folder. Cloudinary is not used.

## Realtime

Tables in the `supabase_realtime` publication: `orders`, `delivery_events`, `notifications`, `support_tickets`, `ticket_messages`, `returns` and `refunds`. Supabase applies the subscriber's RLS to every change. The service layer (`notifications.subscribe`, `realtime.subscribeToOrder`) subscribes as follows:

| Who | Channel filter | Covers |
|---|---|---|
| everyone | `notifications` `user_id = me` | new orders, low stock (inventory alerts), ticket replies, admin alerts, announcements |
| merchant | `orders` / `support_tickets` `store_id = my store` | new orders, status changes, ticket updates |
| customer | `orders` / `support_tickets` / `returns` `customer_id = me` | order tracking, ticket and return updates |
| super admin | `support_tickets` `queue = platform` | escalations |
| order page | `orders` `id = X`, `delivery_events` `order_id = X` | live timeline |

Guests on the public tracking page have no session and RLS gives them no rows, so that page polls `track-order` every 20 seconds. Push notifications are sent by `send-notification` using FCM credentials that exist only in Edge Function secrets.
