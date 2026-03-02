import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Calculates and stores daily global SaaS metrics:
 * MRR, ARR, ARPU, LTV, churn rate, NRR, gross margin, etc.
 * Generates both global and per-region/country breakdowns.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const today = new Date().toISOString().split('T')[0];
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000).toISOString();

    // 1. Get all tenants with their region/country
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, name, country_code, region, currency, status')
      .neq('status', 'deleted');

    if (!tenants || tenants.length === 0) {
      return new Response(JSON.stringify({ message: 'No tenants to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Get current margin states for all tenants
    const { data: marginStates } = await supabase
      .from('realtime_margin_state')
      .select('*');

    const marginMap: Record<string, any> = {};
    (marginStates || []).forEach(m => { marginMap[m.tenant_id] = m; });

    // 3. Get churn scores
    const { data: churnScores } = await supabase
      .from('tenant_churn_scores')
      .select('tenant_id, churn_probability, risk_category');

    const churnMap: Record<string, any> = {};
    (churnScores || []).forEach(c => { churnMap[c.tenant_id] = c; });

    // 4. Get FX rates for USD conversion
    const { data: fxRates } = await supabase
      .from('fx_rates')
      .select('target_currency, rate')
      .eq('base_currency', 'USD')
      .eq('rate_date', today);

    const fxMap: Record<string, number> = { USD: 1 };
    (fxRates || []).forEach(r => { fxMap[r.target_currency] = Number(r.rate); });
    // Default MXN rate if not set
    if (!fxMap['MXN']) fxMap['MXN'] = 17.5;

    // 5. Get subscriptions for MRR calculation
    const { data: subscriptions } = await supabase
      .from('tenant_subscriptions' as any)
      .select('tenant_id, status, plan_id')
      .in('status', ['active', 'trialing']);

    const { data: plans } = await supabase
      .from('subscription_plans')
      .select('id, slug, price_monthly');

    const planMap: Record<string, any> = {};
    (plans || []).forEach(p => { planMap[p.id] = p; });

    // 6. Calculate metrics by region and country
    const regionMetrics: Record<string, any> = {};
    const countryMetrics: Record<string, any> = {};
    const globalMetrics = {
      mrr: 0, arr: 0, arpu: 0, ltv_avg: 0, cac: 0, ltv_cac_ratio: 0,
      gross_margin_pct: 0, net_revenue_retention_pct: 100, churn_rate_pct: 0,
      expansion_revenue: 0, total_tenants: tenants.length, active_tenants: 0,
      new_tenants: 0, churned_tenants: 0, total_revenue_usd: 0, total_cost_usd: 0,
    };

    const activeTenantIds = new Set(((subscriptions as any[]) || []).map((s: any) => s.tenant_id));
    globalMetrics.active_tenants = activeTenantIds.size;

    for (const tenant of tenants) {
      const region = tenant.region || 'LATAM';
      const country = tenant.country_code || 'MX';
      const currency = tenant.currency || 'MXN';
      const fxRate = fxMap[currency] || 1;

      // Initialize region/country buckets
      if (!regionMetrics[region]) {
        regionMetrics[region] = { mrr: 0, revenue: 0, cost: 0, tenants: 0, active: 0, churned: 0, churnProbs: [] };
      }
      if (!countryMetrics[country]) {
        countryMetrics[country] = { mrr: 0, revenue: 0, cost: 0, tenants: 0, active: 0, region };
      }

      regionMetrics[region].tenants++;
      countryMetrics[country].tenants++;

      const margin = marginMap[tenant.id];
      const revenueUsd = margin ? Number(margin.current_month_revenue) / fxRate : 0;
      const costUsd = margin ? Number(margin.current_month_cost) / fxRate : 0;

      globalMetrics.total_revenue_usd += revenueUsd;
      globalMetrics.total_cost_usd += costUsd;
      regionMetrics[region].revenue += revenueUsd;
      regionMetrics[region].cost += costUsd;
      countryMetrics[country].revenue += revenueUsd;
      countryMetrics[country].cost += costUsd;

      if (activeTenantIds.has(tenant.id)) {
        regionMetrics[region].active++;
        countryMetrics[country].active++;

        // MRR from subscription
        const sub = ((subscriptions as any[]) || []).find((s: any) => s.tenant_id === tenant.id);
        if (sub) {
          const plan = planMap[sub.plan_id];
          const planMrr = plan ? Number(plan.price_monthly) / fxRate : 0;
          globalMetrics.mrr += planMrr;
          regionMetrics[region].mrr += planMrr;
          countryMetrics[country].mrr += planMrr;
        }
      }

      // Churn tracking
      const churn = churnMap[tenant.id];
      if (churn) {
        regionMetrics[region].churnProbs.push(Number(churn.churn_probability));
      }
    }

    globalMetrics.arr = globalMetrics.mrr * 12;
    globalMetrics.arpu = globalMetrics.active_tenants > 0
      ? globalMetrics.mrr / globalMetrics.active_tenants : 0;
    
    const totalMarginUsd = globalMetrics.total_revenue_usd - globalMetrics.total_cost_usd;
    globalMetrics.gross_margin_pct = globalMetrics.total_revenue_usd > 0
      ? (totalMarginUsd / globalMetrics.total_revenue_usd) * 100 : 0;

    // Average churn probability
    const allChurnProbs = Object.values(regionMetrics).flatMap((r: any) => r.churnProbs);
    globalMetrics.churn_rate_pct = allChurnProbs.length > 0
      ? (allChurnProbs.reduce((a: number, b: number) => a + b, 0) / allChurnProbs.length) * 100 : 0;

    // Simple LTV = ARPU / monthly_churn_rate
    const monthlyChurnRate = globalMetrics.churn_rate_pct / 100;
    globalMetrics.ltv_avg = monthlyChurnRate > 0
      ? globalMetrics.arpu / monthlyChurnRate : globalMetrics.arpu * 24;

    // 7. Upsert global metrics
    await supabase.from('global_metrics_daily').upsert({
      metric_date: today,
      region: 'GLOBAL',
      country_code: 'ALL',
      ...globalMetrics,
    }, { onConflict: 'metric_date,region,country_code' });

    // 8. Upsert per-region metrics
    for (const [region, data] of Object.entries(regionMetrics)) {
      const d = data as any;
      const marginPct = d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0;
      const arpu = d.active > 0 ? d.mrr / d.active : 0;
      const avgChurn = d.churnProbs.length > 0
        ? (d.churnProbs.reduce((a: number, b: number) => a + b, 0) / d.churnProbs.length) * 100 : 0;

      await supabase.from('global_metrics_daily').upsert({
        metric_date: today,
        region,
        country_code: 'ALL',
        mrr: +d.mrr.toFixed(2),
        arr: +(d.mrr * 12).toFixed(2),
        arpu: +arpu.toFixed(2),
        gross_margin_pct: +marginPct.toFixed(2),
        churn_rate_pct: +avgChurn.toFixed(2),
        total_tenants: d.tenants,
        active_tenants: d.active,
        total_revenue_usd: +d.revenue.toFixed(2),
        total_cost_usd: +d.cost.toFixed(2),
      }, { onConflict: 'metric_date,region,country_code' });
    }

    // 9. Upsert per-country metrics
    for (const [country, data] of Object.entries(countryMetrics)) {
      const d = data as any;
      const marginPct = d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue) * 100 : 0;

      await supabase.from('global_metrics_daily').upsert({
        metric_date: today,
        region: d.region || 'LATAM',
        country_code: country,
        mrr: +d.mrr.toFixed(2),
        arr: +(d.mrr * 12).toFixed(2),
        gross_margin_pct: +marginPct.toFixed(2),
        total_tenants: d.tenants,
        active_tenants: d.active,
        total_revenue_usd: +d.revenue.toFixed(2),
        total_cost_usd: +d.cost.toFixed(2),
      }, { onConflict: 'metric_date,region,country_code' });
    }

    // 10. Calculate and store tenant LTV estimates
    for (const tenant of tenants) {
      const margin = marginMap[tenant.id];
      const churn = churnMap[tenant.id];
      const currency = tenant.currency || 'MXN';
      const fxRate = fxMap[currency] || 1;
      const region = tenant.region || 'LATAM';

      const avgMonthlyRev = margin ? Number(margin.current_month_revenue) : 0;
      const churnProb = churn ? Number(churn.churn_probability) : 0.05;
      const estimatedLifetime = churnProb > 0 ? Math.min(1 / churnProb, 60) : 24;

      // Country risk factor
      const { data: regionTarget } = await supabase
        .from('regional_margin_targets')
        .select('country_risk_multiplier')
        .eq('region', region)
        .maybeSingle();

      const countryRisk = regionTarget ? Number(regionTarget.country_risk_multiplier) : 1;

      const ltvLocal = avgMonthlyRev * estimatedLifetime / countryRisk;
      const ltvUsd = ltvLocal / fxRate;

      await supabase.from('tenant_ltv_estimates').insert({
        tenant_id: tenant.id,
        estimated_ltv_local: +ltvLocal.toFixed(2),
        estimated_ltv_usd: +ltvUsd.toFixed(2),
        avg_monthly_revenue: +avgMonthlyRev.toFixed(2),
        estimated_lifetime_months: +estimatedLifetime.toFixed(1),
        churn_probability: +churnProb.toFixed(4),
        country_risk_factor: countryRisk,
        fx_instability_factor: 0,
      });
    }

    console.log(`Global metrics calculated: MRR=$${globalMetrics.mrr.toFixed(2)}, ARR=$${globalMetrics.arr.toFixed(2)}, ${Object.keys(regionMetrics).length} regions`);

    return new Response(JSON.stringify({
      success: true,
      metrics: {
        mrr: +globalMetrics.mrr.toFixed(2),
        arr: +globalMetrics.arr.toFixed(2),
        arpu: +globalMetrics.arpu.toFixed(2),
        ltv_avg: +globalMetrics.ltv_avg.toFixed(2),
        gross_margin_pct: +globalMetrics.gross_margin_pct.toFixed(2),
        churn_rate_pct: +globalMetrics.churn_rate_pct.toFixed(2),
        active_tenants: globalMetrics.active_tenants,
        total_tenants: globalMetrics.total_tenants,
      },
      regions: Object.keys(regionMetrics),
      countries: Object.keys(countryMetrics),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Global metrics error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
