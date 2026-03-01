-- Fix: Scope USING(true) policies to service_role only

-- audit_events
DROP POLICY IF EXISTS "Service role writes audit" ON public.audit_events;
CREATE POLICY "Service role writes audit"
  ON public.audit_events FOR INSERT TO service_role
  WITH CHECK (true);

-- call_events
DROP POLICY IF EXISTS "Service role writes call events" ON public.call_events;
CREATE POLICY "Service role writes call events"
  ON public.call_events FOR INSERT TO service_role
  WITH CHECK (true);

-- contacts
DROP POLICY IF EXISTS "Service role manages contacts" ON public.contacts;
CREATE POLICY "Service role manages contacts"
  ON public.contacts FOR ALL TO service_role
  USING (true);

-- expenses
DROP POLICY IF EXISTS "Service role manages expenses" ON public.expenses;
CREATE POLICY "Service role manages expenses"
  ON public.expenses FOR ALL TO service_role
  USING (true);

-- otp_challenges
DROP POLICY IF EXISTS "Service role manages OTP" ON public.otp_challenges;
CREATE POLICY "Service role manages OTP"
  ON public.otp_challenges FOR ALL TO service_role
  USING (true);

-- push_subscriptions
DROP POLICY IF EXISTS "Service role reads subscriptions" ON public.push_subscriptions;
CREATE POLICY "Service role reads subscriptions"
  ON public.push_subscriptions FOR SELECT TO service_role
  USING (true);

-- shared_credentials
DROP POLICY IF EXISTS "Service role manages credentials" ON public.shared_credentials;
CREATE POLICY "Service role manages credentials"
  ON public.shared_credentials FOR ALL TO service_role
  USING (true);

-- tenant_subscriptions
DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.tenant_subscriptions;
CREATE POLICY "Service role manages subscriptions"
  ON public.tenant_subscriptions FOR ALL TO service_role
  USING (true);

-- transfer_notifications
DROP POLICY IF EXISTS "Service role inserts notifications" ON public.transfer_notifications;
CREATE POLICY "Service role inserts notifications"
  ON public.transfer_notifications FOR INSERT TO service_role
  WITH CHECK (true);