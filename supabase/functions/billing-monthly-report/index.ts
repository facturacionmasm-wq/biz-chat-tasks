import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Monthly cron function that reports usage to Stripe for all active tenants
 * and resets the realtime margin state for the new month.
 * Schedule: Run on 1st of each month at 00:05 UTC
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Get all tenants with active metered subscriptions
    const { data: customers, error } = await supabase
      .from('stripe_customers')
      .select('tenant_id, stripe_metered_item_id')
      .not('stripe_metered_item_id', 'is', null);

    if (error) throw error;
    if (!customers || customers.length === 0) {
      return new Response(JSON.stringify({ message: 'No tenants to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ tenant_id: string; status: string; error?: string }> = [];

    for (const customer of customers) {
      try {
        // Report usage via stripe-billing function
        const reportRes = await fetch(`${SUPABASE_URL}/functions/v1/stripe-billing`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            action: 'report_usage',
            tenant_id: customer.tenant_id,
          }),
        });

        const reportData = await reportRes.json();

        if (reportRes.ok) {
          results.push({ tenant_id: customer.tenant_id, status: 'reported' });
        } else {
          results.push({ tenant_id: customer.tenant_id, status: 'error', error: reportData.error });
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown';
        results.push({ tenant_id: customer.tenant_id, status: 'error', error: msg });
      }
    }

    // Snapshot margin_metrics for previous month
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const prevPeriodStart = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`;

    const { data: marginStates } = await supabase
      .from('realtime_margin_state')
      .select('*');

    if (marginStates) {
      for (const state of marginStates) {
        // Save daily snapshot
        await supabase.from('margin_metrics').upsert({
          tenant_id: state.tenant_id,
          metric_date: prevPeriodStart,
          revenue_mtd: state.current_month_revenue,
          cost_mtd: state.current_month_cost,
          margin_mtd: state.current_month_margin,
          margin_pct_mtd: state.current_month_margin_pct,
          projected_revenue_eom: state.current_month_revenue,
          projected_cost_eom: state.current_month_cost,
          projected_margin_eom: state.current_month_margin,
          risk_level: state.margin_alert_active ? 'high' : 'low',
        }, { onConflict: 'tenant_id,metric_date' });

        // Reset realtime state for new month
        await supabase.from('realtime_margin_state').update({
          current_month_revenue: 0,
          current_month_cost: 0,
          current_month_margin: 0,
          current_month_margin_pct: 0,
          current_month_calls: 0,
          current_month_minutes: 0,
          avg_cost_per_minute: 0,
          avg_revenue_per_minute: 0,
          margin_alert_active: false,
          updated_at: new Date().toISOString(),
        }).eq('tenant_id', state.tenant_id);
      }
    }

    // Audit
    await supabase.from('audit_events').insert({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      event_type: 'billing.monthly_report',
      resource_type: 'system',
      payload: {
        tenants_processed: results.length,
        successful: results.filter(r => r.status === 'reported').length,
        failed: results.filter(r => r.status === 'error').length,
        details: results,
      },
    });

    console.log(`Monthly billing report: ${results.length} tenants processed`);

    return new Response(JSON.stringify({
      success: true,
      tenants_processed: results.length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Monthly billing report error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
