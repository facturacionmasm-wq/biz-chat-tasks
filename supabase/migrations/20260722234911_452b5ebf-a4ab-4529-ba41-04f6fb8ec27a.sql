
-- =========================================================
-- PART A: products
-- =========================================================
CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sku text,
  name text NOT NULL,
  description text,
  unit_price numeric(14,4) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'MXN',
  unit_of_measure text,
  sat_clave_prod_serv text,
  sat_clave_unidad text,
  stock_quantity numeric(14,4) NOT NULL DEFAULT 0,
  category_id uuid REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_sat_prod_serv_fmt CHECK (sat_clave_prod_serv IS NULL OR sat_clave_prod_serv ~ '^[0-9]{8}$'),
  CONSTRAINT products_sat_unidad_fmt CHECK (sat_clave_unidad IS NULL OR sat_clave_unidad ~ '^[A-Z0-9]{2,3}$')
);

CREATE INDEX IF NOT EXISTS idx_products_tenant_active ON public.products(tenant_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_sku ON public.products(tenant_id, sku) WHERE sku IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read products" ON public.products;
CREATE POLICY "Tenant members read products" ON public.products FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant staff mutate products" ON public.products;
CREATE POLICY "Tenant staff mutate products" ON public.products FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'staff')
    )
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (
      public.has_tenant_role(auth.uid(), tenant_id, 'owner')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'admin')
      OR public.has_tenant_role(auth.uid(), tenant_id, 'staff')
    )
  );

DROP TRIGGER IF EXISTS trg_products_updated_at ON public.products;
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.audit_product_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _evt text; _tenant uuid; _rid text; _payload jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _evt := 'product_created'; _tenant := NEW.tenant_id; _rid := NEW.id::text;
    _payload := jsonb_build_object('sku', NEW.sku, 'name', NEW.name, 'unit_price', NEW.unit_price);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.name IS DISTINCT FROM OLD.name
       OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.stock_quantity IS DISTINCT FROM OLD.stock_quantity THEN
      _evt := 'product_updated'; _tenant := NEW.tenant_id; _rid := NEW.id::text;
      _payload := jsonb_build_object(
        'old', jsonb_build_object('name', OLD.name, 'unit_price', OLD.unit_price, 'is_active', OLD.is_active, 'stock', OLD.stock_quantity),
        'new', jsonb_build_object('name', NEW.name, 'unit_price', NEW.unit_price, 'is_active', NEW.is_active, 'stock', NEW.stock_quantity)
      );
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    _evt := 'product_deleted'; _tenant := OLD.tenant_id; _rid := OLD.id::text;
    _payload := jsonb_build_object('sku', OLD.sku, 'name', OLD.name);
  END IF;
  INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
  VALUES (_tenant, _evt, auth.uid(), 'products', _rid, COALESCE(_payload, '{}'::jsonb));
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_products_audit ON public.products;
CREATE TRIGGER trg_products_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.audit_product_changes();

-- =========================================================
-- PART B: financial_budget_lines + upsert_budget
-- =========================================================
ALTER TABLE public.financial_budget_lines
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantity numeric(14,4);

CREATE OR REPLACE FUNCTION public.upsert_budget(
  _id uuid, _name text, _period_start date, _period_end date,
  _currency text, _notes text, _lines jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _caller uuid := auth.uid();
  _tenant uuid;
  _budget_id uuid;
  _line jsonb;
  _cat_id uuid;
  _cat_name text;
  _amount numeric;
  _product_id uuid;
  _quantity numeric;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF _period_end < _period_start THEN RAISE EXCEPTION 'period_end must be >= period_start'; END IF;

  IF _id IS NULL THEN
    SELECT tenant_id INTO _tenant FROM public.profiles WHERE user_id = _caller LIMIT 1;
    IF _tenant IS NULL THEN RAISE EXCEPTION 'No tenant for caller'; END IF;
    IF NOT (public.has_tenant_role(_caller, _tenant, 'owner') OR public.has_tenant_role(_caller, _tenant, 'admin')) THEN
      RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
    END IF;
    INSERT INTO public.financial_budgets (tenant_id, name, period_start, period_end, currency, notes, created_by, total_planned)
    VALUES (_tenant, _name, _period_start, _period_end, COALESCE(_currency,'MXN'), _notes, _caller, 0)
    RETURNING id INTO _budget_id;
  ELSE
    SELECT tenant_id INTO _tenant FROM public.financial_budgets WHERE id = _id;
    IF _tenant IS NULL THEN RAISE EXCEPTION 'Budget not found'; END IF;
    IF NOT (public.has_tenant_role(_caller, _tenant, 'owner') OR public.has_tenant_role(_caller, _tenant, 'admin')) THEN
      RAISE EXCEPTION 'Insufficient privileges' USING ERRCODE = '42501';
    END IF;
    UPDATE public.financial_budgets
       SET name = _name, period_start = _period_start, period_end = _period_end,
           currency = COALESCE(_currency, currency), notes = _notes, updated_at = now()
     WHERE id = _id;
    _budget_id := _id;
    DELETE FROM public.financial_budget_lines WHERE budget_id = _budget_id;
  END IF;

  IF _lines IS NOT NULL AND jsonb_typeof(_lines) = 'array' THEN
    FOR _line IN SELECT * FROM jsonb_array_elements(_lines) LOOP
      _cat_id := NULLIF(_line->>'category_id','')::uuid;
      _cat_name := COALESCE(NULLIF(_line->>'category_name',''), 'Sin categoría');
      _amount := COALESCE((_line->>'planned_amount')::numeric, 0);
      _product_id := NULLIF(_line->>'product_id','')::uuid;
      _quantity := NULLIF(_line->>'quantity','')::numeric;
      IF _amount < 0 THEN RAISE EXCEPTION 'planned_amount must be >= 0'; END IF;
      INSERT INTO public.financial_budget_lines
        (tenant_id, budget_id, category_id, category_name, planned_amount, notes, product_id, quantity)
      VALUES
        (_tenant, _budget_id, _cat_id, _cat_name, _amount, NULLIF(_line->>'notes',''), _product_id, _quantity);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'budget_id', _budget_id);
