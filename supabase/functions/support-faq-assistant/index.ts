import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres Aria, la asistente de soporte de OfficeHub (plataforma SaaS multi-tenant).
Tu rol es responder preguntas frecuentes sobre uso de la plataforma: onboarding, integraciones (WhatsApp, Voz, Google Calendar, Stripe, Drive), planes y facturación, permisos y roles, gestión de tickets, notificaciones, y funciones generales.

Reglas:
- Responde en español, tono humano y directo. Máximo 4-6 frases por respuesta salvo que pidan detalle.
- Nunca inventes procedimientos: si no sabes con certeza, dilo y ofrece escalar a un humano.
- Nunca pidas contraseñas, tokens o llaves API.
- Si el usuario pide hablar con una persona, quiere reembolso, reporta un bug crítico, o el tema excede FAQ, sugiere claramente "Hablar con un humano" para escalar.
- No menciones WhatsApp como canal de contacto de soporte a la plataforma. El soporte se atiende por correo y por el chat interno de tickets.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "AI not configured" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: profile } = await admin
      .from("profiles")
      .select("tenant_id, name, email")
      .eq("user_id", user.id)
      .maybeSingle();
    if (!profile?.tenant_id) return json({ error: "No tenant" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    if (action === "ask") {
      const history: Array<{ role: string; content: string }> = Array.isArray(body.history) ? body.history : [];
      const message: string = String(body.message || "").trim();
      if (!message) return json({ error: "message required" }, 400);

      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.slice(-10).map(h => ({ role: h.role === "user" ? "user" : "assistant", content: String(h.content || "") })),
        { role: "user", content: message },
      ];

      const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages,
        }),
      });

      if (!aiRes.ok) {
        const t = await aiRes.text();
        console.error("AI gateway error", aiRes.status, t);
        if (aiRes.status === 429) return json({ error: "Demasiadas solicitudes, intenta en un minuto" }, 429);
        if (aiRes.status === 402) return json({ error: "Créditos IA agotados. Contacta al administrador." }, 402);
        return json({ error: "AI error" }, 500);
      }
      const data = await aiRes.json();
      const reply = data?.choices?.[0]?.message?.content ?? "Lo siento, no pude generar una respuesta.";
      return json({ reply });
    }

    if (action === "escalate") {
      const subject: string = String(body.subject || "Escalación desde Aria").slice(0, 200);
      const summary: string = String(body.summary || "").slice(0, 4000);
      const transcript: Array<{ role: string; content: string }> = Array.isArray(body.transcript) ? body.transcript : [];
      const priority = ["urgent", "high", "normal", "low"].includes(body.priority) ? body.priority : "normal";

      const slaMap: Record<string, { first: number; res: number }> = {
        urgent: { first: 15, res: 60 },
        high: { first: 60, res: 240 },
        normal: { first: 240, res: 1440 },
        low: { first: 1440, res: 4320 },
      };
      const sla = slaMap[priority];
      const now = new Date();
      const description = summary || transcript.map(t => `${t.role === "user" ? "Usuario" : "Aria"}: ${t.content}`).join("\n\n").slice(0, 4000) || "Escalado desde Aria sin resumen.";

      const { data: ticket, error: ticketErr } = await admin
        .from("support_tickets")
        .insert({
          tenant_id: profile.tenant_id,
          subject,
          description,
          priority,
          status: "open",
          channel: "ai_escalation",
          created_by: user.id,
          sla_first_response_at: new Date(now.getTime() + sla.first * 60000).toISOString(),
          sla_resolution_at: new Date(now.getTime() + sla.res * 60000).toISOString(),
          tags: ["aria_escalation"],
          ai_summary: summary || null,
        })
        .select("id")
        .single();
      if (ticketErr) throw ticketErr;

      // Insert transcript as internal note for the agent
      if (transcript.length > 0) {
        const transcriptBody = transcript.map(t => `${t.role === "user" ? "Usuario" : "Aria"}: ${t.content}`).join("\n\n");
        await admin.from("ticket_messages").insert({
          ticket_id: ticket.id,
          tenant_id: profile.tenant_id,
          author_type: "system",
          author_id: user.id,
          body: `Transcripción con Aria antes de escalar:\n\n${transcriptBody}`.slice(0, 8000),
          is_internal_note: true,
        });
      }

      // Fire-and-forget email to super admin
      try {
        await admin.functions.invoke("send-support-email", {
          body: {
            subject: `[Aria] ${subject}`,
            message: description,
            priority,
            contact_email: profile.email,
          },
          headers: { Authorization: authHeader },
        });
      } catch (e) {
        console.warn("send-support-email failed (non-blocking)", (e as Error).message);
      }

      return json({ success: true, ticket_id: ticket.id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("support-faq-assistant error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
