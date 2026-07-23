-- Prevent anonymous listing of branding bucket while preserving public URL fetches
DROP POLICY IF EXISTS "Public can view branding" ON storage.objects;