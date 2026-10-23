# Remaining limitations

What this delivery does **not** do yet, and what each item needs. None of these were hidden in the UI; where a screen depends on one, it says so.

## Backend and data

1. **Mock data only.** Every screen runs on the typed mock service layer. `createSupabaseServices` is a contract plus an operation map (`SUPABASE_OPERATION_MAP`), not an implementation. Next step: implement it method by method against the existing tables, RLS and the Edge Functions listed in the map.
2. **Database not executed here.** Migrations 003/004 and the SQL tests are included unchanged (byte-identical to the attachments) but weren't run — there is no Postgres/Supabase CLI in the build environment. Migrations 001/002, the RLS tests, `STAGE_1_REPORT.md` and `config.toml` weren't attached; keep your copies and drop them into `supabase/` and `docs/reports/`.
3. **Schema gaps.** Fields the UI needs that Stage 1 doesn't define (return disputes, refund history, return method, product slug, theme notice date, store category/banner/shipping, SKU, …) are listed in `docs/reports/SCHEMA_GAPS.md`. They need a new migration and a Project Owner decision; no existing migration was edited.
4. **Product slugs** are derived from the product name because the SRS has no `products.slug` column. If two products in one store share a name, the older one owns the slug and the other is reached by id.
5. **One signed-in user per browser** in the mock (state lives in that browser's storage). Testing two roles at once needs two browsers or profiles, and data doesn't sync between browsers or devices.

## Integrations (simulated)

6. SMS/email, FCM delivery, bKash/Nagad/Rocket verification and the SSLCommerz gateway are simulated. The SSLCommerz page is an in-app sandbox; production redirects to the hosted gateway and confirms only via the signed IPN.
7. Realtime is simulated: in-browser events, and the tracking page polls every 20 seconds.
8. System health shows mock components and logs; production should read real monitoring.
9. Rate limiting exists only for public tracking in the mock; production needs an edge limiter on auth, tracking, checkout and admin endpoints (the services already return a typed `RATE_LIMITED` error).

## Web

10. Storefront and account pages render on the client because the mock lives in the browser. Server rendering for store SEO (FR-C-03 note) comes with the Supabase adapter.
11. In mock mode, role routing happens in client guards; `middleware.ts` enforces the admin IP allowlist and, in Supabase mode only, routes by the session's role claim. Authorization itself always belongs to RLS and the Edge Functions.
12. `X-Forwarded-For` must be overwritten by the trusted proxy in front of Next.js, otherwise a client could spoof the admin allowlist check.
13. Next.js 16 prefers `proxy.ts` over `middleware.ts`; the build prints a deprecation notice because the brief asked for `middleware.ts`.
14. CSP still allows inline scripts (Next.js bootstrap). Nonce-based CSP fits once pages are server-rendered.

## Android

15. **APK not built here.** `cap sync android` passes, but `gradlew assembleDebug` needs the Android SDK and Google Maven, which this environment doesn't have. Build it locally (README → Building the APK).
16. Push needs your `google-services.json` and `VITE_PUSH_ENABLED=true`. App Links need `/.well-known/assetlinks.json` on `bazarhq.com` and the store subdomains.
17. The mobile bundle is one ~1.4 MB chunk (customer and admin screens load lazily, but the shared UI library is common). It ships inside the APK, so it isn't downloaded over the network.

## Tooling

18. `npm audit` reports 8 advisories (3 moderate, 5 high), all in build-time tooling: `braces` via `eslint-config-next`, and `uuid` via `@capacitor/cli` → `xcode`. None ship in the web bundle or the APK. The suggested `--force` fixes are downgrades (eslint-config-next 14, @capacitor/cli 8.4), so they were not applied.
