
-- Add country/region/currency columns to tenants for multi-region onboarding
ALTER TABLE public.tenants 
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'MX',
  ADD COLUMN IF NOT EXISTS region text NOT NULL DEFAULT 'LATAM',
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'MXN';
