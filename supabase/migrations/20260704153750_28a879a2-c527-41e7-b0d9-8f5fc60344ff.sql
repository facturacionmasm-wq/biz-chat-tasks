CREATE UNIQUE INDEX IF NOT EXISTS uniq_tenants_whatsapp_phone
ON public.tenants ((whatsapp_config->>'phone_number'))
WHERE whatsapp_config->>'phone_number' IS NOT NULL;