END;
$$;

-- =========================================================
-- PART C: CFDI
-- =========================================================
CREATE TABLE IF NOT EXISTS public.cfdi_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  series text,
  folio text,
  tipo_comprobante text NOT NULL DEFAULT 'I',
  uso_cfdi text,
  forma_pago text,
  metodo_pago text DEFAULT 'PUE',
  moneda text NOT NULL DEFAULT 'MXN',
  receptor_rfc text NOT NULL,
  receptor_nombre text NOT NULL,
  receptor_uso_cfdi text,
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  iva numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  estado text NOT NULL DEFAULT 'borrador',
  uuid_fiscal text,
  xml_url text,
  pdf_url text,
  provider text,
  error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cfdi_estado_valid CHECK (estado IN ('borrador','timbrado','cancelado','error'))
);

CREATE INDEX IF NOT EXISTS idx_cfdi_tenant_created ON public.cfdi_documents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cfdi_tenant_estado ON public.cfdi_documents(tenant_id, estado);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfdi_documents TO authenticated;
GRANT ALL ON public.cfdi_documents TO service_role;
ALTER TABLE public.cfdi_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read cfdi" ON public.cfdi_documents;
CREATE POLICY "Tenant members read cfdi" ON public.cfdi_documents FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id(auth.uid()));

DROP POLICY IF EXISTS "Tenant admins mutate cfdi" ON public.cfdi_documents;
CREATE POLICY "Tenant admins mutate cfdi" ON public.cfdi_documents FOR ALL TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'))
  )
  WITH CHECK (
    tenant_id = public.get_user_tenant_id(auth.uid())
    AND (public.has_tenant_role(auth.uid(), tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), tenant_id, 'admin'))
  );

DROP TRIGGER IF EXISTS trg_cfdi_updated_at ON public.cfdi_documents;
CREATE TRIGGER trg_cfdi_updated_at
  BEFORE UPDATE ON public.cfdi_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.cfdi_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cfdi_document_id uuid NOT NULL REFERENCES public.cfdi_documents(id) ON DELETE CASCADE,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  clave_prod_serv text,
  clave_unidad text,
  descripcion text NOT NULL,
  cantidad numeric(14,4) NOT NULL DEFAULT 1,
  valor_unitario numeric(14,4) NOT NULL DEFAULT 0,
  importe numeric(14,2) NOT NULL DEFAULT 0,
  iva_tasa numeric(5,4) NOT NULL DEFAULT 0.16,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cfdi_concepts_doc ON public.cfdi_concepts(cfdi_document_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cfdi_concepts TO authenticated;
GRANT ALL ON public.cfdi_concepts TO service_role;
ALTER TABLE public.cfdi_concepts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant members read cfdi concepts" ON public.cfdi_concepts;
CREATE POLICY "Tenant members read cfdi concepts" ON public.cfdi_concepts FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cfdi_documents d
    WHERE d.id = cfdi_concepts.cfdi_document_id
      AND d.tenant_id = public.get_user_tenant_id(auth.uid())
  ));

DROP POLICY IF EXISTS "Tenant admins mutate cfdi concepts" ON public.cfdi_concepts;
CREATE POLICY "Tenant admins mutate cfdi concepts" ON public.cfdi_concepts FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cfdi_documents d
    WHERE d.id = cfdi_concepts.cfdi_document_id
      AND d.tenant_id = public.get_user_tenant_id(auth.uid())
      AND (public.has_tenant_role(auth.uid(), d.tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), d.tenant_id, 'admin'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cfdi_documents d
    WHERE d.id = cfdi_concepts.cfdi_document_id
      AND d.tenant_id = public.get_user_tenant_id(auth.uid())
      AND (public.has_tenant_role(auth.uid(), d.tenant_id, 'owner') OR public.has_tenant_role(auth.uid(), d.tenant_id, 'admin'))
  ));

-- Audit trigger for CFDI state transitions
CREATE OR REPLACE FUNCTION public.audit_cfdi_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _evt text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    IF NEW.estado = 'timbrado' THEN _evt := 'cfdi_issued';
    ELSIF NEW.estado = 'cancelado' THEN _evt := 'cfdi_cancelled';
    ELSIF NEW.estado = 'error' THEN _evt := 'cfdi_error';
    ELSE RETURN NEW;
    END IF;
    INSERT INTO public.audit_events (tenant_id, event_type, actor_id, resource_type, resource_id, payload)
    VALUES (NEW.tenant_id, _evt, auth.uid(), 'cfdi_documents', NEW.id::text,
      jsonb_build_object('uuid_fiscal', NEW.uuid_fiscal, 'total', NEW.total, 'receptor_rfc', NEW.receptor_rfc, 'provider', NEW.provider));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cfdi_audit ON public.cfdi_documents;
CREATE TRIGGER trg_cfdi_audit
  AFTER UPDATE ON public.cfdi_documents
  FOR EACH ROW EXECUTE FUNCTION public.audit_cfdi_changes();
