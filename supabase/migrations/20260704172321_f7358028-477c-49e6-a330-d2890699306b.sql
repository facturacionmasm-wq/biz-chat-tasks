
CREATE POLICY "byon_storage_select_own_tenant"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'byon-requests'
    AND (
      (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );

CREATE POLICY "byon_storage_insert_own_tenant"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'byon-requests'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
  );

CREATE POLICY "byon_storage_delete_own_tenant"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'byon-requests'
    AND (
      (storage.foldername(name))[1] = public.get_user_tenant_id(auth.uid())::text
      OR public.has_role(auth.uid(), 'super_admin')
    )
  );
