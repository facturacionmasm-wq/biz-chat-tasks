// elevenlabs-staff-sync
// Sincroniza el directorio de personal de un tenant con el agente de ElevenLabs:
// 1) Actualiza un bloque delimitado en el prompt del agente con el personal disponible.
// 2) Registra/actualiza la tool `transfer_call` (webhook -> call-transfer) con enums
//    dinámicos de target_user_id / department.
//
// Diseñado para invocarse desde otras edge functions (invite-member, team-management)
// con el service-role key, o desde el super_admin con su JWT.
//
// Body: { tenant_id: string }  (si falta, se toma del tenant del caller)
// Nunca lanza — cualquier error se devuelve como { ok: false, error } con 200.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";
import {
  MAX_CALL_DURATION_SECONDS,
  upsertAgentClosingBlock,
  upsertAgentConfirmationBlock,
  buildAudioRobustnessConfig,
  AUDIO_PLATFORM_AUDIO,
} from "../_shared/elevenlabs-agent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
const STAFF_START = "<!-- STAFF_DIRECTORY_START -->";
const STAFF_END = "<!-- STAFF_DIRECTORY_END -->";
const PERSONALITY_START = "<!-- TENANT_PERSONALITY_START -->";
const PERSONALITY_END = "<!-- TENANT_PERSONALITY_END -->";
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function jsonRes(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function log(...args: unknown[]) {
  console.log("[elevenlabs-staff-sync]", ...args);
}

function warn(...args: unknown[]) {
  console.warn("[elevenlabs-staff-sync]", ...args);
}

function errLog(...args: unknown[]) {
  console.error("[elevenlabs-staff-sync]", ...args);
}

function buildStaffBlock(
  members: Array<{
    user_id: string;
    name: string;
    department: string | null;
    phone: string | null;
    schedule: Array<{ day_of_week: number; start_time: string; end_time: string }>;
  }>,
): string {
  if (members.length === 0) {
    return `${STAFF_START}\nPERSONAL DISPONIBLE PARA TRANSFERENCIA:\n(No hay personal registrado en el sistema todavía.)\n${STAFF_END}`;
  }
  const lines = members.map((m) => {
    const dept = m.department?.trim() || "Sin departamento";
    const phone = m.phone?.trim() || "sin teléfono";
    const schedule = m.schedule.length > 0
      ? m.schedule
        .sort((a, b) => a.day_of_week - b.day_of_week)
        .map((s) => `${DAY_LABELS[s.day_of_week] ?? "?"} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`)
        .join(", ")
      : "sin horario definido";
    return `- ${m.name} — Departamento: ${dept} — Tel: ${phone} — user_id: ${m.user_id} — Horario: ${schedule}`;
  });
  return [
    STAFF_START,
    "PERSONAL DISPONIBLE PARA TRANSFERENCIA:",
    "Usa esta lista para decidir a quién transferir la llamada con la tool `transfer_call`.",
    "Cuando llames a `transfer_call`, pasa el `target_phone` EXACTO (E.164) y `target_name` del empleado más adecuado según el departamento solicitado por el cliente. Nunca inventes números.",
    "",
    ...lines,
    STAFF_END,
  ].join("\n");
}

function upsertStaffBlock(prompt: string, block: string): string {
  const startIdx = prompt.indexOf(STAFF_START);
  const endIdx = prompt.indexOf(STAFF_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = prompt.slice(0, startIdx).trimEnd();
    const after = prompt.slice(endIdx + STAFF_END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n");
  }
  // Append at the end preserving existing prompt
  return `${prompt.trimEnd()}\n\n${block}`;
}

function buildPersonalityBlock(personality: string): string {
  return [
    PERSONALITY_START,
    "PERSONALIDAD Y TONO:",
    personality,
    PERSONALITY_END,
  ].join("\n");
}

function upsertPersonalityBlock(prompt: string, block: string): string {
  const startIdx = prompt.indexOf(PERSONALITY_START);
  const endIdx = prompt.indexOf(PERSONALITY_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = prompt.slice(0, startIdx).trimEnd();
    const after = prompt.slice(endIdx + PERSONALITY_END.length).trimStart();
    return [before, block, after].filter(Boolean).join("\n\n");
  }
  return `${prompt.trimEnd()}\n\n${block}`;
}



function buildActionsHeaders(webhookSecret: string | null) {
  const headers: Array<{ type: string; name: string; value: string }> = [
    { type: "value", name: "Content-Type", value: "application/json" },
  ];
  if (webhookSecret) {
    headers.push({ type: "value", name: "x-elevenlabs-secret", value: webhookSecret });
  }
  return headers;
}

function buildTransferTool(
  supabaseUrl: string,
  members: Array<{ user_id: string; name: string; department: string | null; phone: string | null }>,
  webhookSecret: string | null,
) {
  const depts = Array.from(
    new Set(
      members
        .map((m) => m.department?.trim())
        .filter((d): d is string => !!d && d.length > 0),
    ),
  );
  const phones = Array.from(
    new Set(
      members
        .map((m) => m.phone?.trim())
        .filter((p): p is string => !!p && p.length > 0),
    ),
  );

  return {
    type: "webhook",
    name: "transfer_call",
    description:
      "Transfiere la llamada activa al empleado más adecuado. Debes pasar el `target_phone` en formato E.164 y el `target_name` EXACTOS del directorio de personal incluido en tu prompt. La transferencia usa la llamada Twilio en curso; no necesitas pedir el número al cliente.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/elevenlabs-actions-webhook`,
      method: "POST",
      request_headers: buildActionsHeaders(webhookSecret),
      request_body_schema: {
        type: "object",
        required: ["tool_name", "target_phone", "target_name", "call_sid", "tenant_id"],
        properties: {
          tool_name: {
            type: "string",
            description: "Nombre de la acción a ejecutar.",
            enum: ["transfer_call"],
          },
          target_phone: {
            type: "string",
            description: "Teléfono del empleado destino en formato E.164 (ej. +5215512345678).",
            ...(phones.length > 0 ? { enum: phones } : {}),
          },
          target_name: {
            type: "string",
            description: "Nombre del empleado destino (para el whisper).",
          },
          call_sid: {
            type: "string",
            dynamic_variable: "system__call_sid",
          },
          call_record_id: {
            type: "string",
            dynamic_variable: "call_record_id",
          },
          tenant_id: {
            type: "string",
            dynamic_variable: "tenant_id",
          },
          caller_phone: {
            type: "string",
            dynamic_variable: "system__caller_id",
          },
          department: {
            type: "string",
            description: "Departamento del empleado destino (informativo).",
            ...(depts.length > 0 ? { enum: depts } : {}),
          },
          reason: {
            type: "string",
            description: "Motivo breve de la transferencia para el whisper.",
          },
        },
      },
    },
  };
}

function buildCheckAvailabilityTool(supabaseUrl: string, webhookSecret: string | null) {
  return {
    type: "webhook",
    name: "check_availability",
    description:
      "Consulta los horarios disponibles para agendar una cita en una fecha específica. Llámala SIEMPRE antes de ofrecer u ofrecer horarios al cliente.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/elevenlabs-actions-webhook`,
      method: "POST",
      request_headers: buildActionsHeaders(webhookSecret),
      request_body_schema: {
        type: "object",
        required: ["tool_name", "date"],
        properties: {
          tool_name: { type: "string", description: "Nombre de la acción a ejecutar.", enum: ["check_availability"] },
          date: { type: "string", description: "Fecha a consultar en formato YYYY-MM-DD." },
          employee_id: { type: "string", description: "user_id opcional para filtrar por un empleado específico." },
        },
      },
    },
  };
}

