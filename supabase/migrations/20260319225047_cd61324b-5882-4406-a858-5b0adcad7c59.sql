CREATE OR REPLACE FUNCTION public.tmp_reset_admin_password()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE auth.users 
  SET encrypted_password = extensions.crypt('Marco1526', extensions.gen_salt('bf'))
  WHERE id = '2f5fa519-844a-4f01-8888-f1aa69ba907e';
END;
$$;

SELECT public.tmp_reset_admin_password();

DROP FUNCTION public.tmp_reset_admin_password();