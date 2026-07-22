// Fase 4 · Cron dominical: genera briefing semanal del CFO AI por tenant.
// Autenticación por header x-cron-secret.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { buildFinancialContext } from '../_shared/cfo-context.ts';
import { notifyTenantAdmin } from '../_shared/notify-admin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const shared = Deno.env.get('CRON_SHARED_SECRET');
  const provided = req.headers.get('x-cron-secret');
  if (!shared || provided !== shared) return json({ error: 'unauthorized' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: tenants } = await admin.from('tenants').select('id, name');
  const weekStart = mondayOf(new Date()).toISOString().slice(0, 10);

  const results: Array<{ tenant_id: string; status: string; error?: string }> = [];
  for (const t of tenants ?? []) {
    const tenantId = t.id as string;
    try {
      // Skip if already generated this week
      const { data: existing } = await admin
        .from('cfo_ai_briefings')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('week_start', weekStart)
        .maybeSingle();
      if (existing?.id) { results.push({ tenant_id: tenantId, status: 'exists' }); continue; }

      const ctx = await buildFinancialContext(admin, tenantId);
      const summary = await generateBriefing(ctx);

      const { error: insErr } = await admin.from('cfo_ai_briefings').insert({
        tenant_id: tenantId,
        week_start: weekStart,
        summary,
        context_snapshot: ctx as unknown as Record<string, unknown>,
      });
      if (insErr) { results.push({ tenant_id: tenantId, status: 'insert_error', error: insErr.message }); continue; }

      try {
        await notifyTenantAdmin(admin, {
          tenantId,
          subject: `Briefing semanal · ${t.name}`,
          body: summary,
          eventType: 'cfo_ai_weekly_briefing',
        });
      } catch { /* best-effort */ }

      results.push({ tenant_id: tenantId, status: 'ok' });
    } catch (e) {
      results.push({ tenant_id: tenantId, status: 'error', error: (e as Error).message });
    }
  }

  return json({ ok: true, week_start: weekStart, results });
});

async function generateBriefing(ctx: any): Promise<string> {
  const system = 'Eres el CFO AI. Redacta un briefing ejecutivo semanal (máx 6 bullets) en español, sin markdown salvo guiones. Cubre: saldo consolidado, flujo neto, top 3 gastos, alertas activas, runway y una recomendación concreta.';
  const user = `CONTEXTO:\n${JSON.stringify(ctx, null, 2)}`;
  if (!LOVABLE_API_KEY) return fallbackBriefing(ctx);
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) return fallbackBriefing(ctx);
    const body = await res.json();
    return body?.choices?.[0]?.message?.content?.trim() || fallbackBriefing(ctx);
  } catch {
    return fallbackBriefing(ctx);
  }
}

function fallbackBriefing(ctx: any): string {
  const s = ctx?.summary ?? {};
  const h = ctx?.health ?? {};
  const alerts = (ctx?.active_alerts ?? []).length;
  return [
    `- Saldo consolidado: ${s.total_balance ?? 'N/D'}`,
    `- Flujo neto (30d): ${s.net_flow ?? 'N/D'}`,
    `- Runway: ${s.runway_days ?? 'N/D'} días`,
    `- Alertas activas: ${alerts}`,
    `- Puntaje financiero: ${h.score ?? 'N/D'}/100`,
    `- Recomendación: revisa el detalle en el módulo de Finanzas.`,
  ].join('\n');
}

function mondayOf(d: Date): Date {
  const nd = new Date(d);
  const day = nd.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  nd.setUTCDate(nd.getUTCDate() - diff);
  nd.setUTCHours(0, 0, 0, 0);
  return nd;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
