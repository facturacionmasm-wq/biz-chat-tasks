import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cost rates (configurable via pricing_rules in the future)
const RATES = {
  twilio_per_minute: 0.013,    // USD per minute (Twilio voice)
  ai_per_1k_tokens: 0.00025,  // USD per 1k tokens (Gemini Flash)
  infra_per_minute: 0.002,    // USD per minute (Supabase/hosting share)
  default_markup_pct: 35,     // 35% markup
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { call_record_id, tenant_id, duration_seconds, ai_tokens_used } = await req.json();

    if (!call_record_id || !tenant_id) {
      return new Response(JSON.stringify({ error: 'call_record_id and tenant_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check idempotency
    const { data: existing } = await supabase
      .from('call_costs')
      .select('id')
      .eq('call_record_id', call_record_id)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already calculated', id: existing.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get tenant-specific pricing adjustment
    const { data: adjustment } = await supabase
      .from('tenant_pricing_adjustments')
      .select('adjustment_type, adjustment_value')
      .eq('tenant_id', tenant_id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const markupPct = adjustment?.adjustment_type === 'markup_override'
      ? Number(adjustment.adjustment_value)
      : RATES.default_markup_pct;

    const durationMinutes = Math.max((duration_seconds || 0) / 60, 0.1); // min 6 seconds
    const tokens = ai_tokens_used || 0;

    // Calculate costs
    const costTwilio = +(durationMinutes * RATES.twilio_per_minute).toFixed(4);
    const costAi = +((tokens / 1000) * RATES.ai_per_1k_tokens).toFixed(4);
    const costInfra = +(durationMinutes * RATES.infra_per_minute).toFixed(4);
    const costTotal = +(costTwilio + costAi + costInfra).toFixed(4);
    const revenueCharged = +(costTotal * (1 + markupPct / 100)).toFixed(4);
    const margin = +(revenueCharged - costTotal).toFixed(4);
    const marginPct = costTotal > 0 ? +((margin / revenueCharged) * 100).toFixed(2) : 0;

    // Insert call cost
    const { data: callCost, error: costError } = await supabase
      .from('call_costs')
      .insert({
        call_record_id,
        tenant_id,
        duration_minutes: +durationMinutes.toFixed(2),
        ai_tokens_used: tokens,
        cost_twilio: costTwilio,
        cost_ai: costAi,
        cost_infra: costInfra,
        cost_total: costTotal,
        revenue_charged: revenueCharged,
        margin,
        margin_pct: marginPct,
      })
      .select('id')
      .single();

    if (costError) throw costError;

    // Update realtime margin state (UPSERT)
    const { data: currentState } = await supabase
      .from('realtime_margin_state')
      .select('*')
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    const newRevenue = +(((currentState?.current_month_revenue) || 0) + revenueCharged).toFixed(4);
    const newCost = +(((currentState?.current_month_cost) || 0) + costTotal).toFixed(4);
    const newMargin = +(newRevenue - newCost).toFixed(4);
    const newMarginPct = newRevenue > 0 ? +((newMargin / newRevenue) * 100).toFixed(2) : 0;
    const newCalls = ((currentState?.current_month_calls) || 0) + 1;
    const newMinutes = +(((currentState?.current_month_minutes) || 0) + durationMinutes).toFixed(2);
    const avgCostPerMin = newMinutes > 0 ? +(newCost / newMinutes).toFixed(4) : 0;
    const avgRevPerMin = newMinutes > 0 ? +(newRevenue / newMinutes).toFixed(4) : 0;

    // Margin alert if below 15%
    const marginAlert = newMarginPct < 15;

    await supabase
      .from('realtime_margin_state')
      .upsert({
        tenant_id,
        current_month_revenue: newRevenue,
        current_month_cost: newCost,
        current_month_margin: newMargin,
        current_month_margin_pct: newMarginPct,
        current_month_calls: newCalls,
        current_month_minutes: newMinutes,
        avg_cost_per_minute: avgCostPerMin,
        avg_revenue_per_minute: avgRevPerMin,
        margin_alert_active: marginAlert,
        last_call_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });

    // Update monthly usage aggregate
    const now = new Date();
    const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const periodEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const { data: usageRow } = await supabase
      .from('tenant_usage_monthly')
      .select('id, total_calls, total_minutes, total_ai_tokens, cost_twilio, cost_ai, cost_infra, cost_total, revenue, margin')
      .eq('tenant_id', tenant_id)
      .eq('period_start', periodStart)
      .maybeSingle();

    if (usageRow) {
      const updatedRevenue = +((usageRow.revenue || 0) + revenueCharged).toFixed(4);
      const updatedCost = +((usageRow.cost_total || 0) + costTotal).toFixed(4);
      const updatedMargin = +(updatedRevenue - updatedCost).toFixed(4);
      await supabase
        .from('tenant_usage_monthly')
        .update({
          total_calls: (usageRow.total_calls || 0) + 1,
          total_minutes: +((usageRow.total_minutes || 0) + durationMinutes).toFixed(2),
          total_ai_tokens: (usageRow.total_ai_tokens || 0) + tokens,
          cost_twilio: +((usageRow.cost_twilio || 0) + costTwilio).toFixed(4),
          cost_ai: +((usageRow.cost_ai || 0) + costAi).toFixed(4),
          cost_infra: +((usageRow.cost_infra || 0) + costInfra).toFixed(4),
          cost_total: updatedCost,
          revenue: updatedRevenue,
          margin: updatedMargin,
          margin_pct: updatedRevenue > 0 ? +((updatedMargin / updatedRevenue) * 100).toFixed(2) : 0,
          updated_at: new Date().toISOString(),
        })
        .eq('id', usageRow.id);
    } else {
      await supabase
        .from('tenant_usage_monthly')
        .insert({
          tenant_id,
          period_start: periodStart,
          period_end: periodEnd,
          total_calls: 1,
          total_minutes: +durationMinutes.toFixed(2),
          total_ai_tokens: tokens,
          cost_twilio: costTwilio,
          cost_ai: costAi,
          cost_infra: costInfra,
          cost_total: costTotal,
          revenue: revenueCharged,
          margin,
          margin_pct: marginPct,
        });
    }

    // Fraud detection: check for anomalies
    if (durationMinutes > 120) {
      await supabase.from('fraud_detection_logs').insert({
        tenant_id,
        detection_type: 'unusually_long_call',
        severity: 'warning',
        details: { call_record_id, duration_minutes: durationMinutes },
        action_taken: 'logged',
      });
    }

    if (newCalls > 100 && newMinutes / newCalls < 0.2) {
      await supabase.from('fraud_detection_logs').insert({
        tenant_id,
        detection_type: 'suspected_automated_calls',
        severity: 'high',
        details: { avg_duration: newMinutes / newCalls, total_calls: newCalls },
        action_taken: 'logged',
      });
    }

    console.log(`Cost calculated for call ${call_record_id}: $${costTotal} cost, $${revenueCharged} revenue, ${marginPct}% margin`);

    return new Response(JSON.stringify({
      success: true,
      call_cost_id: callCost.id,
      cost_total: costTotal,
      revenue: revenueCharged,
      margin,
      margin_pct: marginPct,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Calculate usage cost error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
