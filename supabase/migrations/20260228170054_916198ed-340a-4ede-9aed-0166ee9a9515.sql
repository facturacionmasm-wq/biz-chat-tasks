-- Temporary public access policies for demo (no auth yet)
CREATE POLICY "Public read wa conversations" ON public.whatsapp_conversations FOR SELECT USING (true);
CREATE POLICY "Public insert wa conversations" ON public.whatsapp_conversations FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update wa conversations" ON public.whatsapp_conversations FOR UPDATE USING (true);
CREATE POLICY "Public read wa messages" ON public.whatsapp_messages FOR SELECT USING (true);
CREATE POLICY "Public insert wa messages" ON public.whatsapp_messages FOR INSERT WITH CHECK (true);