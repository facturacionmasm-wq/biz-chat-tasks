-- Dedupe active profiles that share the same whatsapp_number within the same tenant,
-- keeping only the most recently updated row and clearing the number on the rest.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, whatsapp_number
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.profiles
  WHERE whatsapp_number IS NOT NULL
    AND status = 'active'
)
UPDATE public.profiles p
SET whatsapp_number = NULL,
    updated_at = now()
FROM ranked r
WHERE p.id = r.id
  AND r.rn > 1;

-- Enforce one active WhatsApp number per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_wa_unique_per_tenant
  ON public.profiles (tenant_id, whatsapp_number)
  WHERE whatsapp_number IS NOT NULL AND status = 'active';
