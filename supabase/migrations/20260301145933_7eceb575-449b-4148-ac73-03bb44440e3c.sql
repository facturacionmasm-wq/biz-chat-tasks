-- Fix search_path on new function
CREATE OR REPLACE FUNCTION public.calculate_next_retry(
  _retry_count integer,
  _base_delay_minutes integer DEFAULT 5
)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
SET search_path = 'public'
AS $$
  SELECT now() + ((_base_delay_minutes * power(2, _retry_count)) || ' minutes')::interval;
$$;