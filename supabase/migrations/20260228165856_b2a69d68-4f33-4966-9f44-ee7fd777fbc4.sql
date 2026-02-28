-- Create a demo tenant for development
INSERT INTO tenants (id, name, timezone, whatsapp_config)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Demo Tenant',
  'America/Mexico_City',
  '{"provider": "twilio", "phone_number": "+12135132649"}'::jsonb
)
ON CONFLICT (id) DO UPDATE SET whatsapp_config = EXCLUDED.whatsapp_config;

-- Enable realtime for whatsapp tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;