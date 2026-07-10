-- contacts
DROP POLICY IF EXISTS "Tenant staff can manage contacts" ON public.contacts;
CREATE POLICY "Tenant staff can manage contacts" ON public.contacts
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()))
  WITH CHECK (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant users can view contacts" ON public.contacts;
CREATE POLICY "Tenant users can view contacts" ON public.contacts
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

-- push_subscriptions
DROP POLICY IF EXISTS "Users can manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users can manage own subscriptions" ON public.push_subscriptions
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- reminders
DROP POLICY IF EXISTS "Users can view own reminders"   ON public.reminders;
DROP POLICY IF EXISTS "Users can insert own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can update own reminders" ON public.reminders;
DROP POLICY IF EXISTS "Users can delete own reminders" ON public.reminders;
CREATE POLICY "Users can view own reminders"   ON public.reminders FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert own reminders" ON public.reminders FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update own reminders" ON public.reminders FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete own reminders" ON public.reminders FOR DELETE TO authenticated USING (user_id = auth.uid());

-- transfer_notifications (NO tocar policy INSERT service_role)
DROP POLICY IF EXISTS "Users can view own notifications"   ON public.transfer_notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.transfer_notifications;
CREATE POLICY "Users can view own notifications"   ON public.transfer_notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can update own notifications" ON public.transfer_notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());