function buildBookAppointmentTool(supabaseUrl: string, webhookSecret: string | null) {
  return {
    type: "webhook",
    name: "book_appointment",
    description:
      "Agenda una cita nueva. Requiere nombre del contacto, fecha (YYYY-MM-DD) y hora (HH:MM 24h en horario local del negocio). Llama primero a check_availability para confirmar que el horario esté libre.",
    response_timeout_secs: 30,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/elevenlabs-actions-webhook`,
      method: "POST",
      request_headers: buildActionsHeaders(webhookSecret),
      request_body_schema: {
        type: "object",
        required: ["tool_name", "contact_name", "date", "time"],
        properties: {
          tool_name: { type: "string", description: "Nombre de la acción a ejecutar.", enum: ["book_appointment"] },
          contact_name: { type: "string", description: "Nombre del cliente para la cita." },
          date: { type: "string", description: "Fecha de la cita en formato YYYY-MM-DD." },
          time: { type: "string", description: "Hora de la cita en formato HH:MM (24h, hora local del negocio)." },
          contact_phone: { type: "string", description: "Teléfono del cliente en E.164 (opcional; si no lo tienes, omítelo)." },
          contact_email: { type: "string", description: "Email del cliente (opcional)." },
          service_type: { type: "string", description: "Tipo de servicio o motivo breve de la cita." },
          employee_id: { type: "string", description: "user_id del empleado a asignar (opcional; si se omite, se asigna automáticamente)." },
          notes: { type: "string", description: "Notas adicionales (opcional)." },
        },
      },
    },
  };
}

function buildRescheduleTool(supabaseUrl: string, webhookSecret: string | null) {
  return {
    type: "webhook",
    name: "reschedule_appointment",
    description: "Reprograma una cita existente a una nueva fecha y hora.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/elevenlabs-actions-webhook`,
      method: "POST",
      request_headers: buildActionsHeaders(webhookSecret),
      request_body_schema: {
        type: "object",
        required: ["tool_name", "appointment_id", "new_date", "new_time"],
        properties: {
          tool_name: { type: "string", description: "Nombre de la acción a ejecutar.", enum: ["reschedule_appointment"] },
          appointment_id: { type: "string", description: "ID (UUID) de la cita a reprogramar." },
          new_date: { type: "string", description: "Nueva fecha en formato YYYY-MM-DD." },
          new_time: { type: "string", description: "Nueva hora en formato HH:MM (24h, hora local)." },
        },
      },
    },
  };
}

