import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, tenant_id, events, period_start, period_end } = await req.json();

    switch (action) {
      // ============================================
      // 1. RECORD USAGE EVENT(S)
      // ============================================
      case 'record_event': {
        if (!tenant_id || !events || !Array.isArray(events)) {
          return new Response(JSON.stringify({ error: 'tenant_id and events[] required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get tenant region
        const { data: tenant } = await supabase
          .from('tenants')
          .select('region, currency, country_code')
          .eq('id', tenant_id)
          .maybeSingle();

        const region = tenant?.region || 'LATAM';

        const rows = events.map((e: any) => ({
          tenant_id,
          region,
          provider: e.provider || 'twilio',
          provider_message_id: e.provider_message_id || null,
          event_type: e.event_type || 'message_out',
          units: e.units || 1,
          occurred_at: e.occurred_at || new Date().toISOString(),
          billing_status: 'pending',
          metadata: e.metadata || {},
        }));

        const { error } = await supabase.from('whatsapp_usage_events').insert(rows);
        if (error) throw error;

        return new Response(JSON.stringify({ success: true, recorded: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================
      // 2. RECONCILE PERIOD COSTS
      // ============================================
      case 'reconcile': {
        if (!period_start || !period_end) {
          return new Response(JSON.stringify({ error: 'period_start and period_end required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get all pending events in period grouped by tenant
        const { data: eventGroups } = await supabase
          .from('whatsapp_usage_events')
          .select('tenant_id, region, event_type, units')
          .gte('occurred_at', period_start)
          .lt('occurred_at', period_end)
          .eq('billing_status', 'pending');

        if (!eventGroups || eventGroups.length === 0) {
          return new Response(JSON.stringify({ message: 'No pending events to reconcile' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Aggregate by tenant
        const tenantAgg: Record<string, { events: number; units: number; region: string }> = {};
        for (const ev of eventGroups) {
          if (!tenantAgg[ev.tenant_id]) {
            tenantAgg[ev.tenant_id] = { events: 0, units: 0, region: ev.region };
          }
          tenantAgg[ev.tenant_id].events++;
          tenantAgg[ev.tenant_id].units += Number(ev.units);
        }

        // Get FX rate for MXN→USD
        const { data: fxRate } = await supabase
          .from('fx_rates')
          .select('rate')
          .eq('base_currency', 'USD')
          .eq('target_currency', 'MXN')
          .order('rate_date', { ascending: false })
          .limit(1)
          .maybeSingle();

        const mxnToUsd = fxRate ? 1 / Number(fxRate.rate) : 1 / 17.5;

        // Cost per message (Twilio WhatsApp): ~$0.005 USD per msg + infra
        const COST_PER_MSG_USD = 0.005;
        const INFRA_PER_MSG_USD = 0.001;
        const MARKUP_PCT = 0.35; // 35% markup

        const results: any[] = [];

        for (const [tid, agg] of Object.entries(tenantAgg)) {
          // Get tenant currency
          const { data: t } = await supabase
            .from('tenants')
            .select('currency')
            .eq('id', tid)
            .maybeSingle();

          const currency = t?.currency || 'MXN';
          const fxToLocal = currency === 'USD' ? 1 : (fxRate ? Number(fxRate.rate) : 17.5);

          const costUsd = agg.units * (COST_PER_MSG_USD + INFRA_PER_MSG_USD);
          const costLocal = costUsd * fxToLocal;
          const revenueUsd = costUsd * (1 + MARKUP_PCT);
          const revenueLocal = revenueUsd * fxToLocal;
          const marginUsd = revenueUsd - costUsd;
          const marginLocal = revenueLocal - costLocal;
          const marginPct = costUsd > 0 ? (marginUsd / revenueUsd) * 100 : 0;

          const { error: upsertErr } = await supabase.from('usage_costs_reconciled').upsert({
            tenant_id: tid,
            period_start,
            period_end,
            region: agg.region,
            total_events: agg.events,
            total_units: agg.units,
            real_cost_local_currency: +costLocal.toFixed(4),
            real_cost_usd: +costUsd.toFixed(4),
            revenue_local_currency: +revenueLocal.toFixed(4),
            revenue_usd: +revenueUsd.toFixed(4),
            margin_local: +marginLocal.toFixed(4),
            margin_usd: +marginUsd.toFixed(4),
            margin_pct: +marginPct.toFixed(2),
            fx_rate_used: fxToLocal,
            currency,
            reconciliation_status: 'reconciled',
            reconciled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id,period_start,period_end' });

          if (upsertErr) {
            console.error(`Reconcile error for ${tid}:`, upsertErr);
          } else {
            results.push({ tenant_id: tid, units: agg.units, cost_usd: +costUsd.toFixed(4), revenue_usd: +revenueUsd.toFixed(4) });
          }
        }

        // Mark events as billed
        await supabase
          .from('whatsapp_usage_events')
          .update({ billing_status: 'billed' })
          .gte('occurred_at', period_start)
          .lt('occurred_at', period_end)
          .eq('billing_status', 'pending');

        return new Response(JSON.stringify({ success: true, reconciled: results.length, results }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================
      // 3. GET USAGE SUMMARY
      // ============================================
      case 'get_summary': {
        if (!tenant_id) {
          return new Response(JSON.stringify({ error: 'tenant_id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const [eventsRes, reconciledRes] = await Promise.all([
          supabase
            .from('whatsapp_usage_events')
            .select('event_type, units')
            .eq('tenant_id', tenant_id)
            .gte('occurred_at', monthStart),
          supabase
            .from('usage_costs_reconciled')
            .select('*')
            .eq('tenant_id', tenant_id)
            .order('period_start', { ascending: false })
            .limit(6),
        ]);

        // Aggregate current month
        let totalUnits = 0;
        const byType: Record<string, number> = {};
        for (const ev of eventsRes.data || []) {
          totalUnits += Number(ev.units);
          byType[ev.event_type] = (byType[ev.event_type] || 0) + Number(ev.units);
        }

        return new Response(JSON.stringify({
          current_month: { total_units: totalUnits, by_type: byType, period_start: monthStart },
          reconciled_history: reconciledRes.data || [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Usage tracking error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
