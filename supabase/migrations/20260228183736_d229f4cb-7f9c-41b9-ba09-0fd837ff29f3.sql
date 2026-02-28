
-- Create a public bucket for branding assets
INSERT INTO storage.buckets (id, name, public)
VALUES ('branding', 'branding', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to branding bucket
CREATE POLICY "Authenticated users can upload branding"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'branding');

-- Allow authenticated users to update branding files
CREATE POLICY "Authenticated users can update branding"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'branding');

-- Allow public read access to branding files
CREATE POLICY "Public can view branding"
ON storage.objects FOR SELECT
USING (bucket_id = 'branding');

-- Allow authenticated users to delete branding files
CREATE POLICY "Authenticated users can delete branding"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'branding');