function buildCancelTool(supabaseUrl: string, webhookSecret: string | null) {
  return {
    type: "webhook",
    name: "cancel_appointment",
    description: "Cancela una cita existente.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/elevenlabs-actions-webhook`,
      method: "POST",
      request_headers: buildActionsHeaders(webhookSecret),
      request_body_schema: {
        type: "object",
        required: ["tool_name", "appointment_id"],
        properties: {
          tool_name: { type: "string", description: "Nombre de la acción a ejecutar.", enum: ["cancel_appointment"] },
          appointment_id: { type: "string", description: "ID (UUID) de la cita a cancelar." },
        },
      },
    },
  };
}

async function loadTenantDirectory(
  admin: ReturnType<typeof createClient>,
  tenantId: string,
) {
  const { data: profiles, error: profErr } = await admin
    .from("profiles")
    .select("user_id, name, phone, whatsapp_number, department, status, email")
    .eq("tenant_id", tenantId);
  if (profErr) throw new Error(`profiles query failed: ${profErr.message}`);

  // Include 'active' and 'pending_approval' members. Phone is NOT required to
  // appear in the staff directory / transfer_call department enum — it's only
  // used later as the actual transfer number when present.
  const activeProfiles = (profiles ?? []).filter((p: any) => {
    const s = p.status ?? "active";
    return s === "active" || s === "pending_approval";
  });

  const userIds = activeProfiles.map((p: any) => p.user_id);
  let rules: Array<{ user_id: string; day_of_week: number; start_time: string; end_time: string; active: boolean }> = [];
  if (userIds.length > 0) {
    const { data: r, error: rErr } = await admin
      .from("availability_rules")
      .select("user_id, day_of_week, start_time, end_time, active")
      .eq("tenant_id", tenantId)
      .in("user_id", userIds);
    if (rErr) warn("availability_rules query failed:", rErr.message);
    else rules = (r ?? []).filter((x: any) => x.active !== false) as any;
  }

  const byUser: Record<string, typeof rules> = {};
  for (const rule of rules) {
    (byUser[rule.user_id] ??= []).push(rule);
  }

  return activeProfiles.map((p: any) => ({
    user_id: p.user_id as string,
    name: (p.name as string) || (p.email as string) || "Sin nombre",
    department: (p.department as string) || null,
    phone: (p.phone as string) || (p.whatsapp_number as string) || null,
    schedule: (byUser[p.user_id] ?? []).map((s) => ({
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
    })),
  }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY");
  const ELEVENLABS_AGENT_ID = Deno.env.get("ELEVENLABS_AGENT_ID");

  if (!supabaseUrl || !serviceKey || !anonKey) {
    errLog("Missing Supabase env vars");
    return jsonRes({ ok: false, error: "Server not configured" });
  }
  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    warn("ElevenLabs not configured; skipping sync gracefully");
    return jsonRes({ ok: false, skipped: true, error: "ElevenLabs not configured" });
  }

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    const admin = createClient(supabaseUrl, serviceKey);

    const body = await req.json().catch(() => ({}));
    let tenantId: string | null = (body?.tenant_id as string) || null;

    // If no tenant_id given, try to resolve from caller's JWT
    if (!tenantId && authHeader) {
      try {
        const userClient = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: u } = await userClient.auth.getUser();
        if (u?.user) {
          const { data: prof } = await admin
            .from("profiles")
            .select("tenant_id")
            .eq("user_id", u.user.id)
            .maybeSingle();
          tenantId = (prof?.tenant_id as string) || null;
        }
      } catch (e) {
        warn("resolve tenant from JWT failed:", (e as Error).message);
      }
    }

    if (!tenantId) return jsonRes({ ok: false, error: "tenant_id required" });

    // Resolve agent id with strict per-tenant isolation:
    //  - Master tenant may fall back to the global ELEVENLABS_AGENT_ID.
    //  - Any other tenant MUST have its own settings_json.elevenlabs_agent_id;
    //    otherwise we NO-OP so we never contaminate the master/global agent
    //    with another tenant's staff directory or transfer_call enums.
    const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
    let override: string | undefined;
    let welcomeMessage: string | null = null;
    let voiceId: string | null = null;
    let agentPersonality: string | null = null;
    let tenantName: string | null = null;
    let asrKeywordsExtra: string[] = [];
    try {
      const { data: t } = await admin
        .from("tenants")
        .select("name, settings_json")
        .eq("id", tenantId)
        .maybeSingle();
      tenantName = (t?.name as string | null) ?? null;
      const raw = (t?.settings_json as any)?.elevenlabs_agent_id;
      if (raw && typeof raw === "string" && raw.trim().length > 0) {
        override = raw.trim();
      }
      const wm = (t?.settings_json as any)?.welcome_message;
      if (wm && typeof wm === "string" && wm.trim().length > 0) {
        welcomeMessage = wm.trim();
      }
      const vid = (t?.settings_json as any)?.voice_id;
      if (vid && typeof vid === "string" && vid.trim().length > 0) {
        voiceId = vid.trim();
      }
      const ap = (t?.settings_json as any)?.agent_personality;
      if (ap && typeof ap === "string" && ap.trim().length > 0) {
        agentPersonality = ap.trim();
      }
      const kw = (t?.settings_json as any)?.asr_keywords;
      if (Array.isArray(kw)) {
        asrKeywordsExtra = kw.filter((k: unknown): k is string => typeof k === "string");
      }
    } catch (e) {
      warn("tenant settings_json fetch failed:", (e as Error).message);
    }


    let agentId: string;
    if (override) {
      agentId = override;
    } else if (tenantId === MASTER_TENANT_ID) {
      agentId = ELEVENLABS_AGENT_ID;
    } else {
      warn(`skip sync: tenant=${tenantId} has no per-tenant elevenlabs_agent_id`);
      try {
        await admin.from("audit_events").insert({
          tenant_id: tenantId,
          event_type: "elevenlabs_staff_sync_skipped",
          resource_type: "elevenlabs_agent",
          resource_id: null,
          payload: {
            reason: "tenant sin agent_id propio",
            note: "Global ELEVENLABS_AGENT_ID reservado al tenant master; no se escribe agente compartido.",
          },
        });
      } catch (e) {
        warn("audit insert (skipped) failed:", (e as Error).message);
      }
      return jsonRes({
        ok: true,
        skipped: true,
        tenant_id: tenantId,
        reason: "tenant sin agent_id propio",
      });
    }

    const members = await loadTenantDirectory(admin, tenantId);
    log(`tenant=${tenantId} agent=${agentId} members=${members.length}`);

    // Fetch current agent config
    const getRes = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}`, {
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
    });
    if (!getRes.ok) {
      const t = await getRes.text();
      errLog(`GET agent failed [${getRes.status}]: ${t}`);
      return jsonRes({ ok: false, error: `GET agent failed [${getRes.status}]`, details: t });
    }
    const agent = await getRes.json();

    const currentPrompt: string =
      agent?.conversation_config?.agent?.prompt?.prompt ?? "";
    const currentTools: any[] = Array.isArray(agent?.conversation_config?.agent?.prompt?.tools)
      ? agent.conversation_config.agent.prompt.tools
      : [];

    const newBlock = buildStaffBlock(members);
    let newPrompt = upsertStaffBlock(currentPrompt, newBlock);
    // Si el tenant configuró personalidad, inyectamos/actualizamos su bloque delimitado.
    // Si NO viene definida, dejamos el prompt intacto para no pisar ediciones manuales
    // hechas directamente en el dashboard de ElevenLabs.
    if (agentPersonality) {
      newPrompt = upsertPersonalityBlock(newPrompt, buildPersonalityBlock(agentPersonality));
    }
    // Always enforce the closing/farewell instruction block so the agent asks
    // "¿algo más?" and delivers a proper farewell before hanging up.
    newPrompt = upsertAgentClosingBlock(newPrompt);
    // Reinforce audio-noise / cross-talk resilience via prompt instructions.
    newPrompt = upsertAgentConfirmationBlock(newPrompt);
    const webhookSecret = Deno.env.get("ELEVENLABS_WEBHOOK_SECRET") || null;
    const transferTool = buildTransferTool(supabaseUrl, members, webhookSecret);
    const checkAvailTool = buildCheckAvailabilityTool(supabaseUrl, webhookSecret);
    const bookApptTool = buildBookAppointmentTool(supabaseUrl, webhookSecret);
    const reschedTool = buildRescheduleTool(supabaseUrl, webhookSecret);
    const cancelTool = buildCancelTool(supabaseUrl, webhookSecret);
    const managedNames = new Set([
      "transfer_call",
      "check_availability",
      "book_appointment",
      "reschedule_appointment",
      "cancel_appointment",
    ]);
    const nextToolsRaw = [
      ...currentTools.filter((t: any) => !managedNames.has(t?.name)),
      transferTool,
      checkAvailTool,
      bookApptTool,
      reschedTool,
      cancelTool,
    ];

    // Normalize each tool's webhook.api_schema.request_headers to a plain object
    // (ElevenLabs PATCH validator rejects arrays/null; some legacy tools stored arrays).
    let normalizedCount = 0;
    const nextTools = nextToolsRaw.map((tool: any) => {
      const schema = tool?.api_schema ?? tool?.webhook?.api_schema;
      if (!schema) return tool;
      const rh = schema.request_headers;
      const isPlainObj = rh && typeof rh === "object" && !Array.isArray(rh);
      if (isPlainObj) return tool;
      let normalized: Record<string, string> = {};
      if (Array.isArray(rh)) {
        for (const h of rh) {
          if (h && typeof h === "object" && typeof h.name === "string" && typeof h.value === "string") {
            normalized[h.name] = h.value;
          }
        }
      }
      normalizedCount++;
      const nextSchema = { ...schema, request_headers: normalized };
      if (tool?.api_schema) return { ...tool, api_schema: nextSchema };
      return { ...tool, webhook: { ...tool.webhook, api_schema: nextSchema } };
    });
    if (normalizedCount > 0) log(`normalized ${normalizedCount} tool request_headers to dict`);

    const agentPatch: Record<string, unknown> = {
      prompt: {
        prompt: newPrompt,
        tools: nextTools,
      },
    };
    if (welcomeMessage) {
      agentPatch.first_message = welcomeMessage;
    }
    // Audio robustness — inject ASR keywords + turn-detection thresholds.
    const asrKeywords = [
      ...(tenantName ? [tenantName] : []),
      ...members.map((m) => m.name).filter(Boolean),
      ...Array.from(
        new Set(
          members
            .map((m) => m.department?.trim())
            .filter((d): d is string => !!d && d.length > 0),
        ),
      ),
      ...asrKeywordsExtra,
    ];
    const audioCfg = buildAudioRobustnessConfig(asrKeywords);

    const patchBody: Record<string, any> = {
      conversation_config: {
        agent: agentPatch,
        asr: audioCfg.asr,
        turn: audioCfg.turn,
      },
      platform_settings: {
        audio: AUDIO_PLATFORM_AUDIO,
        workspace_overrides: {
          webhooks: {
            ...(Deno.env.get("ELEVENLABS_POST_CALL_WEBHOOK_ID")
              ? { post_call_webhook_id: Deno.env.get("ELEVENLABS_POST_CALL_WEBHOOK_ID") }
              : {}),
            send_audio: false,
          },
        },
      },
    };
    if (voiceId) {
      patchBody.conversation_config.tts = { voice_id: voiceId };
    }
    // Enforce max call duration across all tenant agents.
    patchBody.conversation_config.conversation = { max_duration_seconds: MAX_CALL_DURATION_SECONDS };



    const patchRes = await fetch(`${ELEVENLABS_API_URL}/convai/agents/${agentId}`, {
      method: "PATCH",
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) {
      const t = await patchRes.text();
      errLog(`PATCH agent failed [${patchRes.status}]: ${t}`);
      return jsonRes({ ok: false, error: `PATCH agent failed [${patchRes.status}]`, details: t });
    }

    // Audit log (best-effort)
    try {
      await admin.from("audit_events").insert({
        tenant_id: tenantId,
        event_type: "elevenlabs_staff_sync",
        resource_type: "elevenlabs_agent",
        resource_id: agentId,
        payload: { members_count: members.length, departments: Array.from(new Set(members.map((m) => m.department).filter(Boolean))), welcome_message_updated: !!welcomeMessage, voice_updated: !!voiceId, personality_updated: !!agentPersonality },
      });
    } catch (e) {
      warn("audit insert failed:", (e as Error).message);
    }

    log(`sync ok tenant=${tenantId} members=${members.length}`);
    return jsonRes({ ok: true, tenant_id: tenantId, agent_id: agentId, members_count: members.length });
  } catch (e) {
    errLog("fatal:", (e as Error).message);
    return jsonRes({ ok: false, error: (e as Error).message });
  }
});
