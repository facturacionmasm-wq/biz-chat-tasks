import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Churn prediction engine + automatic retention offers.
 * Runs weekly via cron. Analyzes usage, payment, and margin signals
 * to calculate churn probability and generate personalized offers.
 */

// ---- Churn Signal Weights ----
const WEIGHTS = {
  usage_decline: 0.25,        // Declining usage trend
  payment_failures: 0.20,     // Recent payment issues
  low_frequency: 0.15,        // Infrequent usage
  negative_margin: 0.10,      // Sustained negative margin
  support_issues: 0.05,       // Error frequency
  growth_stagnation: 0.10,    // No growth
  engagement_drop: 0.15,      // Drop in call frequency
};

interface ChurnSignals {
  usageDeclineScore: number;
  paymentFailureScore: number;
  lowFrequencyScore: number;
  negativeMarginScore: number;
  errorFrequencyScore: number;
  growthStagnationScore: number;
  engagementDropScore: number;
}

function calculateChurnProbability(signals: ChurnSignals): number {
  const raw = (
    signals.usageDeclineScore * WEIGHTS.usage_decline +
    signals.paymentFailureScore * WEIGHTS.payment_failures +
    signals.lowFrequencyScore * WEIGHTS.low_frequency +
    signals.negativeMarginScore * WEIGHTS.negative_margin +
    signals.errorFrequencyScore * WEIGHTS.support_issues +
    signals.growthStagnationScore * WEIGHTS.growth_stagnation +
    signals.engagementDropScore * WEIGHTS.engagement_drop
  );
  // Clamp to [0, 1]
  return Math.min(Math.max(+raw.toFixed(4), 0), 1);
}

function getRiskCategory(probability: number): string {
  if (probability >= 0.7) return 'high';
  if (probability >= 0.4) return 'medium';
  return 'low';
}

// ---- Retention offer logic ----
interface OfferDecision {
  shouldOffer: boolean;
  offerType: string;
  description: string;
  discountPct: number | null;
  durationDays: number;
  estimatedMarginImpact: number;
}

