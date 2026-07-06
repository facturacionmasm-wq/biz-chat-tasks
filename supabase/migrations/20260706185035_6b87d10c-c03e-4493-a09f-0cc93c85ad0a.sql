-- Add department column to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS department text;
COMMENT ON COLUMN public.profiles.department IS 'Área/departamento del miembro del equipo (Ventas, Soporte, Legal, etc.). Usado para enrutar transferencias de llamadas y agrupar equipo.';

-- Recreate profiles_safe view to include department
DROP VIEW IF EXISTS public.profiles_safe;

CREATE VIEW public.profiles_safe
WITH (security_invoker = on) AS
  SELECT id, user_id, tenant_id, name, email, phone, whatsapp_number,
         avatar_url, status, department, created_at, updated_at
  FROM public.profiles;

GRANT SELECT ON public.profiles_safe TO authenticated;
GRANT SELECT ON public.profiles_safe TO service_role;
