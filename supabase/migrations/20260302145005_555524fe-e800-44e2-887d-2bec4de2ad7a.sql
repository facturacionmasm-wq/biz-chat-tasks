
-- Add missing columns to tenant_drive_settings (ignore errors if they exist)
ALTER TABLE public.tenant_drive_settings 
  ADD COLUMN IF NOT EXISTS drive_budgets_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_receipts_folder_id text,
  ADD COLUMN IF NOT EXISTS drive_structure_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS drive_provider text NOT NULL DEFAULT 'google',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

-- Create drive_audit_log if not exists
CREATE TABLE IF NOT EXISTS public.drive_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  resource_type text NOT NULL DEFAULT 'file',
  resource_id text,
  resource_name text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.drive_audit_log ENABLE ROW LEVEL SECURITY;

-- RLS for drive_audit_log (use IF NOT EXISTS via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'drive_audit_log' AND policyname = 'Admins can view drive audit'
  ) THEN
    CREATE POLICY "Admins can view drive audit"
    ON public.drive_audit_log
    FOR SELECT
    TO authenticated
    USING (
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
      OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
      OR has_role(auth.uid(), 'super_admin'::app_role)
    );
  END IF;
END $$;
