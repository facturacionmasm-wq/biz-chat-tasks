
CREATE OR REPLACE FUNCTION public.get_slow_queries(_limit int DEFAULT 20)
RETURNS TABLE (
  query text,
  calls bigint,
  total_ms double precision,
  mean_ms double precision,
  max_ms double precision,
  rows_returned bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Only super_admin can read slow queries' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pss.query::text,
    pss.calls,
    pss.total_exec_time AS total_ms,
    pss.mean_exec_time  AS mean_ms,
    pss.max_exec_time   AS max_ms,
    pss.rows            AS rows_returned
  FROM public.pg_stat_statements() AS pss
  WHERE pss.query NOT ILIKE '%pg_stat_statements%'
    AND pss.query NOT ILIKE '%information_schema%'
    AND pss.query NOT ILIKE '%pg_catalog%'
    AND pss.query NOT ILIKE '% auth.%'
    AND pss.query NOT ILIKE '% storage.%'
    AND pss.query NOT ILIKE '% realtime.%'
  ORDER BY pss.total_exec_time DESC
  LIMIT LEAST(GREATEST(_limit, 1), 100);
EXCEPTION WHEN undefined_function OR undefined_table THEN
  -- Fallback if pg_stat_statements is exposed as a view instead of a function
  RETURN QUERY EXECUTE $q$
    SELECT query::text, calls, total_exec_time, mean_exec_time, max_exec_time, rows
    FROM pg_stat_statements
    WHERE query NOT ILIKE '%pg_stat_statements%'
      AND query NOT ILIKE '%information_schema%'
      AND query NOT ILIKE '%pg_catalog%'
      AND query NOT ILIKE '% auth.%'
      AND query NOT ILIKE '% storage.%'
      AND query NOT ILIKE '% realtime.%'
    ORDER BY total_exec_time DESC
    LIMIT $1
  $q$ USING LEAST(GREATEST(_limit, 1), 100);
END;
$$;

REVOKE ALL ON FUNCTION public.get_slow_queries(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_slow_queries(int) TO authenticated, service_role;
