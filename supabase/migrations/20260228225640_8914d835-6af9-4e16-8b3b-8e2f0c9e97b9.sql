
-- Transfer notifications table (in-app notifications)
CREATE TABLE public.transfer_notifications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  user_id UUID NOT NULL,
  call_record_id UUID REFERENCES public.call_records(id),
  title TEXT NOT NULL,
  summary TEXT,
  caller_phone TEXT,
  target_name TEXT,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.transfer_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
  ON public.transfer_notifications
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.transfer_notifications
  FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Service role inserts notifications"
  ON public.transfer_notifications
  FOR INSERT
  WITH CHECK (true);

-- Web Push subscriptions table
CREATE TABLE public.push_subscriptions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own subscriptions"
  ON public.push_subscriptions
  FOR ALL
  USING (user_id = auth.uid());

CREATE POLICY "Service role reads subscriptions"
  ON public.push_subscriptions
  FOR SELECT
  USING (true);

-- Enable realtime for transfer_notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.transfer_notifications;
