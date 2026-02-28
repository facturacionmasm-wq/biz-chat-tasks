
-- Add PIN hash column to profiles for employee authentication via WhatsApp
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS pin_hash text;

-- Add conversation state to track bot flow (welcome, client_mode, employee_auth, employee_mode)
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS bot_state text DEFAULT 'welcome';
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS bot_context jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.whatsapp_conversations ADD COLUMN IF NOT EXISTS verified_user_id uuid;

-- Create expenses table for employee expense tracking via WhatsApp OCR
CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  user_id uuid NOT NULL,
  category text,
  description text,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  receipt_url text,
  ocr_data jsonb DEFAULT '{}'::jsonb,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'pending',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Users can view their own expenses
CREATE POLICY "Users can view own expenses"
  ON public.expenses FOR SELECT
  USING (user_id = auth.uid() OR tenant_id = get_user_tenant_id(auth.uid()));

-- Users can insert own expenses
CREATE POLICY "Users can insert own expenses"
  ON public.expenses FOR INSERT
  WITH CHECK (user_id = auth.uid() OR tenant_id = get_user_tenant_id(auth.uid()));

-- Users can update own expenses
CREATE POLICY "Users can update own expenses"
  ON public.expenses FOR UPDATE
  USING (user_id = auth.uid());

-- Service role can manage expenses (for bot)
CREATE POLICY "Service role manages expenses"
  ON public.expenses FOR ALL
  USING (true);

-- Enable realtime for conversations (bot state updates)
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;

-- Trigger for updated_at
CREATE TRIGGER update_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
