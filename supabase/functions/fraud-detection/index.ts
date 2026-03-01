import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * Real-time fraud detection engine.
 * Called after each call to detect anomalies and enforce rate limits.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const {
      tenant_id,
      call_record_id,
      duration_seconds,
      cost_total,
      from_number,
      started_at,
    } = await req.json();

    if (!tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Load thresholds
    const { data: thresholds } = await supabase
      .from('fraud_thresholds')
      .select('*')
      .eq('active', true);

    const getThreshold = (name: string) => {
      const t = (thresholds || []).find((th: any) => th.name === name);
      return t ? { value: Number(t.threshold_value), severity: t.severity, action: t.action } : null;
    };

    const alerts: Array<{
      type: string;
      severity: string;
      action: string;
      details: Record<string, unknown>;
    }> = [];

    const durationMin = (duration_seconds || 0) / 60;

    // ---- Check 1: Unusually long call ----
    const maxDuration = getThreshold('max_call_duration_min');
    if (maxDuration && durationMin > maxDuration.value) {
      alerts.push({
        type: 'unusually_long_call',
        severity: maxDuration.severity,
        action: maxDuration.action,
        details: { duration_minutes: +durationMin.toFixed(2), threshold: maxDuration.value },
      });
    }

    // ---- Check 2: Max cost per call ----
    const maxCost = getThreshold('max_cost_per_call');
    if (maxCost && (cost_total || 0) > maxCost.value) {
      alerts.push({
        type: 'excessive_call_cost',
        severity: maxCost.severity,
        action: maxCost.action,
        details: { cost: cost_total, threshold: maxCost.value },
      });
    }

    // ---- Check 3: Rate limiting ----
    const now = new Date();
    const { data: rateState } = await supabase
      .from('tenant_rate_limits')
      .select('*')
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    let hourCalls = 0;
    let dayCalls = 0;

    if (rateState) {
      // Reset hourly counter if >1 hour old
      const hourReset = new Date(rateState.calls_last_hour_reset_at);
      if (now.getTime() - hourReset.getTime() > 3600000) {
        hourCalls = 1;
      } else {
        hourCalls = (rateState.calls_last_hour || 0) + 1;
      }

      // Reset daily counter if >24h old
      const dayReset = new Date(rateState.calls_last_day_reset_at);
      if (now.getTime() - dayReset.getTime() > 86400000) {
        dayCalls = 1;
      } else {
        dayCalls = (rateState.calls_last_day || 0) + 1;
      }

      // Check spike
      const spikeThreshold = getThreshold('spike_calls_per_hour');
      if (spikeThreshold && hourCalls > spikeThreshold.value / 100 * (rateState.max_calls_per_hour || 60)) {
        alerts.push({
          type: 'call_rate_spike',
          severity: spikeThreshold.severity,
          action: spikeThreshold.action,
          details: { calls_this_hour: hourCalls, max_per_hour: rateState.max_calls_per_hour },
        });
      }

      // Check hourly limit
      if (hourCalls > (rateState.max_calls_per_hour || 60)) {
        alerts.push({
          type: 'hourly_rate_limit_exceeded',
          severity: 'high',
          action: 'rate_limit',
          details: { calls_this_hour: hourCalls, limit: rateState.max_calls_per_hour },
        });
      }

      // Check daily limit
      if (dayCalls > (rateState.max_calls_per_day || 500)) {
        alerts.push({
          type: 'daily_rate_limit_exceeded',
          severity: 'critical',
          action: 'block_temp',
          details: { calls_today: dayCalls, limit: rateState.max_calls_per_day },
        });
      }

      // Update rate state
      await supabase.from('tenant_rate_limits').update({
        calls_last_hour: hourCalls,
        calls_last_hour_reset_at: now.getTime() - hourReset.getTime() > 3600000 ? now.toISOString() : rateState.calls_last_hour_reset_at,
        calls_last_day: dayCalls,
        calls_last_day_reset_at: now.getTime() - dayReset.getTime() > 86400000 ? now.toISOString() : rateState.calls_last_day_reset_at,
        updated_at: now.toISOString(),
      }).eq('tenant_id', tenant_id);
    } else {
      // Initialize rate limit state
      await supabase.from('tenant_rate_limits').insert({
        tenant_id,
        calls_last_hour: 1,
        calls_last_hour_reset_at: now.toISOString(),
        calls_last_day: 1,
        calls_last_day_reset_at: now.toISOString(),
      });
    }

    // ---- Check 4: Short call bot detection ----
    const minAvgDuration = getThreshold('min_avg_duration_sec');
    if (minAvgDuration && duration_seconds && duration_seconds < minAvgDuration.value && hourCalls > 5) {
      // Check average duration of recent calls
      const { data: recentCalls } = await supabase
        .from('call_records')
        .select('duration')
        .eq('tenant_id', tenant_id)
        .order('created_at', { ascending: false })
        .limit(10);

      if (recentCalls && recentCalls.length >= 5) {
        const avgDuration = recentCalls.reduce((s: number, c: any) => s + (c.duration || 0), 0) / recentCalls.length;
        if (avgDuration < minAvgDuration.value) {
          alerts.push({
            type: 'suspected_automated_calls',
            severity: minAvgDuration.severity,
            action: minAvgDuration.action,
            details: { avg_duration_sec: +avgDuration.toFixed(1), threshold: minAvgDuration.value, recent_count: recentCalls.length },
          });
        }
      }
    }

    // ---- Check 5: Daily cost limit ----
    const dailyCostLimit = getThreshold('daily_cost_limit');
    if (dailyCostLimit) {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const { data: todayCosts } = await supabase
        .from('call_costs')
        .select('cost_total')
        .eq('tenant_id', tenant_id)
        .gte('created_at', todayStart);

      const totalCostToday = (todayCosts || []).reduce((s: number, c: any) => s + Number(c.cost_total), 0);
      if (totalCostToday > dailyCostLimit.value) {
        alerts.push({
          type: 'daily_cost_limit_exceeded',
          severity: dailyCostLimit.severity,
          action: dailyCostLimit.action,
          details: { total_cost_today: +totalCostToday.toFixed(2), limit: dailyCostLimit.value },
        });
      }
    }

    // ---- Check 6: Unusual hours ----
    if (started_at) {
      const callHour = new Date(started_at).getUTCHours();
      // Adjust for Mexico City (UTC-6)
      const localHour = (callHour - 6 + 24) % 24;
      if (localHour >= 2 && localHour <= 5) {
        const unusualThreshold = getThreshold('unusual_hours_threshold');
        if (unusualThreshold) {
          // Check percentage of recent calls in unusual hours
          const { data: recentCalls } = await supabase
            .from('call_records')
            .select('started_at')
            .eq('tenant_id', tenant_id)
            .order('created_at', { ascending: false })
            .limit(20);

          if (recentCalls && recentCalls.length >= 5) {
            const unusualCount = recentCalls.filter((c: any) => {
              const h = new Date(c.started_at).getUTCHours();
              const lh = (h - 6 + 24) % 24;
              return lh >= 2 && lh <= 5;
            }).length;
            const unusualPct = (unusualCount / recentCalls.length) * 100;
            if (unusualPct >= unusualThreshold.value) {
              alerts.push({
                type: 'unusual_hours_pattern',
                severity: unusualThreshold.severity,
                action: unusualThreshold.action,
                details: { unusual_pct: +unusualPct.toFixed(1), threshold: unusualThreshold.value },
              });
            }
          }
        }
      }
    }

    // ---- Process alerts ----
    let blocked = false;
    for (const alert of alerts) {
      // Log to fraud_detection_logs
      await supabase.from('fraud_detection_logs').insert({
        tenant_id,
        detection_type: alert.type,
        severity: alert.severity,
        details: { ...alert.details, call_record_id, from_number },
        action_taken: alert.action,
      });

      // Apply blocking actions
      if (alert.action === 'block_temp' && !blocked) {
        const blockUntil = new Date(now.getTime() + 3600000); // 1 hour block
        await supabase.from('tenant_rate_limits').upsert({
          tenant_id,
          is_blocked: true,
          blocked_reason: alert.type,
          blocked_at: now.toISOString(),
          blocked_until: blockUntil.toISOString(),
          updated_at: now.toISOString(),
        }, { onConflict: 'tenant_id' });
        blocked = true;

        // Notify super admin
        await supabase.from('audit_events').insert({
          tenant_id,
          event_type: 'fraud.tenant_blocked',
          resource_type: 'tenant_rate_limits',
          payload: { alert_type: alert.type, details: alert.details, blocked_until: blockUntil.toISOString() },
        });
      }
    }

    const response = {
      success: true,
      alerts_count: alerts.length,
      blocked,
      alerts: alerts.map(a => ({ type: a.type, severity: a.severity, action: a.action })),
    };

    if (alerts.length > 0) {
      console.log(`Fraud detection: ${alerts.length} alert(s) for tenant ${tenant_id}`, alerts.map(a => a.type));
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Fraud detection error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
