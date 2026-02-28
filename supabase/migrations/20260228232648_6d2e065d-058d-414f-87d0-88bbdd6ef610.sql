
-- Drop overly permissive public policies on WhatsApp tables
DROP POLICY IF EXISTS "Public read wa conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Public insert wa conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Public update wa conversations" ON public.whatsapp_conversations;
DROP POLICY IF EXISTS "Public read wa messages" ON public.whatsapp_messages;
DROP POLICY IF EXISTS "Public insert wa messages" ON public.whatsapp_messages;
