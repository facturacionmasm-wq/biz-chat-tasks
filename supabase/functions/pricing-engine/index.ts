import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest(path: string, method: string, body?: Record<string, string>) {
  const key = Deno.env.get('STRIPE_SECRET_KEY')!;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const opts: RequestInit = { method, headers };
  if (body) opts.body = new URLSearchParams(body).toString();
  const res = await fetch(`${STRIPE_API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe error (${res.status}): ${JSON.stringify(data.error)}`);
  return data;
}

// ---- Plan configuration ----
const PLAN_THRESHOLDS = {
  basic: { maxMinutes: 500, slug: 'basic' },
  pro: { maxMinutes: 2000, slug: 'pro' },
  enterprise: { maxMinutes: Infinity, slug: 'enterprise' },
};

function recommendPlan(avgMinutes: number): string {
  if (avgMinutes <= PLAN_THRESHOLDS.basic.maxMinutes) return 'basic';
  if (avgMinutes <= PLAN_THRESHOLDS.pro.maxMinutes) return 'pro';
  return 'enterprise';
}

function determineUsageTier(avgMinutes: number): string {
  if (avgMinutes < 100) return 'low';
  if (avgMinutes < 500) return 'standard';
  if (avgMinutes < 2000) return 'high';
  return 'enterprise';
}

function calculateGrowthRate(months: Array<{ total_minutes: number }>): number {
  if (months.length < 2) return 0;
  const sorted = [...months].sort((a, b) => a.total_minutes - b.total_minutes);
  const oldest = sorted[0].total_minutes || 1;
  const newest = sorted[sorted.length - 1].total_minutes;
  return +((((newest - oldest) / oldest) * 100)).toFixed(2);
}

// ---- Core evaluation logic ----
interface EvaluationResult {
  action: string;
  reason: string;
  recommendedPlan: string;
  newMarkup: number;
  newRate: number;
  usageTier: string;
}

function evaluateTenant(
  avgMinutes: number,
  avgCalls: number,
  avgRevenue: number,
  avgCost: number,
  avgMarginPct: number,
  growthRate: number,
  currentPlanSlug: string | null,
  currentMarkup: number,
  volumeTiers: Array<{ min_minutes: number; max_minutes: number | null; per_minute_rate: number; markup_pct: number }>
): EvaluationResult {
  const recommendedPlan = recommendPlan(avgMinutes);
  const usageTier = determineUsageTier(avgMinutes);

  // Find applicable volume tier
  const applicableTier = volumeTiers.find(t =>
    avgMinutes >= t.min_minutes && (t.max_minutes === null || avgMinutes < t.max_minutes)
  );

  const tierRate = applicableTier?.per_minute_rate || 1.50;
  const tierMarkup = applicableTier?.markup_pct || 30;

  // Decision logic
  // 1. Upgrade needed: tenant consistently exceeds plan limits
  if (currentPlanSlug && recommendedPlan !== currentPlanSlug) {
    const planOrder = ['basic', 'pro', 'enterprise'];
    const currentIdx = planOrder.indexOf(currentPlanSlug);
    const recommendedIdx = planOrder.indexOf(recommendedPlan);

    if (recommendedIdx > currentIdx) {
      return {
        action: 'upgrade',
        reason: `Uso promedio (${avgMinutes.toFixed(0)} min/mes) excede límites del plan ${currentPlanSlug}. Recomendado: ${recommendedPlan}`,
        recommendedPlan,
        newMarkup: tierMarkup,
        newRate: tierRate,
        usageTier,
      };
    }

    // Downgrade: significantly underusing
    if (recommendedIdx < currentIdx && avgMinutes < PLAN_THRESHOLDS[currentPlanSlug as keyof typeof PLAN_THRESHOLDS]?.maxMinutes * 0.3) {
      return {
        action: 'downgrade_suggested',
        reason: `Uso promedio (${avgMinutes.toFixed(0)} min/mes) significativamente bajo para plan ${currentPlanSlug}. Sugerido: ${recommendedPlan}`,
        recommendedPlan,
        newMarkup: tierMarkup,
        newRate: tierRate,
        usageTier,
      };
    }
  }

  // 2. Volume pricing adjustment: high volume deserves better rate
  if (applicableTier && Math.abs(currentMarkup - tierMarkup) > 2) {
    return {
      action: 'volume_adjustment',
      reason: `Ajuste por volumen: ${avgMinutes.toFixed(0)} min/mes → tier "${usageTier}" (markup ${tierMarkup}%, rate $${tierRate}/min)`,
      recommendedPlan: currentPlanSlug || recommendedPlan,
      newMarkup: tierMarkup,
      newRate: tierRate,
      usageTier,
    };
  }

  // 3. Margin protection: if margin too low, increase markup
  if (avgMarginPct < 10 && avgMinutes > 50) {
    const protectionMarkup = Math.min(currentMarkup + 10, 50);
    return {
      action: 'margin_protection',
      reason: `Margen bajo (${avgMarginPct.toFixed(1)}%). Incremento de protección: markup ${currentMarkup}% → ${protectionMarkup}%`,
      recommendedPlan: currentPlanSlug || recommendedPlan,
      newMarkup: protectionMarkup,
      newRate: tierRate,
      usageTier,
    };
  }

  // 4. Growth incentive: fast-growing tenant gets slight discount to retain
  if (growthRate > 50 && avgMarginPct > 30) {
    const incentiveMarkup = Math.max(currentMarkup - 5, tierMarkup);
    return {
      action: 'growth_incentive',
      reason: `Crecimiento alto (${growthRate.toFixed(0)}%) con margen sano (${avgMarginPct.toFixed(1)}%). Descuento incentivo: markup ${currentMarkup}% → ${incentiveMarkup}%`,
      recommendedPlan: currentPlanSlug || recommendedPlan,
      newMarkup: incentiveMarkup,
      newRate: tierRate,
      usageTier,
    };
  }

  // 5. No action needed
  return {
    action: 'none',
    reason: 'Pricing actual adecuado para nivel de uso y margen',
    recommendedPlan: currentPlanSlug || recommendedPlan,
    newMarkup: currentMarkup,
    newRate: tierRate,
    usageTier,
  };
}