function decideOffer(
  churnProbability: number,
  marginPct: number,
  avgRevenue: number,
  topSignal: string
): OfferDecision {
  // No offer for low risk
  if (churnProbability < 0.4) {
    return { shouldOffer: false, offerType: 'none', description: '', discountPct: null, durationDays: 0, estimatedMarginImpact: 0 };
  }

  // High churn + positive margin → discount to retain
  if (churnProbability >= 0.7 && marginPct > 20) {
    const discount = Math.min(Math.round(churnProbability * 30), 25);
    return {
      shouldOffer: true,
      offerType: 'discount',
      description: `Descuento del ${discount}% por ${churnProbability >= 0.85 ? 3 : 2} meses para retención prioritaria`,
      discountPct: discount,
      durationDays: churnProbability >= 0.85 ? 90 : 60,
      estimatedMarginImpact: -(avgRevenue * (discount / 100) * (churnProbability >= 0.85 ? 3 : 2)),
    };
  }

  // Churn due to high price → personalized downgrade
  if (topSignal === 'usage_decline' && marginPct > 30) {
    return {
      shouldOffer: true,
      offerType: 'downgrade_offer',
      description: 'Plan reducido personalizado con tarifa optimizada para su nivel de uso actual',
      discountPct: null,
      durationDays: 30,
      estimatedMarginImpact: -(avgRevenue * 0.15),
    };
  }

  // Churn due to low usage → free credits
  if (topSignal === 'low_frequency' || topSignal === 'engagement_drop') {
    return {
      shouldOffer: true,
      offerType: 'free_credits',
      description: '100 minutos gratuitos para reactivar el uso del servicio',
      discountPct: null,
      durationDays: 30,
      estimatedMarginImpact: -(100 * 0.015), // cost of 100 minutes
    };
  }

  // Churn with negative margin → adjust pricing, no discount
  if (marginPct < 0) {
    return {
      shouldOffer: true,
      offerType: 'pricing_adjustment',
      description: 'Optimización de tarifa para garantizar continuidad del servicio con sostenibilidad mutua',
      discountPct: null,
      durationDays: 30,
      estimatedMarginImpact: avgRevenue * 0.10, // positive: we increase margin
    };
  }

  // Medium churn → temporary upgrade
  if (churnProbability >= 0.4 && churnProbability < 0.7) {
    return {
      shouldOffer: true,
      offerType: 'temporary_upgrade',
      description: 'Upgrade gratuito al siguiente plan por 30 días para experimentar beneficios premium',
      discountPct: null,
      durationDays: 30,
      estimatedMarginImpact: -(avgRevenue * 0.05),
    };
  }

  return { shouldOffer: false, offerType: 'none', description: '', discountPct: null, durationDays: 0, estimatedMarginImpact: 0 };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const targetTenantId = body.tenant_id;

    // Get active tenants
    let query = supabase
      .from('tenant_subscriptions')
      .select('tenant_id, status, stripe_subscription_id')
      .in('status', ['active', 'trialing', 'past_due']);

    if (targetTenantId) query = query.eq('tenant_id', targetTenantId);

    const { data: tenants, error } = await query;
    if (error) throw error;
    if (!tenants || tenants.length === 0) {
      return new Response(JSON.stringify({ message: 'No tenants to evaluate' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{
      tenant_id: string;
      churn_probability: number;
      risk_category: string;
      offer_generated: boolean;
      offer_type?: string;
    }> = [];

    let totalHighRisk = 0;
    let totalMediumRisk = 0;
    let totalLowRisk = 0;
    let totalOffers = 0;

    for (const tenant of tenants) {
      try {
        // ---- Gather signals ----

        // 1. Usage history (last 3 months)
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        const cutoff = `${threeMonthsAgo.getFullYear()}-${String(threeMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`;

        const { data: usageHistory } = await supabase
          .from('tenant_usage_monthly')
          .select('total_minutes, total_calls, revenue, cost_total, margin_pct, period_start')
          .eq('tenant_id', tenant.tenant_id)
          .gte('period_start', cutoff)
          .order('period_start', { ascending: true });

        const months = usageHistory || [];

        // 2. Realtime margin
        const { data: marginState } = await supabase
          .from('realtime_margin_state')
          .select('*')
          .eq('tenant_id', tenant.tenant_id)
          .maybeSingle();

        // 3. Payment failures (audit events)
        const { data: paymentEvents } = await supabase
          .from('audit_events')
          .select('id')
          .eq('tenant_id', tenant.tenant_id)
          .eq('event_type', 'subscription.payment_failed')
          .gte('created_at', threeMonthsAgo.toISOString());

        // 4. Fraud alerts
        const { data: fraudAlerts } = await supabase
          .from('fraud_detection_logs')
          .select('id')
          .eq('tenant_id', tenant.tenant_id)
          .gte('created_at', threeMonthsAgo.toISOString());

        // ---- Calculate signals ----
        const signals: ChurnSignals = {
          usageDeclineScore: 0,
          paymentFailureScore: 0,
          lowFrequencyScore: 0,
          negativeMarginScore: 0,
          errorFrequencyScore: 0,
          growthStagnationScore: 0,
          engagementDropScore: 0,
        };

        // Usage decline
        if (months.length >= 2) {
          const firstMonth = Number(months[0].total_minutes);
          const lastMonth = Number(months[months.length - 1].total_minutes);
          if (firstMonth > 0) {
            const changeRate = (lastMonth - firstMonth) / firstMonth;
            if (changeRate < -0.3) signals.usageDeclineScore = 1;
            else if (changeRate < -0.15) signals.usageDeclineScore = 0.7;
            else if (changeRate < 0) signals.usageDeclineScore = 0.3;
          }
        } else if (months.length === 0) {
          signals.usageDeclineScore = 0.8; // No data = concerning
        }

        // Payment failures
        const failCount = paymentEvents?.length || 0;
        if (failCount >= 3) signals.paymentFailureScore = 1;
        else if (failCount >= 2) signals.paymentFailureScore = 0.7;
        else if (failCount >= 1) signals.paymentFailureScore = 0.4;

        // Low frequency
        const avgCalls = months.length > 0
          ? months.reduce((s: number, m: any) => s + Number(m.total_calls), 0) / months.length
          : 0;
        if (avgCalls < 5) signals.lowFrequencyScore = 1;
        else if (avgCalls < 20) signals.lowFrequencyScore = 0.6;
        else if (avgCalls < 50) signals.lowFrequencyScore = 0.2;

        // Negative margin
        const avgMargin = months.length > 0
          ? months.reduce((s: number, m: any) => s + Number(m.margin_pct), 0) / months.length
          : 0;
        if (avgMargin < -10) signals.negativeMarginScore = 1;
        else if (avgMargin < 0) signals.negativeMarginScore = 0.7;
        else if (avgMargin < 10) signals.negativeMarginScore = 0.3;

        // Error frequency (fraud alerts as proxy)
        const alertCount = fraudAlerts?.length || 0;
        if (alertCount >= 5) signals.errorFrequencyScore = 1;
        else if (alertCount >= 2) signals.errorFrequencyScore = 0.5;

        // Growth stagnation
        if (months.length >= 3) {
          const growth = months.map((m: any) => Number(m.total_minutes));
          const isStagnant = growth.every((v: number, i: number) =>
            i === 0 || Math.abs(v - growth[i - 1]) < growth[i - 1] * 0.05
          );
          if (isStagnant && avgCalls < 30) signals.growthStagnationScore = 0.8;
          else if (isStagnant) signals.growthStagnationScore = 0.4;
        }

        // Engagement drop
        if (months.length >= 2) {
          const lastMonthCalls = Number(months[months.length - 1].total_calls);
          const prevMonthCalls = Number(months[months.length - 2].total_calls);
          if (prevMonthCalls > 0) {
            const dropRate = (prevMonthCalls - lastMonthCalls) / prevMonthCalls;
            if (dropRate > 0.5) signals.engagementDropScore = 1;
            else if (dropRate > 0.3) signals.engagementDropScore = 0.6;
            else if (dropRate > 0.1) signals.engagementDropScore = 0.3;
          }
        }

        // Past due adds to churn
        if (tenant.status === 'past_due') {
          signals.paymentFailureScore = Math.max(signals.paymentFailureScore, 0.8);
        }

        // ---- Calculate churn probability ----
        const churnProbability = calculateChurnProbability(signals);
        const riskCategory = getRiskCategory(churnProbability);

        // Find top signal
        const signalScores = [
          { name: 'usage_decline', score: signals.usageDeclineScore * WEIGHTS.usage_decline },
          { name: 'payment_failures', score: signals.paymentFailureScore * WEIGHTS.payment_failures },
          { name: 'low_frequency', score: signals.lowFrequencyScore * WEIGHTS.low_frequency },
          { name: 'negative_margin', score: signals.negativeMarginScore * WEIGHTS.negative_margin },
          { name: 'engagement_drop', score: signals.engagementDropScore * WEIGHTS.engagement_drop },
          { name: 'growth_stagnation', score: signals.growthStagnationScore * WEIGHTS.growth_stagnation },
        ];
        const topSignal = signalScores.sort((a, b) => b.score - a.score)[0].name;

        // Save churn score
        await supabase.from('tenant_churn_scores').insert({
          tenant_id: tenant.tenant_id,
          churn_probability: churnProbability,
          risk_category: riskCategory,
          factors: {
            signals,
            top_signal: topSignal,
            months_analyzed: months.length,
            avg_calls: +avgCalls.toFixed(1),
            avg_margin_pct: +avgMargin.toFixed(2),
            payment_failures: failCount,
            fraud_alerts: alertCount,
          },
          model_version: 'v1',
        });

        // Count by risk
        if (riskCategory === 'high') totalHighRisk++;
        else if (riskCategory === 'medium') totalMediumRisk++;
        else totalLowRisk++;

        // ---- Generate retention offer ----
        const avgRevenue = months.length > 0
          ? months.reduce((s: number, m: any) => s + Number(m.revenue), 0) / months.length
          : 0;

        const currentMarginPct = marginState?.current_month_margin_pct || avgMargin;

        const offer = decideOffer(churnProbability, currentMarginPct, avgRevenue, topSignal);

        let offerGenerated = false;
        if (offer.shouldOffer) {
          // Check no active offer exists
          const { data: activeOffer } = await supabase
            .from('retention_offers')
            .select('id')
            .eq('tenant_id', tenant.tenant_id)
            .eq('status', 'pending')
            .maybeSingle();

          if (!activeOffer) {
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + offer.durationDays);

            const { data: newOffer } = await supabase
              .from('retention_offers')
              .insert({
                tenant_id: tenant.tenant_id,
                offer_type: offer.offerType,
                description: offer.description,
                discount_pct: offer.discountPct,
                duration_days: offer.durationDays,
                estimated_margin_impact: +offer.estimatedMarginImpact.toFixed(4),
                status: 'pending',
                expires_at: expiresAt.toISOString(),
              })
              .select('id')
              .single();

            // Record in offer history
            if (newOffer) {
              await supabase.from('tenant_offer_history').insert({
                tenant_id: tenant.tenant_id,
                offer_id: newOffer.id,
                offer_type: offer.offerType,
                status: 'sent',
                churn_score_at_time: churnProbability,
                margin_at_time: currentMarginPct,
              });
            }

            offerGenerated = true;
            totalOffers++;

            // Audit
            await supabase.from('audit_events').insert({
              tenant_id: tenant.tenant_id,
              event_type: 'retention.offer_generated',
              resource_type: 'retention_offers',
              resource_id: newOffer?.id,
              payload: {
                offer_type: offer.offerType,
                churn_probability: churnProbability,
                risk_category: riskCategory,
                top_signal: topSignal,
              },
            });
          }
        }

        results.push({
          tenant_id: tenant.tenant_id,
          churn_probability: churnProbability,
          risk_category: riskCategory,
          offer_generated: offerGenerated,
          offer_type: offerGenerated ? offer.offerType : undefined,
        });

        console.log(`Tenant ${tenant.tenant_id}: churn=${churnProbability.toFixed(3)}, risk=${riskCategory}, offer=${offerGenerated ? offer.offerType : 'none'}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        console.error(`Error evaluating tenant ${tenant.tenant_id}:`, msg);
        results.push({
          tenant_id: tenant.tenant_id,
          churn_probability: -1,
          risk_category: 'error',
          offer_generated: false,
        });
      }
    }

    // Save model metrics
    const avgChurn = results.filter(r => r.churn_probability >= 0).length > 0
      ? +(results.filter(r => r.churn_probability >= 0).reduce((s, r) => s + r.churn_probability, 0) / results.filter(r => r.churn_probability >= 0).length).toFixed(4)
      : 0;

    await supabase.from('churn_model_metrics').insert({
      model_version: 'v1',
      tenants_evaluated: results.length,
      avg_churn_probability: avgChurn,
      high_risk_count: totalHighRisk,
      medium_risk_count: totalMediumRisk,
      low_risk_count: totalLowRisk,
      offers_generated: totalOffers,
    });

    // System audit
    await supabase.from('audit_events').insert({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      event_type: 'churn.model_run',
      resource_type: 'system',
      payload: {
        tenants_evaluated: results.length,
        high_risk: totalHighRisk,
        medium_risk: totalMediumRisk,
        low_risk: totalLowRisk,
        offers_generated: totalOffers,
        avg_churn_probability: avgChurn,
      },
    });

    return new Response(JSON.stringify({
      success: true,
      tenants_evaluated: results.length,
      high_risk: totalHighRisk,
      medium_risk: totalMediumRisk,
      low_risk: totalLowRisk,
      offers_generated: totalOffers,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Churn engine error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
