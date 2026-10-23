# Feature completion report

Checked line by line against the full project brief (both parts) and SRS V2.1. **Status** means: ✅ built and covered by a test, route check or end-to-end flow; ◐ built with a stated difference; — not built because the SRS or brief puts it out of scope.

All features run on the typed mock service layer (`packages/shared/src/services/mock/`). No mock data lives in UI components.

## Customer web

| Brief item | Status | Where / notes |
|---|---|---|
| Customer login, registration, email verification | ✅ | `/login`, `/register`, `/verify-email`, `/forgot-password` (reset via `?token=`). Google sign-in creates a customer (role set server-side) |
| Store discovery | ✅ | `/`, `/stores` — stores only, never a product catalogue; accepts name, subdomain or pasted link |
| Store browsing by subdomain | ✅ | `/store/[subdomain]`; `middleware.ts` serves `<sub>.bazarhq.com` from it |
| Store branding | ✅ | Brand colour (contrast-checked text), logo/initials, tagline, category, delivery and return info |
| Product search, product filtering, category filtering | ✅ | `/store/[subdomain]/products` — search, category, price range, in-stock, 4 sort orders, “No products found” with browse action |
| Product detail, images, variants | ✅ | `/store/[subdomain]/products/[slug]` — gallery, pointer zoom, sold-out variants disabled, “Only N left”, original price with “You save ৳…” |
| Product comparison (FR-C-05) | ✅ | “Compare” toggle on every product card and on the detail page; a compare bar docks at the bottom (above the tab bar on Android) and opens a side-by-side table: price, saving, category, availability, options and description, with “Lowest price” marked. Up to 3 products, one store only, kept on the device (e2e-tested) |
| Cart | ✅ | `/store/[subdomain]/cart` per store; `/cart` lists carts; quantity capped to stock; price-change banner |
| Checkout, shipping address, BD phone validation | ✅ | 3 steps; `01XXXXXXXXX` validation blocks progress; 64 districts; saved-address prefill; draft survives session expiry |
| bKash / Nagad / Rocket / SSLCommerz / COD | ✅ | Only methods the store enabled. Wallet transaction ID → `pending_verification` (server verifies); SSLCommerz via sandbox page; COD → `cod_pending` |
| Order confirmation | ✅ | `/store/[subdomain]/order-success?order=` |
| Order tracking | ✅ | `/track` — Order ID + phone, rate-limited, same “not found” for any mismatch, archived after 90 days, auto-refresh |
| Customer orders | ✅ | `/orders`, `/orders/[id]` |
| Order cancellation eligibility | ◐ | Order page shows whether the order can still be cancelled and links to “Ask the store to cancel”. SRS API-10: customer self-cancellation is out of scope in V2.1 |
| Return request, refund status | ✅ | Request from a delivered order inside the window (one per order, optional photo); `/customer/returns/[id]` shows refund history; escalation of rejected returns |
| Support ticket creation | ✅ | `/customer/support/new` — store or platform routing, urgent flag, attachment, reopen ≤7 days, escalate after 72 h |
| Notifications, saved addresses, profile | ✅ | `/customer/notifications`, `/profile` (details, 3 addresses with one default, password, account deletion) |
| Root platform is not a central catalogue | ✅ | Search returns stores; products are only listed inside one store |

## Merchant web (from Phase 1, extended)

All Phase 1 items remain (auth, onboarding with name/category/subdomain/logo/banner/tagline/theme/colour/preview, dashboard summaries and charts, product CRUD with images and variants, visibility, inventory with adjustments and history, orders with customer info and timeline, manual delivery status, customers, analytics, all five payment settings, store/shipping/notification settings, support, notifications, profile). Added in Phase 2:

| Item | Status | Where |
|---|---|---|
| Returns & refunds workflow | ✅ | `/merchant/returns` |
| Manual payment review (Option B) | ✅ | Order detail, audited reason required |
| Delivery-history CSV | ✅ | Orders page |
| Original / asking price | ◐ | Optional field next to Base price on the product form, with a live “Customers see ৳500 ~~৳650~~ 23% off” preview; must be above the base price. Shown struck-through with “% off” on store product cards, the detail page, the compare view and the merchant product list. **Display-only — checkout always charges the base price.** SRS §25 excludes discount pricing; added at the Project Owner's request (see SCHEMA_GAPS) |
| Duplicate product (FR-M-19) | ✅ | Copy button on every product row (web and Android) and on the product page. A dialog lets the merchant name the copy and choose whether to copy the images, original price and SKU. “Add product” also offers **Start from an existing product**. The copy is a hidden Draft with stock 0 (unit + e2e tested) |

## Super Admin web

