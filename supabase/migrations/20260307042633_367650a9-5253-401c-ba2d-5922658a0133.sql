
-- Documents metadata table for tracking all uploaded files
CREATE TABLE public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  conversation_id uuid NULL,
  user_id uuid NULL,
  contact_phone text NULL,
  
  -- File identity
  original_filename text NOT NULL DEFAULT 'archivo',
  normalized_filename text NULL,
  mime_type text NULL,
  extension text NULL,
  file_size bigint NULL,
  file_hash text NULL,
  
  -- Google Drive references
  google_drive_file_id text NULL,
  google_drive_folder_id text NULL,
  google_drive_url text NULL,
  parent_folder_path text NULL,
  
  -- Classification
  document_type text NULL DEFAULT 'other',
  document_category text NULL,
  classification_confidence numeric NULL DEFAULT 0,
  
  -- Analysis
  extracted_text text NULL,
  analysis_summary text NULL,
  extracted_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
  key_amounts jsonb NOT NULL DEFAULT '[]'::jsonb,
  risks jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  
  -- Processing status
  upload_status text NOT NULL DEFAULT 'pending',
  analysis_status text NOT NULL DEFAULT 'pending',
  ocr_status text NULL DEFAULT 'not_required',
  
  -- Versioning
  version_number integer NOT NULL DEFAULT 1,
  parent_document_id uuid NULL REFERENCES public.documents(id),
  
  -- Linked entities
  expense_id uuid NULL,
  appointment_id uuid NULL,
  
  -- Source
  source_channel text NOT NULL DEFAULT 'whatsapp',
  
  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

-- Indexes
CREATE INDEX idx_documents_tenant ON public.documents(tenant_id);
CREATE INDEX idx_documents_type ON public.documents(tenant_id, document_type);
CREATE INDEX idx_documents_hash ON public.documents(tenant_id, file_hash);
CREATE INDEX idx_documents_drive_file ON public.documents(google_drive_file_id);
CREATE INDEX idx_documents_contact ON public.documents(tenant_id, contact_phone);

-- RLS
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Service role full access (for bot/edge functions)
CREATE POLICY "Service role full access on documents"
  ON public.documents FOR ALL
  USING (true)
  WITH CHECK (true);

-- Tenant members can read
CREATE POLICY "Tenant members can view documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Admins can manage
CREATE POLICY "Admins can manage documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (
    tenant_id = get_user_tenant_id(auth.uid()) AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role) OR
      has_role(auth.uid(), 'super_admin'::app_role)
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id(auth.uid()) AND (
      has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR
      has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role) OR
      has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- Document processing queue table
CREATE TABLE public.document_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  job_type text NOT NULL DEFAULT 'full_analysis',
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text NULL,
  result_data jsonb NULL DEFAULT '{}'::jsonb,
  run_after timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_jobs_status ON public.document_jobs(status, run_after);

ALTER TABLE public.document_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on document_jobs"
  ON public.document_jobs FOR ALL
  USING (true)
  WITH CHECK (true);

-- Document alerts table
CREATE TABLE public.document_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  alert_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  title text NOT NULL,
  description text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_document_alerts_tenant ON public.document_alerts(tenant_id, resolved);

ALTER TABLE public.document_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view document alerts"
  ON public.document_alerts FOR SELECT
  TO authenticated
  USING (tenant_id = get_user_tenant_id(auth.uid()));

CREATE POLICY "Service role full access on document_alerts"
  ON public.document_alerts FOR ALL
  USING (true)
  WITH CHECK (true);
