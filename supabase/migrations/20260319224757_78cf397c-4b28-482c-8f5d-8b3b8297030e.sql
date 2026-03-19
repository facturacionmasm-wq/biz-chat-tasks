INSERT INTO public.profiles (user_id, tenant_id, name, email, onboarding_completed, status)
VALUES ('2f5fa519-844a-4f01-8888-f1aa69ba907e', '00000000-0000-0000-0000-000000000001', 'Admin', 'admin@rybixholding.com', true, 'active')
ON CONFLICT (user_id) DO UPDATE SET tenant_id = '00000000-0000-0000-0000-000000000001', status = 'active', onboarding_completed = true;

INSERT INTO public.user_roles (user_id, tenant_id, role)
VALUES ('2f5fa519-844a-4f01-8888-f1aa69ba907e', '00000000-0000-0000-0000-000000000001', 'super_admin')
ON CONFLICT (user_id, tenant_id, role) DO NOTHING;