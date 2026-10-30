// Pinned third-party imports for every Edge Function (one place to upgrade).
// Versions match packages/shared so request/response types stay in step.
export { createClient } from 'npm:@supabase/supabase-js@2.118.0';
export type { SupabaseClient, User } from 'npm:@supabase/supabase-js@2.118.0';
export { z } from 'npm:zod@4.6.7';
