// Shared plan feature guard for voice edge functions.
// Returns { allowed, reason, tenantId } — never throws.
// Master tenant (00000000-0000-0000-0000-000000000001) always allowed.

const MASTER_TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface PlanCheckResult {
  allowed: boolean;
  reason?: string;
  planSlug?: string | null;
}

/**
 * Verify that the given tenant's plan includes a specific feature key
 * (e.g. 'voice_agent'). Returns allowed=false with reason if not.
 * If the plan cannot be resolved at all, allows through to avoid breaking
 * legacy tenants (fail-open on lookup errors, fail-closed on explicit false).
 */
export async function checkTenantFeature(
  supabase: any,
  tenantId: string | null | undefined,
  featureKey: string,
): Promise<PlanCheckResult> {
  if (!tenantId) return { allowed: true }; // no tenant context — let downstream handle
  if (tenantId === MASTER_TENANT_ID) return { allowed: true, planSlug: 'master' };

  try {
    const { data: sub } = await supabase
      .from('tenant_subscriptions')
      .select('plan_id, status')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!sub?.plan_id) return { allowed: true }; // no subscription row — do not block

    const { data: plan } = await supabase
      .from('subscription_plans')
      .select('slug, features')
      .eq('id', sub.plan_id)
      .maybeSingle();

    if (!plan) return { allowed: true };

    const features = (plan.features || {}) as Record<string, any>;
    const enabled = features[featureKey] === true;
    if (!enabled) {
      return { allowed: false, reason: `${featureKey}_not_in_plan`, planSlug: plan.slug };
    }
    return { allowed: true, planSlug: plan.slug };
  } catch (e) {
    console.error('[plan-guard] lookup failed:', (e as Error).message);
    return { allowed: true }; // fail-open on unexpected errors
  }
}

/**
 * Convenience helper for voice-specific gating.
 * Returns a Response(403) if not allowed, otherwise null.
 */
export async function assertVoicePlan(
  supabase: any,
  tenantId: string | null | undefined,
  corsHeaders: Record<string, string>,
): Promise<Response | null> {
  const check = await checkTenantFeature(supabase, tenantId, 'voice_agent');
  if (check.allowed) return null;
  return new Response(
    JSON.stringify({
      error: 'voice_not_in_plan',
      message: 'El plan actual no incluye el Agente de Voz. Actualiza a Pro para activarlo.',
      plan: check.planSlug ?? null,
    }),
    { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
}
