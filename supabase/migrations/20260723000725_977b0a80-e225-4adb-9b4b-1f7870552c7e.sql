
-- Tighten "own expense" policies to require tenant match, preventing any
-- accidental cross-tenant broadening if a user's tenant changes later.
DROP POLICY IF EXISTS "Users view own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Users update own expenses" ON public.expenses;

CREATE POLICY "Users view own expenses"
ON public.expenses FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
);

CREATE POLICY "Users update own expenses"
ON public.expenses FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
)
WITH CHECK (
  user_id = auth.uid()
  AND tenant_id = public.get_user_tenant_id(auth.uid())
);
