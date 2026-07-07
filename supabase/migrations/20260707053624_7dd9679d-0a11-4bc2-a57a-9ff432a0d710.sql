CREATE POLICY "Staff can delete wa messages" ON public.whatsapp_messages
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));