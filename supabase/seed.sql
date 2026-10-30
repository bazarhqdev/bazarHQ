-- Local / development seed (runs on `supabase db reset`).
--
-- Starter storefront themes only, the same set the frontend's mock data uses,
-- so merchant onboarding has something to choose on a fresh database
-- (FR-M-12). Themes are platform content managed by the Super Admin (FR-SA-14);
-- in production create them from the admin console instead, or run this file
-- once.
--
-- This seed creates NO accounts: no Super Admin, merchant or customer, and no
-- credentials of any kind (DATABASE_SETUP.md).
insert into public.themes (name, description, accent, is_active) values
  ('Default', 'Balanced layout with a hero banner and product grid.', '#0B1F3A', true),
  ('Modern', 'Bold imagery, rounded cards and large category tiles.', '#059669', true),
  ('Minimal', 'Quiet typography with lots of white space.', '#334155', true),
  ('Classic', 'Traditional storefront with a top category menu.', '#92400E', true),
  ('Grocery', 'Quick-add buttons and dense listings for daily needs.', '#16A34A', true),
  ('Fashion', 'Editorial layout for apparel and lookbooks.', '#BE185D', true)
on conflict (name) do nothing;
