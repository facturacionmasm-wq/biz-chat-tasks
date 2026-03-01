
-- Create reminders table for scheduled reminders via WhatsApp
CREATE TABLE public.reminders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  user_id UUID NOT NULL,
  remind_at TIMESTAMP WITH TIME ZONE NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  source TEXT DEFAULT 'whatsapp'
);

-- Enable RLS
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

-- Service role manages reminders (edge functions)
CREATE POLICY "Service role manages reminders" ON public.reminders FOR ALL USING (true);

-- Users can view own reminders
CREATE POLICY "Users can view own reminders" ON public.reminders FOR SELECT USING (user_id = auth.uid());

-- Users can create own reminders
CREATE POLICY "Users can insert own reminders" ON public.reminders FOR INSERT WITH CHECK (user_id = auth.uid());

-- Index for efficient cron queries
CREATE INDEX idx_reminders_pending ON public.reminders (status, remind_at) WHERE status = 'pending';

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.reminders;
