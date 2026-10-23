# BazarHQ — multi-merchant e-commerce SaaS (SRS V2.1)

One repository with all three active roles:

| Role | Web (Next.js) | Android (Capacitor) |
|---|---|---|
| **Customer** (and guests) | `/` store discovery, `/store/<subdomain>/…` storefront (`/products/[slug]`), cart, checkout, `/track`, `/customer`, `/orders`, `/profile` | `/c/…` stack |
| **Merchant** | `/merchant/…` portal | merchant stack (`/home`, `/products`, `/orders`, `/returns`…) |
| **Super Admin** | `/admin/…` console (network gate + TOTP + 30-min idle) | `/a/…` stack |

Everything runs on **typed mock services** that behave like the trusted server (validation, state machines, tenant ownership, idempotency, audit). A Supabase adapter can replace them behind the same `PlatformServices` contract (`packages/shared/src/services/contracts.ts`). The SRS (`docs/SRS/BazarHQ_SRS_V2.1_Final.docx`) is the authority for every rule.

> **About the brief.** The Phase 2 prompt was truncated after the canonical order-status list. The rest of the Customer, Super Admin and mobile scope was taken from SRS §11, §12, §14, §15 and §16. Out-of-scope items (Delivery Agent, affiliates, coupons, subscriptions, multi-currency, reviews, live chat, loyalty, AI, bundles, SEO tools, background geolocation, payouts, iOS, Play Store) are not built.

## Requirements

- Node.js **22+**, npm 10+
- APK only: Android Studio / Android SDK with JDK 21

## Quick start

```bash
npm install
npm run dev:web      # http://localhost:3000            (customer site)
                     # http://localhost:3000/merchant/login
                     # http://localhost:3000/admin/login
npm run dev:mobile   # http://localhost:5173            (Android SPA in a browser; use the device toolbar)
```

In development `/admin` is open from any IP. With `next start` (production mode) the edge middleware **fails closed** unless `ADMIN_IP_ALLOWLIST` is set:

```bash
npm run build:web
ADMIN_IP_ALLOWLIST=127.0.0.1 npm run start:web      # PowerShell: $env:ADMIN_IP_ALLOWLIST="127.0.0.1"; npm run start:web
```

### Demo accounts (mock data only — not database seeds)

These exist only inside the mock service. They are **not** created in Supabase, and DATABASE_SETUP.md's rule stands: no default Super Admin account is ever seeded.

| Email | Password | Shows |
|---|---|---|
| `customer@bazarhq.test` | `Customer123` | Fahim — orders in three stores, a return-eligible order, a rejected return under dispute, a Rocket payment awaiting review, 2 saved addresses, tickets |
| `merchant@bazarhq.test` | `Merchant123` | Green Basket (published): orders, stock, returns/refunds, tickets |
| `fashion@bazarhq.test` | `Merchant123` | Fashion Point (published) |
| `new@bazarhq.test` | `Merchant123` | Onboarding (no store yet) |
| `unverified@bazarhq.test` | `Merchant123` | Email-verification gate |
| `suspended@bazarhq.test` | `Merchant123` | Suspended merchant (Kids Heaven) |
| `admin@bazarhq.test` | `Admin12345` | Super Admin · TOTP `246810` |
| `admin2@bazarhq.test` | `Admin12345` | Second Super Admin (policy dual approval) · TOTP `246810` |

- Guests can browse and check out without an account. Tracking needs the Order ID **and** the checkout phone.
- Super Admins must use `/admin/login`; the customer/merchant sign-in rejects them.
- The admin login's **Demo controls** can simulate an unapproved network; the console header has **Demo: expire session** to show the idle timeout.
- Mock data is per browser (localStorage). Reset it from the merchant sidebar → **Reset demo data**.
- bKash/Nagad transaction IDs auto-verify in the mock (IDs starting with `FAIL` are rejected); Rocket goes to manual review; SSLCommerz opens a sandbox page.

## Repository layout

