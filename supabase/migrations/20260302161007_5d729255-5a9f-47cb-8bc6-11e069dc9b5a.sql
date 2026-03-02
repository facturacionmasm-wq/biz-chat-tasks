-- Structured logs for WhatsApp webhook/bot pipeline
CREATE TABLE IF NOT EXISTS public.webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  provider text NOT NULL DEFAULT 'whatsapp',
  message_id text NULL,
  conversation_id uuid NULL,
  stage text NOT NULL,
  status text NOT NULL,
  error text NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

-- Admin/owner/super_admin can inspect webhook logs within their tenant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'webhook_logs'
      AND policyname = 'Admins can view webhook logs'
  ) THEN
    CREATE POLICY "Admins can view webhook logs"
    ON public.webhook_logs
    FOR SELECT
    USING (
      tenant_id = get_user_tenant_id(auth.uid())
      AND (
        has_tenant_role(auth.uid(), tenant_id, 'owner')
        OR has_tenant_role(auth.uid(), tenant_id, 'admin')
        OR has_role(auth.uid(), 'super_admin')
      )
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_webhook_logs_tenant_created_at
  ON public.webhook_logs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_message_id
  ON public.webhook_logs (message_id);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_stage_status
  ON public.webhook_logs (stage, status);
