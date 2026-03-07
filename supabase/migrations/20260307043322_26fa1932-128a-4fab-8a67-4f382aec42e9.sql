
-- Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Document chunks for RAG
CREATE TABLE public.document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  chunk_index integer NOT NULL DEFAULT 0,
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}',
  embedding extensions.vector(768),
  tokens integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Semantic memory
CREATE TABLE public.document_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  memory_type text NOT NULL DEFAULT 'conversation',
  scope_key text NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  relevance_score numeric DEFAULT 1.0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

-- Workflow rules
CREATE TABLE public.document_workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  trigger_type text NOT NULL DEFAULT 'document_type',
  trigger_config jsonb NOT NULL DEFAULT '{}',
  actions jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Workflow execution log
CREATE TABLE public.document_workflow_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  document_id uuid REFERENCES public.documents(id),
  rule_id uuid REFERENCES public.document_workflow_rules(id),
  status text NOT NULL DEFAULT 'executed',
  actions_taken jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_doc_chunks_doc ON public.document_chunks(document_id);
CREATE INDEX idx_doc_chunks_tenant ON public.document_chunks(tenant_id);
CREATE INDEX idx_doc_memory_scope ON public.document_memory(tenant_id, memory_type, scope_key);
CREATE INDEX idx_doc_workflow_rules_tenant ON public.document_workflow_rules(tenant_id, active);

-- RLS
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_workflow_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_workflow_log ENABLE ROW LEVEL SECURITY;

-- Service role access for bot operations
CREATE POLICY "Service role full access on document_chunks" ON public.document_chunks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on document_memory" ON public.document_memory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on document_workflow_rules" ON public.document_workflow_rules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access on document_workflow_log" ON public.document_workflow_log FOR ALL USING (true) WITH CHECK (true);

-- Tenant members can view
CREATE POLICY "Tenant members view chunks" ON public.document_chunks FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant members view memory" ON public.document_memory FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));
CREATE POLICY "Tenant admins manage workflow rules" ON public.document_workflow_rules FOR ALL
  USING (tenant_id = get_user_tenant_id(auth.uid()) AND (has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)))
  WITH CHECK (tenant_id = get_user_tenant_id(auth.uid()) AND (has_tenant_role(auth.uid(), tenant_id, 'admin'::app_role) OR has_tenant_role(auth.uid(), tenant_id, 'owner'::app_role)));
CREATE POLICY "Tenant members view workflow log" ON public.document_workflow_log FOR SELECT USING (tenant_id = get_user_tenant_id(auth.uid()));

-- Semantic search function using full-text search
CREATE OR REPLACE FUNCTION public.search_document_chunks(
  _tenant_id uuid,
  _query text,
  _limit integer DEFAULT 10,
  _document_type text DEFAULT NULL
)
RETURNS TABLE(
  chunk_id uuid,
  document_id uuid,
  content text,
  metadata jsonb,
  chunk_index integer,
  rank real,
  doc_filename text,
  doc_type text,
  doc_summary text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    dc.id AS chunk_id,
    dc.document_id,
    dc.content,
    dc.metadata,
    dc.chunk_index,
    ts_rank(to_tsvector('spanish', dc.content), plainto_tsquery('spanish', _query)) AS rank,
    d.original_filename AS doc_filename,
    d.document_type AS doc_type,
    d.analysis_summary AS doc_summary
  FROM public.document_chunks dc
  JOIN public.documents d ON d.id = dc.document_id AND d.deleted_at IS NULL
  WHERE dc.tenant_id = _tenant_id
    AND (
      to_tsvector('spanish', dc.content) @@ plainto_tsquery('spanish', _query)
      OR dc.content ILIKE '%' || _query || '%'
    )
    AND (_document_type IS NULL OR d.document_type = _document_type)
  ORDER BY rank DESC, dc.created_at DESC
  LIMIT _limit;
$$;