```
BazarHQ/
├─ apps/
│  ├─ web/                    Next.js 16 (App Router), Tailwind v4
│  │  ├─ app/(public)          /, /stores, /track, /policies/[type]
│  │  ├─ app/(auth)            /login, /register, /verify-email, /forgot-password
│  │  ├─ app/(customer)        /cart, /checkout, (account)/customer/…, /orders, /profile
│  │  ├─ app/(merchant)/merchant/…  merchant portal (+ /merchant/returns)
│  │  ├─ app/(admin)/admin/…   login, totp, (console)/dashboard … audit-logs
│  │  ├─ app/store/[subdomain] storefront, products, cart, checkout, order-success
│  │  ├─ app/payment/sslcommerz-sandbox
│  │  ├─ components/{shared,customer,merchant,admin}, lib/
│  │  └─ middleware.ts         subdomain rewrite, admin IP allowlist, CSP/HSTS
│  └─ mobile/                 Vite + React + Capacitor 8 (Android)
│     ├─ src/app, navigation (role shells), features/{customer,merchant,admin}, services/native.ts
│     ├─ android/              minSdk 26, targetSdk 34, App Links + bazarhq:// deep links
│     └─ capacitor.config.ts
├─ packages/
│  ├─ shared/   types, constants, permissions, validation (Zod), transitions, formatters,
│  │            services/{contracts, named, mock/*, supabase} + 51 unit tests
│  ├─ ui/       design system (Button, Card, Table, Modal, Badge, FormField, LoadingState…),
│  │            charts (Recharts), RHF+Zod helpers, features/{customer,admin,…} shared by web & Android
│  └─ config/   shared ESLint + TypeScript configs
├─ docs/      API/, database/ (schema, setup, RLS matrix, Option B), ERD/, reports/ (SCHEMA_GAPS, FEATURE_COMPLETION, ROUTE_VERIFICATION, LIMITATIONS), SRS/
├─ supabase/  migrations (003, 004), tests (*.test.sql), functions/
└─ scripts/   Playwright route checks and end-to-end flows
```

**Keep your own copies** of the files that weren't attached to this brief: migrations `001`/`002`, the RLS tests, `STAGE_1_REPORT.md` and `supabase/config.toml`. Nothing here deletes or rewrites them — drop them into `supabase/` and `docs/reports/` as before.

## What each role can do

**Customer (SRS §11, §14, §15)**
- Store discovery by name, subdomain or pasted link — stores only, never a cross-store catalogue. Unknown, draft and suspended stores all show the same “Store unavailable” page.
- Storefront with the store's brand colour, categories, search, price/stock filters, sorting; product detail with gallery zoom, variants (sold-out options disabled), “Only N left”, original price with “% off”, and a compare bar on every product card and detail page that opens a side-by-side table (up to 3 products of the same store).
- **Per-store carts** in local storage; quantity capped to stock; price-change banner (FR-C-12).
- **3-step checkout** (delivery → payment → review) with BD phone validation, all 64 districts, saved-address prefill, only the store's enabled methods, policy links, idempotent order placement. COD; bKash/Nagad/Rocket transaction-ID submission (→ `pending_verification`, never “paid” from the client); SSLCommerz sandbox.
- Order success page, public tracking (Order ID + phone, rate-limited, same “not found” for any mismatch, archived after 90 days, auto-refresh).
- Account: dashboard, order history, order timeline, **return requests** with photo, escalation of rejected returns, refund status, **support tickets** (store vs platform routing, urgent flag, reopen within 7 days, escalate after 72 h), notifications, profile, 3 saved addresses with one default, password change, account deletion.

**Merchant** — everything from Phase 1, plus **Returns & refunds** (approve/reject with reason, return method, receipt with optional restock, refund creation, processing/failed, settlement with reference), **manual payment review** on the order page (Option B, audited), and a **delivery-history CSV**. Products also have an optional **original / asking price** next to the base price, with a live “% off” preview. It is display-only: checkout charges the base price, and SRS §25 needs a change note (see `docs/reports/SCHEMA_GAPS.md`). There is also **Duplicate** on every product row and product page: name the copy and choose whether to copy the images, original price and SKU; the copy is a Draft with stock 0. *Add product* can also start from an existing product.