| Brief item | Status | Where / notes |
|---|---|---|
| Super Admin login, TOTP verification | ✅ | `/admin/login` → `/admin/totp`; lockout after repeated failures |
| Protected admin routes | ✅ | Edge IP allowlist (fail-closed in production), role + AAL2 routing in Supabase mode, `RequireAdmin` guard, every service call re-checks |
| Admin dashboard, platform health | ✅ | `/admin/dashboard`, `/admin/system-health` |
| Merchant, customer, store management | ✅ | `/admin/merchants[/id]` (suspend with reason, reinstate, delete with `DELETE <email>`), `/admin/customers[/id]`, `/admin/stores` |
| Theme, announcement, policy management | ✅ | Theme delete blocked while in use; breaking change → 7-day notice; sent announcements immutable; policy dual approval |
| Support ticket oversight, dispute oversight | ✅ | `/admin/support[/id]`, `/admin/disputes[/kind/id]` |
| Authorized refund intervention | ✅ | `/admin/refunds` — audited, settlement needs a reference |
| Audit log viewing | ✅ | `/admin/audit-logs` — actor, action, resource, IP |
| Admin notifications, admin profile | ✅ | `/admin/notifications`, `/admin/profile` |
| Session timeout | ✅ | 30-minute idle: 2-minute warning modal, then sign-out; the service rejects stale sessions too |
| Confirmation modal for privileged actions | ✅ | Suspend, reinstate, delete, payment review, dispute actions, refund intervention, theme delete, announcement send/unschedule/delete, policy approve/publish |
| No ordinary order/delivery status changes | ✅ | Admin orders are read-only; the admin service has no status mutation (unit-tested). Only the separately audited payment review exists |

## Android app (one Capacitor app, three roles)

| Brief item | Status | Notes |
|---|---|---|
| Role from the authenticated session decides the stack | ✅ | `/` reads the session role → `/c`, `/home` or `/a/dashboard`; guards bounce a session into its own stack |
| Splash, role-aware login | ✅ | Welcome screen (Shop / Sell / Sign in / Platform admin); “Sign in” routes by role after authentication |
| Bottom navigation per role | ✅ | Customer: Home · Stores · Orders · Notifications · Profile. Merchant: Home · Products · Orders · Inventory · Analytics · More. Super Admin: Home · Merchants · Stores · Support · Audit Logs · More (route check verifies the labels) |
| Touch-friendly controls, pull-to-refresh | ✅ | Large tap targets and full-width actions; pull-to-refresh on every stack |
| Offline-friendly loading, empty and error states | ✅ | Offline bar, skeletons, empty and error states with retry |
| Push notifications | ✅ | Opt-in; FCM token sent to `notificationService.registerDevice`, removed on sign-out |
| Deep links, payment return links | ✅ | App Links for `bazarhq.com` and `*.bazarhq.com`; `bazarhq://order/…`, `bazarhq://store/…`, `bazarhq://payment/return?order=…` |
| Secure session storage | ✅ | Android Keystore via `capacitor-secure-storage-plugin`, passed to supabase-js as auth storage |
| Camera, filesystem | ✅ | Camera for product/logo/return photos; Filesystem + Share for CSV exports |
| No background geolocation | ✅ | No location plugin or permission |
| Customer screens (splash … addresses) | ✅ | Includes `/c/addresses` and the payment step / wallet-reference panel |
| Merchant screens | ✅ | Phase 1 screens + returns, payment review, CSV |
| Super Admin screens incl. network access verification | ✅ | `/a/network` → `/a/login` → `/a/totp`; blocked off the approved network |

## Shared service layer

The brief's named services are exposed by `createServiceLayer()` / `useServiceLayer()` (`packages/shared/src/services/named.ts`) as a typed view over the same implementation: `authService`, `merchantService`, `customerService`, `adminService`, `storeService`, `productService`, `inventoryService`, `orderService`, `paymentService`, `returnService`, `refundService`, `supportService`, `notificationService`, `analyticsService`. Switching `NEXT_PUBLIC_DATA_SOURCE` / `VITE_DATA_SOURCE` to `supabase` swaps the implementation without touching page components.

## Security requirements

| Requirement | How it is met |
|---|---|
| Protect all role routes / role-aware middleware | Client guards per role; `middleware.ts` gates `/admin` by IP and, in Supabase mode, routes by the session's role claim (and AAL2 for admins) |
| Validate permissions, order transitions, refunds server-side | The mock service re-checks role, tenant and state machine on every call (unit + e2e tested); Supabase mapping points each write at an Edge Function |
| RLS tenant isolation | Defined in the existing migrations and RLS matrix (unchanged) |
| Service-role key server-side only | Not present in any client/mobile code or build; `assertPublicAnonKey` refuses one; ESLint blocks the literal |
| Never trust client payment status, never decrement stock from the client | No client API accepts a payment status; stock changes only inside `placeOrder`/cancel/return services (unit-tested) |
| No client-side role assignment | `register` ignores any role; `accountType` only picks the signup flow (unit-tested) |
| Payment webhooks server-side | SSLCommerz completion goes through the session/webhook path, replay-protected |
| Audit privileged admin actions | Every privileged admin action writes `audit_logs` with actor and IP; ticket replies and status changes go to the ticket audit log |
| Secure Android token storage, no token logging | Keystore vault; no tokens are logged |
| Rate-limit-ready boundaries | Services return a typed `RATE_LIMITED` error (tracking already uses it) |

## Out of scope (not built, per brief and SRS §25)

Delivery Agent, affiliates/referrals, coupons, subscriptions, multi-currency, reviews/ratings, live chat, loyalty, AI recommendations, bundles, advanced SEO tools, background geolocation, merchant payouts/withdrawals, iOS, Play Store publication.
