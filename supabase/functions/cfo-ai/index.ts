// deno-lint-ignore-file no-explicit-any
// CFO AI · Fase 1 — reutiliza el patrón de project-financial-agent.
// Valida JWT, resuelve tenant server-side, arma contexto agregado y acotado,
// llama a Lovable AI Gateway (google/gemini-2.5-flash) y devuelve reply.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { messages } = await req.json().catch(() => ({ messages: [] }));
    if (!Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages required" }, 400);
    }

    // Resolver tenant del usuario (server-side, ignora cualquier tenant del body).
    const { data: profile } = await admin
      .from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
    const tenantId = profile?.tenant_id;
    if (!tenantId) return json({ error: "no_tenant" }, 403);

    // Context service: consultas agregadas + acotadas.
    const context = await buildFinancialContext(admin, tenantId);

    const systemPrompt = `Eres el CFO AI de la empresa. Respondes SOLO con los datos financieros agregados del tenant activo. Nunca inventes cifras. Cifras en la moneda base indicada. Responde en español, breve y profesional, sin markdown salvo listas cortas.

CONTEXTO FINANCIERO ACTUAL (agregado, tenant activo):
${JSON.stringify(context, null, 2)}`;

    if (!LOVABLE_API_KEY) {
      return json({ reply: fallbackReply(context, messages[messages.length - 1]?.content ?? "") });
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.slice(-10),
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.warn("cfo-ai gateway", aiRes.status, errText);
      if (aiRes.status === 429) return json({ error: "rate_limited", reply: "Muchas consultas seguidas. Intenta en un momento." }, 429);
      if (aiRes.status === 402) return json({ error: "credits_exhausted", reply: "Se agotaron los créditos de IA del workspace." }, 402);
      return json({ reply: fallbackReply(context, messages[messages.length - 1]?.content ?? "") });
    }
    const body = await aiRes.json();
    const reply = body?.choices?.[0]?.message?.content?.trim() || fallbackReply(context, messages[messages.length - 1]?.content ?? "");

    // Auditoría ligera
    await admin.from("audit_events").insert({
      tenant_id: tenantId, event_type: "cfo_ai_query", actor_id: userId,
      resource_type: "cfo_ai", resource_id: null,
      payload: { last_user_message: messages[messages.length - 1]?.content?.slice(0, 200) ?? "" },
    }).select().maybeSingle();

    return json({ reply, context });
  } catch (e: any) {
    console.error("cfo-ai error", e);
    return json({ error: e?.message || "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function buildFinancialContext(admin: any, tenantId: string) {
  const [summary, health, accountsRes, alertsRes, budgetsRes] = await Promise.all([
    admin.rpc("compute_tenant_financial_summary", { _tenant_id: tenantId }),
    admin.rpc("compute_tenant_health_score", { _tenant_id: tenantId }),
    admin.from("financial_accounts").select("name, currency, current_balance, status").eq("tenant_id", tenantId).eq("is_hidden", false).limit(20),
    admin.from("financial_alerts").select("alert_type, severity, message").eq("tenant_id", tenantId).eq("status", "active").limit(10),
    admin.from("financial_budgets").select("name, period_start, period_end, total_planned, currency").eq("tenant_id", tenantId).limit(10),
  ]);
  return {
    summary: summary.data ?? {},
    health: health.data ?? {},
    accounts: accountsRes.data ?? [],
    active_alerts: alertsRes.data ?? [],
    budgets: budgetsRes.data ?? [],
  };
}

function fallbackReply(ctx: any, question: string): string {
  const s = ctx?.summary ?? {};
  const balance = s.total_balance ?? 0;
  const net = s.net_flow ?? 0;
  return `Consulta: "${question}". Saldo consolidado ${balance}. Flujo neto del período ${net}. Runway estimado ${s.runway_days ?? 'N/D'} días. Puntaje financiero ${ctx?.health?.score ?? 'N/D'}/100.`;
}
