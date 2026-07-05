
ALTER TABLE public.byon_requests
  ADD COLUMN IF NOT EXISTS twilio_bundle_sid text,
  ADD COLUMN IF NOT EXISTS twilio_end_user_sid text,
  ADD COLUMN IF NOT EXISTS twilio_supporting_document_sids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS twilio_status text,
  ADD COLUMN IF NOT EXISTS twilio_rejection_reason text,
  ADD COLUMN IF NOT EXISTS twilio_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS twilio_last_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS verification_fee_currency text DEFAULT 'usd',
  ADD COLUMN IF NOT EXISTS verification_fee_paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_fee_invoice_id text,
  ADD COLUMN IF NOT EXISTS verification_fee_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS byon_requests_twilio_bundle_sid_idx ON public.byon_requests(twilio_bundle_sid) WHERE twilio_bundle_sid IS NOT NULL;
