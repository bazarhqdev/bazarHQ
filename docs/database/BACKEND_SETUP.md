# Backend setup

How to run the BazarHQ backend locally and deploy it to a Supabase project. Read [MIGRATIONS.md](MIGRATIONS.md) first if you have your own copies of migrations 001/002.

The original Stage 1 guide ([DATABASE_SETUP.md](DATABASE_SETUP.md)) still applies: never paste secrets into SQL, source control, chat, fixtures or client builds; never create a default Super Admin; keep payment credentials in Vault only.

## 1. Prerequisites

- Node.js 22, npm 10
- Docker Desktop (for `supabase start`)
- Supabase CLI: `npx supabase --version` (installed as a dev dependency, or `npm i -g supabase`)
- Deno 2 (only to type-check and test the Edge Functions locally: `deno check`, `deno test`)

## 2. Local stack

```bash
cp supabase/functions/.env.example supabase/functions/.env   # fill in CRON_SECRET, PAYMENT_SIMULATOR_SECRET
npx supabase start            # Postgres, Auth, PostgREST, Storage, Realtime, Studio, Edge runtime
npx supabase db reset         # applies migrations 001–015 + seed.sql (themes only)
npx supabase test db          # runs supabase/tests/*.test.sql (pgTAP)
npx supabase db lint --schema public,private
npx supabase functions serve --env-file supabase/functions/.env
```

`supabase status` prints the local API URL and the **anon** key. Put those, and nothing else from Supabase, into the apps:

```bash
# apps/web/.env.local
NEXT_PUBLIC_DATA_SOURCE=supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
ADMIN_IP_ALLOWLIST=127.0.0.1,::1

# apps/mobile/.env
VITE_DATA_SOURCE=supabase
VITE_SUPABASE_URL=http://10.0.2.2:54321      # Android emulator → host machine
VITE_SUPABASE_ANON_KEY=<anon key>
```

Auth settings (email confirmation, password rules, TOTP, the two auth hooks, Google, redirect URLs) are in `supabase/config.toml`. Local email confirmations appear in Inbucket at http://127.0.0.1:54324.

## 3. One-time database configuration

Run these in the SQL editor (Studio) **as `postgres`**. None of them belong in a migration, because they hold environment-specific values or secrets.

**Payment-credential encryption key (DB-05).** Merchants can't save bKash, Nagad, Rocket or SSLCommerz credentials until it exists:

```sql
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payment_credentials_key', 'BazarHQ payment credential encryption');
```

Back up the Vault before rotating this key; existing credentials are encrypted with it.

**Super Admin network allowlist (AUTH-08).** The gate fails closed while the list is empty:

```sql
insert into private.admin_ip_allowlist (cidr, note) values ('203.0.113.0/24', 'Office VPN');
-- Which header carries the client IP behind your proxy (default x-forwarded-for, last entry):
update private.app_settings set value = 'x-forwarded-for' where key = 'admin_ip_header';
update private.app_settings set value = 'last' where key = 'admin_ip_header_position';
```

Set the web app's `ADMIN_IP_ALLOWLIST` to the same ranges, and set the functions' `CLIENT_IP_HEADER` / `CLIENT_IP_POSITION` to match your proxy. Use a header your proxy overwrites, e.g. `cf-connecting-ip` behind Cloudflare.

**First Super Admin (no default account exists).**

1. Invite or create the user in Studio → Authentication (email confirmed).
2. Promote them, as `postgres`. This is audited as `profile.role_changed`:
   ```sql
   select private.grant_super_admin('<auth user uuid>', 'Initial platform administrator');
   ```
3. TOTP enrolment: sign in once with the password from a trusted machine and enrol an authenticator (Supabase Auth MFA: `auth.mfa.enroll({ factorType: 'totp' })`, then `challengeAndVerify`). `scripts/local-stack/adapter-flows.mts` (`bootstrapAdmin`) shows the exact calls. Until a verified factor exists, the admin sign-in screen refuses the account.
4. Policy publication needs **two** Super Admins (the submitter cannot approve), so create a second one the same way.

## 4. Scheduler (announcements and push)

Call `send-notification` every minute with the cron secret. With `pg_cron` + `pg_net` on the project (store the secret in Vault, not inline):

```sql
select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret', 'send-notification');
select cron.schedule('bazarhq-send-notification', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-notification',
    headers := jsonb_build_object('x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb);
$$);
```

In-app notifications and Realtime work without this; only scheduled announcements and FCM push need it.

## 5. Deploying to a Supabase project

```bash
npx supabase link --project-ref <ref>
npx supabase db push --dry-run         # review
npx supabase db push                   # take a backup first (DEP-07)
npx supabase functions deploy          # all functions; per-function verify_jwt comes from config.toml
npx supabase secrets set --env-file supabase/functions/.env   # APP_ENV=production, PAYMENT_PROVIDER_MODE=live, …
```

Then, in the dashboard:

- **Authentication → Hooks:** enable the *Custom access token* hook → `public.custom_access_token_hook`, and the *Password verification attempt* hook → `public.hook_password_verification_attempt`.
- **Authentication → MFA:** enable TOTP. **Providers:** Google client id and secret. **URL configuration:** site URL, `https://*.bazarhq.com/**` and `bazarhq://auth/callback`.
- **Email confirmations** on; custom SMTP for production mail.
- Run the one-time SQL from section 3.

Build the apps with the hosted URL and **anon** key only. `assertPublicAnonKey` stops a client build that was given a service-role key.

## 6. Docker-free verification (optional)

Where Docker images can't be pulled, two scripts reproduce the checks:

- `scripts/db-harness/run.sh [--lint]` builds a throwaway PostgreSQL 16 the way Supabase does (vendored init scripts plus small shims), applies every migration and runs every pgTAP file.
- `scripts/local-stack/start.sh` adds the real GoTrue and PostgREST binaries, the Edge Functions on Deno and a gateway with Supabase's URL layout. Then `npx tsx scripts/local-stack/adapter-flows.mts` exercises the frontend's service layer end to end, and `scripts/local-stack/web-smoke.mjs` drives the real web app in a browser. See `scripts/local-stack/README.md`.

These are verification aids. The supported workflow is the Supabase CLI above.
