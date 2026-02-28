
-- Drop the view approach
DROP VIEW IF EXISTS public.tenants_public;

-- Remove the public SELECT policy
DROP POLICY IF EXISTS "Public can read tenants for branding" ON public.tenants;

-- Create a secure function that returns only branding fields
CREATE OR REPLACE FUNCTION public.get_tenant_branding(_tenant_id uuid)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT json_build_object(
    'id', id,
    'name', name,
    'settings_json', settings_json
  )
  FROM public.tenants
  WHERE id = _tenant_id
  LIMIT 1;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION public.get_tenant_branding(uuid) TO anon, authenticated;
