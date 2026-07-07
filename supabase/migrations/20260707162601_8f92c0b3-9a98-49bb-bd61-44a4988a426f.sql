
ALTER TABLE public.call_costs
  ADD COLUMN IF NOT EXISTS tts_chars integer,
  ADD COLUMN IF NOT EXISTS stt_secs numeric,
  ADD COLUMN IF NOT EXISTS elevenlabs_cost_usd numeric;

ALTER TABLE public.call_records
  ADD COLUMN IF NOT EXISTS cost_total numeric,
  ADD COLUMN IF NOT EXISTS ai_tokens_used integer;

ALTER TABLE public.stripe_customers
  ADD COLUMN IF NOT EXISTS stripe_item_id_voice text,
  ADD COLUMN IF NOT EXISTS stripe_item_id_whatsapp text;