**Super Admin (SRS §12)** — approved-network check → password → TOTP; 30-minute idle warning and sign-out. Dashboard (GMV, stores, orders, customers, top stores, payment mix, alerts), system health, merchants (suspend with reason → sessions ended + store unpublished; reinstate; delete with `DELETE <email>`), customers, stores, **read-only** orders (+ audited manual payment review), themes (delete blocked while in use; breaking change → 7-day notice), announcements (draft / schedule / send; sent can't be edited or deleted), policies (**dual approval** — the submitter can't approve), support queue, disputes (request info / override / uphold), refund intervention, append-only audit log with actor IP.

**Android** — one app. The welcome screen offers Shop / Sell / Sign in / Platform admin; after sign-in the **role in the session** picks the stack, and each stack has the bottom navigation from the brief:

| Role | Bottom navigation |
|---|---|
| Customer | Home · Stores · Orders · Notifications · Profile (Profile holds returns, support, addresses, carts, settings) |
| Merchant | Home · Products · Orders · Inventory · Analytics · More |
| Super Admin | Home · Merchants · Stores · Support · Audit Logs · More — reached only via the network check (`/a/network`) → password → TOTP |

Every stack has pull-to-refresh, offline banner, skeletons, empty and error states. Native features:
- **Camera** (`@capacitor/camera`) for product, logo and return photos — permission asked at the moment of use.
- **Filesystem + Share** for CSV exports.
- **Push** (`@capacitor/push-notifications`) — opt-in; the FCM token is sent to `notifications.registerDevice` and removed on sign-out.
- **Deep links** — App Links for `https://bazarhq.com/…` and `https://<store>.bazarhq.com/…` plus `bazarhq://order/<ORD-…>`, `bazarhq://store/<sub>`, `bazarhq://payment/return?order=…`.
- **Secure storage** — `capacitor-secure-storage-plugin` (Android Keystore) is the Supabase auth storage; tokens never go to localStorage/Preferences.
- External pages (payment gateway) open in a Custom Tab (`@capacitor/browser`). Backups are disabled.

## Services

Pages use one typed contract, `PlatformServices`. The brief's named services are a typed view over it — `createServiceLayer()` (shared) or `useServiceLayer()` (UI) returns `authService`, `merchantService`, `customerService`, `adminService`, `storeService`, `productService`, `inventoryService`, `orderService`, `paymentService`, `returnService`, `refundService`, `supportService`, `notificationService` and `analyticsService`. Mock data lives only in `packages/shared/src/services/mock/`.

## Scripts

| Command | What it does |
|---|---|
| `npm run format` / `format:check` | Prettier (TypeScript, CSS, scripts; SQL, docs and migrations are excluded) |
| `npm run typecheck` | `tsc` in every workspace |
| `npm run lint` | ESLint (incl. a rule that rejects any `service_role` literal in client code) |
| `npm test` | 51 unit tests: state machines, validation, stock, mock-service rules for all three roles, and the brief's security invariants (invalid transitions blocked, client can't set payment status, no client role assignment) |
| `npm run build` | Next.js production build + Vite SPA build |
| `npm run check` | Format check, typecheck, lint, tests, builds |
| `npm run verify:routes` | Playwright: every customer, merchant and admin route at 1366 px and 360 px (status, `<h1>`, console errors, horizontal overflow) plus role guards. Needs the web server running with `ADMIN_IP_ALLOWLIST` |
| `npm run e2e:web` | Playwright: end-to-end flows across all roles (checkout COD/bKash, per-store carts, tracking privacy, returns/refunds, tickets, address cap, TOTP, suspension, theme rule, dual approval, dispute override, audit log) |
| `npm run verify:mobile` | Playwright: every Android-SPA route for all three role stacks at 360 px, plus each role's bottom-navigation labels. Needs `npm run preview:mobile` |
| `npm run report:verification` | Writes `docs/reports/ROUTE_VERIFICATION.md` from the JSON the three scripts above write when `REPORT_DIR=verification` is set |
| `npm run cap:sync` | Build the SPA and sync it into `apps/mobile/android` |
| `npm run db:start / db:reset / db:test` | Supabase CLI (local) — migrations and SQL tests |