// ---- Apply changes to Stripe ----
async function applyPlanChange(
  supabase: any,
  tenantId: string,
  newPlanSlug: string,
  evaluationId: string
) {
  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!STRIPE_SECRET_KEY) return;

  const { data: stripeCustomer } = await supabase
    .from('stripe_customers')
    .select('stripe_subscription_id, stripe_base_item_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!stripeCustomer?.stripe_subscription_id) return;

  // Get new plan's Stripe price
  const { data: plan } = await supabase
    .from('subscription_plans')
    .select('id, slug, price_monthly')
    .eq('slug', newPlanSlug)
    .maybeSingle();

  if (!plan) return;

  // Find or create the price for this plan in Stripe
  const products = await stripeRequest('/products?active=true&limit=100', 'GET');
  const baseProduct = products.data.find((p: any) => p.metadata?.type === 'officehub_base');

  if (!baseProduct) return;

  const prices = await stripeRequest(`/prices?active=true&product=${baseProduct.id}&limit=50`, 'GET');
  let targetPrice = prices.data.find((p: any) =>
    p.unit_amount === Math.round(plan.price_monthly * 100) &&
    p.recurring?.interval === 'month' &&
    !p.recurring?.usage_type
  );

  if (!targetPrice) {
    targetPrice = await stripeRequest('/prices', 'POST', {
      product: baseProduct.id,
      unit_amount: String(Math.round(plan.price_monthly * 100)),
      currency: 'mxn',
      'recurring[interval]': 'month',
    });
  }

  // Update subscription item
  if (stripeCustomer.stripe_base_item_id) {
    await stripeRequest(`/subscription_items/${stripeCustomer.stripe_base_item_id}`, 'POST', {
      price: targetPrice.id,
      proration_behavior: 'create_prorations',
    });
  }

  // Update tenant_subscriptions
  await supabase.from('tenant_subscriptions').update({
    plan_id: plan.id,
    updated_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId);

  // Record plan change
  const { data: currentSub } = await supabase
    .from('tenant_subscriptions')
    .select('stripe_subscription_id')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  await supabase.from('plan_change_history').insert({
    tenant_id: tenantId,
    old_plan_slug: null, // filled by caller
    new_plan_slug: newPlanSlug,
    change_type: 'automatic',
    change_reason: `Auto-evaluation pricing engine`,
    evaluation_id: evaluationId,
    stripe_subscription_id: currentSub?.stripe_subscription_id,
    applied_by: 'pricing_engine',
  });
}

// ---- Main Handler ----
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const targetTenantId = body.tenant_id; // Optional: evaluate single tenant

    // Get volume tiers
    const { data: volumeTiers } = await supabase
      .from('volume_tiers')
      .select('*')
      .eq('active', true)
      .order('sort_order');

    const tiers = (volumeTiers || []).map((t: any) => ({
      min_minutes: Number(t.min_minutes),
      max_minutes: t.max_minutes ? Number(t.max_minutes) : null,
      per_minute_rate: Number(t.per_minute_rate),
      markup_pct: Number(t.markup_pct),
    }));

    // Get tenants to evaluate
    let tenantsQuery = supabase
      .from('tenant_subscriptions')
      .select('tenant_id, plan_id, status, stripe_subscription_id')
      .in('status', ['active', 'trialing']);

    if (targetTenantId) {
      tenantsQuery = tenantsQuery.eq('tenant_id', targetTenantId);
    }

    const { data: tenants, error: tenantsError } = await tenantsQuery;
    if (tenantsError) throw tenantsError;
    if (!tenants || tenants.length === 0) {
      return new Response(JSON.stringify({ message: 'No tenants to evaluate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all plan slugs
    const { data: plans } = await supabase.from('subscription_plans').select('id, slug');
    const planMap = new Map((plans || []).map((p: any) => [p.id, p.slug]));

    const results: Array<{
      tenant_id: string;
      action: string;
      reason: string;
      applied: boolean;
    }> = [];

    for (const tenant of tenants) {
      try {
        const currentPlanSlug = planMap.get(tenant.plan_id) || null;

        // Get last 3 months usage
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const periodCutoff = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;

        const { data: usageHistory } = await supabase
          .from('tenant_usage_monthly')
          .select('total_minutes, total_calls, revenue, cost_total, margin_pct')
          .eq('tenant_id', tenant.tenant_id)
          .gte('period_start', periodCutoff)
          .order('period_start', { ascending: true });

        const months = usageHistory || [];
        if (months.length === 0) {
          results.push({
            tenant_id: tenant.tenant_id,
            action: 'skipped',
            reason: 'No usage data',
            applied: false,
          });
          continue;
        }

        // Calculate averages
        const avgMinutes = months.reduce((s: number, m: any) => s + Number(m.total_minutes), 0) / months.length;
        const avgCalls = months.reduce((s: number, m: any) => s + Number(m.total_calls), 0) / months.length;
        const avgRevenue = months.reduce((s: number, m: any) => s + Number(m.revenue), 0) / months.length;
        const avgCost = months.reduce((s: number, m: any) => s + Number(m.cost_total), 0) / months.length;
        const avgMarginPct = months.reduce((s: number, m: any) => s + Number(m.margin_pct), 0) / months.length;
        const growthRate = calculateGrowthRate(months.map((m: any) => ({
          total_minutes: Number(m.total_minutes),
        })));

        // Get current pricing adjustment
        const { data: currentAdj } = await supabase
          .from('tenant_pricing_adjustments')
          .select('adjustment_value')
          .eq('tenant_id', tenant.tenant_id)
          .eq('active', true)
          .eq('adjustment_type', 'markup_override')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const currentMarkup = currentAdj ? Number(currentAdj.adjustment_value) : 35;

        // Evaluate
        const evaluation = evaluateTenant(
          avgMinutes, avgCalls, avgRevenue, avgCost, avgMarginPct,
          growthRate, currentPlanSlug, currentMarkup, tiers
        );

        // Save evaluation
        const { data: evalRecord } = await supabase
          .from('pricing_evaluations')
          .insert({
            tenant_id: tenant.tenant_id,
            avg_monthly_minutes_3m: +avgMinutes.toFixed(2),
            avg_monthly_calls_3m: +avgCalls.toFixed(2),
            avg_monthly_revenue_3m: +avgRevenue.toFixed(4),
            avg_monthly_cost_3m: +avgCost.toFixed(4),
            avg_margin_pct_3m: +avgMarginPct.toFixed(2),
            growth_rate_pct: growthRate,
            usage_tier: evaluation.usageTier,
            current_plan_slug: currentPlanSlug,
            recommended_plan_slug: evaluation.recommendedPlan,
            recommended_action: evaluation.action,
            action_reason: evaluation.reason,
            old_markup_pct: currentMarkup,
            new_markup_pct: evaluation.newMarkup,
            old_per_minute_rate: null,
            new_per_minute_rate: evaluation.newRate,
          })
          .select('id')
          .single();

        let applied = false;

        // Apply changes automatically (except downgrades which are suggested only)
        if (evaluation.action !== 'none' && evaluation.action !== 'downgrade_suggested' && evaluation.action !== 'skipped') {
          // Apply markup adjustment
          if (Math.abs(currentMarkup - evaluation.newMarkup) > 0.5) {
            // Deactivate old adjustments
            await supabase
              .from('tenant_pricing_adjustments')
              .update({ active: false })
              .eq('tenant_id', tenant.tenant_id)
              .eq('active', true);

            // Create new adjustment
            await supabase.from('tenant_pricing_adjustments').insert({
              tenant_id: tenant.tenant_id,
              adjustment_type: 'markup_override',
              adjustment_value: evaluation.newMarkup,
              reason: evaluation.reason,
              applied_by: 'pricing_engine',
              active: true,
            });
          }

          // Apply plan change if upgrade
          if (evaluation.action === 'upgrade' && evaluation.recommendedPlan !== currentPlanSlug) {
            await applyPlanChange(supabase, tenant.tenant_id, evaluation.recommendedPlan, evalRecord?.id);

            await supabase.from('plan_change_history').insert({
              tenant_id: tenant.tenant_id,
              old_plan_slug: currentPlanSlug,
              new_plan_slug: evaluation.recommendedPlan,
              change_type: 'automatic_upgrade',
              change_reason: evaluation.reason,
              evaluation_id: evalRecord?.id,
              stripe_subscription_id: tenant.stripe_subscription_id,
              applied_by: 'pricing_engine',
            });
          }

          // Mark evaluation as applied
          if (evalRecord) {
            await supabase.from('pricing_evaluations')
              .update({ action_applied: true, applied_at: new Date().toISOString() })
              .eq('id', evalRecord.id);
          }

          applied = true;
        }

        // For downgrades, just record suggestion in plan_change_history
        if (evaluation.action === 'downgrade_suggested') {
          await supabase.from('plan_change_history').insert({
            tenant_id: tenant.tenant_id,
            old_plan_slug: currentPlanSlug,
            new_plan_slug: evaluation.recommendedPlan,
            change_type: 'suggested_downgrade',
            change_reason: evaluation.reason,
            evaluation_id: evalRecord?.id,
            applied_by: 'pricing_engine',
          });
        }

        results.push({
          tenant_id: tenant.tenant_id,
          action: evaluation.action,
          reason: evaluation.reason,
          applied,
        });

        console.log(`Tenant ${tenant.tenant_id}: ${evaluation.action} - ${evaluation.reason}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        console.error(`Error evaluating tenant ${tenant.tenant_id}:`, msg);
        results.push({
          tenant_id: tenant.tenant_id,
          action: 'error',
          reason: msg,
          applied: false,
        });
      }
    }

    // Audit
    await supabase.from('audit_events').insert({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      event_type: 'pricing.evaluation_run',
      resource_type: 'system',
      payload: {
        tenants_evaluated: results.length,
        actions_applied: results.filter(r => r.applied).length,
        upgrades: results.filter(r => r.action === 'upgrade').length,
        downgrades_suggested: results.filter(r => r.action === 'downgrade_suggested').length,
        volume_adjustments: results.filter(r => r.action === 'volume_adjustment').length,
        margin_protections: results.filter(r => r.action === 'margin_protection').length,
        growth_incentives: results.filter(r => r.action === 'growth_incentive').length,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      tenants_evaluated: results.length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Pricing engine error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
