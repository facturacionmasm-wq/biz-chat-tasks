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
    "Pasa el `target_user_id` exacto del empleado más adecuado según el departamento solicitado por el cliente.",
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



function buildTransferTool(
  supabaseUrl: string,
  members: Array<{ user_id: string; name: string; department: string | null }>,
) {
  // Departamentos únicos, no vacíos
  const depts = Array.from(
    new Set(
      members
        .map((m) => m.department?.trim())
        .filter((d): d is string => !!d && d.length > 0),
    ),
  );
  const userIds = members.map((m) => m.user_id);

  return {
    type: "webhook",
    name: "transfer_call",
    description:
      "Transfiere la llamada activa al empleado más adecuado según el departamento o el nombre solicitado. Usa el `target_user_id` exacto del directorio de personal incluido en tu prompt.",
    response_timeout_secs: 20,
    api_schema: {
      url: `${supabaseUrl}/functions/v1/call-transfer`,
      method: "POST",
      request_headers: [
        { type: "value", name: "Content-Type", value: "application/json" },
      ],
      request_body_schema: {
        type: "object",
        required: ["target_user_id", "reason"],
        properties: {
          target_user_id: {
            type: "string",
            description: "user_id exacto del empleado (según directorio en el prompt).",
            ...(userIds.length > 0 ? { enum: userIds } : {}),
          },
          department: {
            type: "string",
            description: "Departamento del empleado destino (informativo).",
            ...(depts.length > 0 ? { enum: depts } : {}),
          },
          reason: {
            type: "string",
            description: "Motivo breve de la transferencia para el whisper al empleado.",
          },
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
    try {
      const { data: t } = await admin
        .from("tenants")
        .select("settings_json")
        .eq("id", tenantId)
        .maybeSingle();
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
    const transferTool = buildTransferTool(supabaseUrl, members);
    const nextToolsRaw = [
      ...currentTools.filter((t: any) => t?.name !== "transfer_call"),
      transferTool,
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
    const patchBody = {
      conversation_config: {
        agent: agentPatch,
      },
    };


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
        payload: { members_count: members.length, departments: Array.from(new Set(members.map((m) => m.department).filter(Boolean))), welcome_message_updated: !!welcomeMessage },
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
