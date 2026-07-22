ALTER TABLE public.financial_connections ADD COLUMN IF NOT EXISTS external_item_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS financial_connections_provider_external_item_uidx
  ON public.financial_connections(provider, external_item_id)
  WHERE external_item_id IS NOT NULL;