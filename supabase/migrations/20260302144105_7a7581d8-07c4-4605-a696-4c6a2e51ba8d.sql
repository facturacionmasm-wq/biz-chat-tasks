
-- =====================================================
-- PHASE 1: Extend expenses + create expense_reminders + tenant_drive_settings
-- =====================================================

-- 1) Add new columns to expenses table
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'expense',
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approver_user_id uuid,
  ADD COLUMN IF NOT EXISTS approver_phone text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS folio text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS document_budget_drive_file_id text,
  ADD COLUMN IF NOT EXISTS document_budget_drive_url text,
  ADD COLUMN IF NOT EXISTS document_payment_drive_file_id text,
  ADD COLUMN IF NOT EXISTS document_payment_drive_url text,
  ADD COLUMN IF NOT EXISTS drive_folder_id text;

-- 2) Create expense_reminders table
CREATE TABLE IF NOT EXISTS public.expense_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  expense_id uuid NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL,
  recipient_phone text,
  reminder_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expense_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view expense reminders"
  ON public.expense_reminders FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "System can manage expense reminders"
  ON public.expense_reminders FOR ALL
  TO service_role
  USING (true);

-- 3) Create tenant_drive_settings table (prepared for Phase 2)
CREATE TABLE IF NOT EXISTS public.tenant_drive_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  drive_root_folder_id text,
  drive_root_folder_url text,
  drive_structure_version integer NOT NULL DEFAULT 1,
  drive_provider text NOT NULL DEFAULT 'google',
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_drive_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage drive settings"
  ON public.tenant_drive_settings FOR ALL
  TO authenticated
  USING (
    has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)
    OR has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "Tenant users can view drive settings"
  ON public.tenant_drive_settings FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));
