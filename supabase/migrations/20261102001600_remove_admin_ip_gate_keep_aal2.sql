-- Remove IP allowlisting from Super Admin authorization.
-- Keep the active profile role check and mandatory AAL2 (TOTP).
-- Existing RLS policies continue to call public.is_super_admin() unchanged.
-- Legacy IP tables/helpers remain dormant for audit/history compatibility.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.role = 'super_admin'
      AND p.status = 'active'
  )
  AND COALESCE((SELECT auth.jwt()) ->> 'aal', '') = 'aal2';
$function$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'Requires an active Super Admin profile and AAL2 (TOTP). Network allowlisting is not used.';
