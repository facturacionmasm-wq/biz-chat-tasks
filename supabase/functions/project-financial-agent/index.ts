// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) {
      return json({ error: "unauthorized" }, 401);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json({ error: "unauthorized" }, 401);
    const userId = userRes.user.id;

    const { project_id, trigger_source } = await req.json();
    if (!project_id) return json({ error: "project_id required" }, 400);

    // Get project + verify same tenant / membership
    const { data: project, error: projErr } = await admin
      .from("projects")
      .select("id, name, tenant_id, contract_amount, contract_currency, physical_progress_pct, target_margin_pct, start_date, end_date")
      .eq("id", project_id)
      .maybeSingle();
    if (projErr || !project) return json({ error: "project_not_found" }, 404);

    const { data: profile } = await admin
      .from("profiles").select("tenant_id").eq("user_id", userId).maybeSingle();
    if (!profile || profile.tenant_id !== project.tenant_id) {
      return json({ error: "forbidden" }, 403);
    }

    // Compute metrics via SQL function
    const { data: metrics, error: metricsErr } = await admin
      .rpc("compute_project_financials", { _project_id: project_id });
    if (metricsErr) return json({ error: metricsErr.message }, 500);

    const m: any = metrics || {};

    // Ask AI for a natural-language summary
    let aiSummary = "";
    if (LOVABLE_API_KEY) {
      try {
        const prompt = buildPrompt(project, m);
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash",
            messages: [
              { role: "system", content: "Eres un analista financiero de obra. Responde en español, breve (máx 4 frases), tono profesional, cifras redondeadas, sin markdown." },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (aiRes.ok) {
          const body = await aiRes.json();
          aiSummary = body?.choices?.[0]?.message?.content?.trim() || "";
        } else {
          console.warn("AI gateway", aiRes.status, await aiRes.text());
        }
      } catch (e) {
        console.warn("AI summary failed:", e);
      }
    }
    if (!aiSummary) {
      aiSummary = fallbackSummary(project, m);
    }

    const { data: snap, error: snapErr } = await admin
      .from("project_financial_snapshots")
      .insert({
        tenant_id: project.tenant_id,
        project_id: project.id,
        total_fixed: m.total_fixed ?? 0,
        total_variable: m.total_variable ?? 0,
        total_cost: m.total_cost ?? 0,
        break_even_amount: m.break_even_amount ?? null,
        break_even_progress_pct: m.break_even_progress_pct ?? null,
        recommended_min_price: m.recommended_min_price ?? null,
        projected_total_cost: m.projected_total_cost ?? null,
        projected_profit: m.projected_profit ?? null,
        projected_overrun: m.projected_overrun ?? null,
        cost_performance_index: m.cost_performance_index ?? null,
        physical_progress_pct: m.physical_progress_pct ?? null,
        contract_amount: m.contract_amount ?? null,
        ai_summary: aiSummary,
        alerts: m.alerts ?? [],
        trigger_source: trigger_source ?? "manual",
      })
      .select()
      .single();

    if (snapErr) return json({ error: snapErr.message }, 500);

    return json({ ok: true, snapshot: snap, metrics: m });
  } catch (e: any) {
    console.error("project-financial-agent error", e);
    return json({ error: e?.message || "internal_error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildPrompt(project: any, m: any): string {
  const fmt = (n: any) =>
    n == null ? "N/D" : new Intl.NumberFormat("es-MX", { style: "currency", currency: project.contract_currency || "MXN", maximumFractionDigits: 0 }).format(Number(n));
  return `Obra: ${project.name}
Contrato: ${fmt(project.contract_amount)}
Avance físico: ${project.physical_progress_pct ?? 0}%
Margen objetivo: ${project.target_margin_pct ?? 0}%
Costo fijo acumulado: ${fmt(m.total_fixed)}
Costo variable acumulado: ${fmt(m.total_variable)}
Costo total acumulado: ${fmt(m.total_cost)}
Punto de equilibrio: ${fmt(m.break_even_amount)} (${m.break_even_progress_pct ?? 'N/D'}% del contrato)
Precio mínimo recomendado: ${fmt(m.recommended_min_price)}
Costo total proyectado a fin de obra: ${fmt(m.projected_total_cost)}
Utilidad proyectada: ${fmt(m.projected_profit)}
Sobrecosto proyectado: ${fmt(m.projected_overrun)}
Índice de desempeño de costo (CPI ajustado): ${m.cost_performance_index ?? 'N/D'}
Alertas: ${JSON.stringify(m.alerts || [])}

Redacta un resumen ejecutivo del estado financiero de la obra para el dueño/supervisor, señalando riesgos y recomendaciones concretas.`;
}

function fallbackSummary(project: any, m: any): string {
  const pct = project.physical_progress_pct ?? 0;
  const cost = m.total_cost ?? 0;
  const contract = project.contract_amount ?? 0;
  const spent = contract > 0 ? Math.round((cost / contract) * 100) : 0;
  return `La obra "${project.name}" lleva ${pct}% de avance físico con ${spent}% del contrato consumido en costos. Costo total acumulado ${cost}. Revisa el dashboard para más detalle.`;
}