Set `BASE_URL` (default `http://localhost:3000` / `:4173`) and optionally `CHROMIUM_PATH`.

## Building the APK

```bash
cd apps/mobile
cp .env.example .env
npm run cap:sync
cd android && ./gradlew assembleDebug        # Windows: .\gradlew.bat assembleDebug
```

Release signing reads `BAZARHQ_KEYSTORE_PATH/PASSWORD` and `BAZARHQ_KEY_ALIAS/PASSWORD` from the environment. For push, add `android/app/google-services.json` and set `VITE_PUSH_ENABLED=true`. App Links need `/.well-known/assetlinks.json` on `bazarhq.com` and each store subdomain.

## Security notes

- **No service-role key anywhere in client code, mobile code, APKs, browser env vars or this repo.** `assertPublicAnonKey` refuses a service-role JWT at start-up, and ESLint blocks the literal.
- Client checks are UX only. Every mock service call re-checks role, ownership, state transitions and inputs the way the Edge Functions/RLS must.
- `/admin/*`: IP allowlist at the edge (`middleware.ts`, fail-closed in production) + Supabase MFA (AAL2) + 30-minute idle timeout. The proxy in front of Next.js must overwrite `X-Forwarded-For`.
- Payment credentials are write-only (masked hints only). Wallet transaction IDs from customers are untrusted; only server verification or an audited manual review marks a payment paid. SSLCommerz is confirmed only by the signed IPN, never the redirect.
- CSP, HSTS (production), `X-Frame-Options: DENY`, `noindex` + `no-store` on admin pages.
- Next.js 16 renames `middleware.ts` to `proxy.ts`; the brief asks for `middleware.ts`, so it's kept (the build prints a deprecation notice). Renaming the file is the only change needed.

## Connecting Supabase

Implement `createSupabaseServices` (`packages/shared/src/services/supabase/index.ts`) against `SUPABASE_OPERATION_MAP`, which maps every service method to the table/RLS read or Edge Function it needs. Set `NEXT_PUBLIC_DATA_SOURCE=supabase` / `VITE_DATA_SOURCE=supabase`. The fields the UI uses that Stage 1 doesn't define are listed in `docs/reports/SCHEMA_GAPS.md` — they need a new migration, not edits to the existing ones.

## Verification (this delivery)

Full results, including every route and the commands below, are in `docs/reports/ROUTE_VERIFICATION.md`. What is built against each line of the brief is in `docs/reports/FEATURE_COMPLETION.md`; what isn't, in `docs/reports/LIMITATIONS.md`.

| Check | Result |
|---|---|
| `npm install`, format check, lint, typecheck (all workspaces) | Pass |
| Unit tests | 51 / 51 |
| `npm run build` (Next.js + Vite) | Pass |
| `npm run dev:web` / `npm run dev:mobile` | Both start; sampled routes return 200 |
| Web route checks — every Customer, Merchant and Super Admin route at desktop and phone width, plus role guards | 137 / 137 |
| Web end-to-end flows across all roles | 29 / 29 |
| Android-SPA route checks, all three stacks, incl. each role's bottom-navigation labels | 57 / 57 |
| `npm run cap:sync` | Pass (9 plugins) |
| Migrations 003/004 and the three SQL test files | Byte-identical to the attached originals |
| Service-role key in client/mobile code or builds | None (the only match in the web bundle is the guard's detection string) |
| APK (`gradlew assembleDebug`) | **Not run** — no Android SDK or Google Maven access here |

