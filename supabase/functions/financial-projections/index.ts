import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // 1. Gather historical data
    const [marginRes, metricsRes, churnRes, callCostsRes, tenantsRes] = await Promise.all([
      supabase.from("realtime_margin_state").select("*"),
      supabase.from("margin_metrics").select("*").order("metric_date", { ascending: false }).limit(90),
      supabase.from("tenant_churn_scores").select("*").order("churn_probability", { ascending: false }).limit(20),
      supabase.from("call_costs").select("tenant_id, cost_total, revenue_charged, duration_minutes, created_at")
        .gte("created_at", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("profiles").select("tenant_id, name").limit(100),
    ]);

    const margins = marginRes.data || [];
    const metrics = metricsRes.data || [];
    const churnScores = churnRes.data || [];
    const callCosts = callCostsRes.data || [];

    // Aggregate current state
    const totalRevenueMTD = margins.reduce((s, m) => s + Number(m.current_month_revenue), 0);
    const totalCostMTD = margins.reduce((s, m) => s + Number(m.current_month_cost), 0);
    const totalCallsMTD = margins.reduce((s, m) => s + m.current_month_calls, 0);
    const totalMinutesMTD = margins.reduce((s, m) => s + Number(m.current_month_minutes), 0);
    const activeTenants = margins.length;
    const highRiskTenants = churnScores.filter(c => c.risk_category === "high").length;
    const avgMarginPct = totalRevenueMTD > 0 ? ((totalRevenueMTD - totalCostMTD) / totalRevenueMTD * 100) : 0;

    // Monthly trends from margin_metrics (last 3 months)
    const monthlyTrends = metrics.reduce((acc: any[], m: any) => {
      const month = m.metric_date.slice(0, 7);
      let existing = acc.find(a => a.month === month);
      if (!existing) {
        existing = { month, revenue: 0, cost: 0, margin: 0, count: 0 };
        acc.push(existing);
      }
      existing.revenue += Number(m.revenue_mtd);
      existing.cost += Number(m.cost_mtd);
      existing.margin += Number(m.margin_mtd);
      existing.count++;
      return acc;
    }, []).slice(0, 3);

    // Daily call volume trend (last 30 days)
    const dailyCalls = callCosts.reduce((acc: Record<string, { calls: number; revenue: number; cost: number }>, c: any) => {
      const day = c.created_at.slice(0, 10);
      if (!acc[day]) acc[day] = { calls: 0, revenue: 0, cost: 0 };
      acc[day].calls++;
      acc[day].revenue += Number(c.revenue_charged);
      acc[day].cost += Number(c.cost_total);
      return acc;
    }, {});

    const inputData = {
      totalRevenueMTD,
      totalCostMTD,
      totalCallsMTD,
      totalMinutesMTD,
      activeTenants,
      highRiskTenants,
      avgMarginPct: avgMarginPct.toFixed(1),
      monthlyTrends,
      dailyCallsSample: Object.entries(dailyCalls).slice(0, 15).map(([d, v]) => ({ date: d, ...v as any })),
      churnHighRisk: churnScores.filter(c => c.risk_category === "high").length,
      churnMediumRisk: churnScores.filter(c => c.risk_category === "medium").length,
    };

    // 2. Call Lovable AI for projections using tool calling
    const systemPrompt = `Eres un analista financiero senior de una plataforma SaaS multi-tenant de comunicaciones (llamadas con IA, WhatsApp, citas).
Analiza los datos históricos proporcionados y genera proyecciones financieras precisas a 30, 60 y 90 días.
Considera tendencias de crecimiento, estacionalidad, riesgo de churn y márgenes históricos.
Las monedas son en MXN (pesos mexicanos).
Fecha actual: ${new Date().toISOString().slice(0, 10)}.`;

    const userPrompt = `Datos financieros actuales del SaaS:
${JSON.stringify(inputData, null, 2)}

Genera proyecciones financieras para los próximos 30, 60 y 90 días basándote en estos datos.`;

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "save_financial_projections",
              description: "Save financial projections for 30, 60 and 90 day horizons",
              parameters: {
                type: "object",
                properties: {
                  projections: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        horizon_days: { type: "integer", enum: [30, 60, 90] },
                        projected_revenue: { type: "number", description: "Projected total revenue in MXN" },
                        projected_cost: { type: "number", description: "Projected total cost in MXN" },
                        projected_margin: { type: "number", description: "Projected margin (revenue - cost) in MXN" },
                        projected_margin_pct: { type: "number", description: "Projected margin percentage" },
                        projected_calls: { type: "integer", description: "Projected number of calls" },
                        projected_minutes: { type: "number", description: "Projected minutes of usage" },
                        confidence_score: { type: "number", description: "Confidence 0-1, where 1 is highest confidence" },
                        risk_factors: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              factor: { type: "string" },
                              impact: { type: "string", enum: ["high", "medium", "low"] },
                              description: { type: "string" },
                            },
                            required: ["factor", "impact", "description"],
                          },
                        },
                        opportunities: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              opportunity: { type: "string" },
                              potential_revenue: { type: "number" },
                              description: { type: "string" },
                            },
                            required: ["opportunity", "potential_revenue", "description"],
                          },
                        },
                      },
                      required: ["horizon_days", "projected_revenue", "projected_cost", "projected_margin", "projected_margin_pct", "projected_calls", "projected_minutes", "confidence_score", "risk_factors", "opportunities"],
                    },
                  },
                  narrative: { type: "string", description: "Executive summary in Spanish of the financial outlook, 3-5 sentences" },
                },
                required: ["projections", "narrative"],
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "save_financial_projections" } },
      }),
    });

    if (!aiResponse.ok) {
      const errText = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, errText);
      
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded, try again later" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: "Payment required for AI credits" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      return new Response(JSON.stringify({ error: "AI projection failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await aiResponse.json();
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    
    if (!toolCall?.function?.arguments) {
      console.error("No tool call in AI response:", JSON.stringify(aiData));
      return new Response(JSON.stringify({ error: "AI did not return structured projections" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = JSON.parse(toolCall.function.arguments);
    const { projections, narrative } = result;

    // 3. Store projections in DB
    const today = new Date().toISOString().slice(0, 10);
    
    // Delete old projections for today (idempotent)
    await supabase.from("financial_projections").delete().eq("projection_date", today);

    const records = projections.map((p: any) => ({
      projection_date: today,
      horizon_days: p.horizon_days,
      projected_revenue: p.projected_revenue,
      projected_cost: p.projected_cost,
      projected_margin: p.projected_margin,
      projected_margin_pct: p.projected_margin_pct,
      projected_calls: p.projected_calls,
      projected_minutes: p.projected_minutes,
      confidence_score: p.confidence_score,
      risk_factors: p.risk_factors,
      opportunities: p.opportunities,
      ai_narrative: narrative,
      model_version: "v1-gemini-3-flash",
      input_data: inputData,
    }));

    const { error: insertError } = await supabase.from("financial_projections").insert(records);
    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Failed to save projections" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      projections_count: records.length,
      narrative,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("financial-projections error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
