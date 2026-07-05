import { AI_GATEWAY_URL } from "./constants.ts";
import { AI_TOOLS } from "./tools.ts";
import { executeTool } from "./tool-executor.ts";
import { buildClientPrompt, buildEmployeePrompt } from "./prompts.ts";
import { getAdaptiveProfile, buildAdaptiveContext, analyzeAndLearn } from "./adaptive-learning.ts";

export async function getAIResponse(
  apiKey: string,
  tenantId: string,
  supabase: any,
  mode: 'client' | 'employee',
  userMessage: string,
  conversation: any
): Promise<string> {
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const contactPhone = conversation.contact_phone || '';

  // === KNOWLEDGE RETRIEVAL + ADAPTIVE PROFILE ===
  const [{ data: corrections }, { data: generalKnowledge }, adaptiveProfile] = await Promise.all([
    supabase
      .from('knowledge_items')
      .select('title, content, category, tags')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .eq('category', 'Entrenamiento IA')
      .order('updated_at', { ascending: false })
      .limit(15),
    supabase
      .from('knowledge_items')
      .select('title, content, category, tags')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .neq('category', 'Entrenamiento IA')
      .order('updated_at', { ascending: false })
      .limit(30),
    getAdaptiveProfile(supabase, tenantId, contactPhone),
  ]);

  const allKnowledge = [...(corrections || []), ...(generalKnowledge || [])];
  const knowledgeContext = allKnowledge.map((k: any) => {
    const prefix = k.category === 'Entrenamiento IA' ? '⚠️ CORRECCIÓN PRIORITARIA' : (k.category || 'General');
    const content = k.category === 'Entrenamiento IA' ? k.content : k.content?.substring(0, 800);
    return `[${prefix}] ${k.title}:\n${content}`;
  }).join('\n\n') || '';

  // Get recent messages, employees and tenant info in parallel
  const [{ data: recentMsgs }, { data: employees }, { data: tenantRow }] = await Promise.all([
    supabase
      .from('whatsapp_messages')
      .select('direction, body')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('profiles')
      .select('name, user_id, email, phone')
      .eq('tenant_id', tenantId)
      .eq('status', 'active'),
    supabase
      .from('tenants')
      .select('name, settings_json')
      .eq('id', tenantId)
      .maybeSingle(),
  ]);

  const chatHistory = (recentMsgs || []).reverse().map((m: any) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body || '',
  }));

  // Client mode: only names (no PII). Employee mode: name + email for internal use.
  const employeeListForClient = employees?.map((e: any) => `- ${e.name}`).join('\n') || 'No hay empleados registrados';

  const tenantName = tenantRow?.name || 'el negocio';
  const tz = (tenantRow?.settings_json as any)?.timezone || 'America/Mexico_City';

  // Resolve "now" in the tenant timezone so "today"/"tomorrow" are correct.
  const now = new Date();
  const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false });
  const labelFmt = new Intl.DateTimeFormat('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const todayStr = ymdFmt.format(now); // YYYY-MM-DD
  const currentTime = timeFmt.format(now);
  const todayLabel = labelFmt.format(now);
  // Compute tomorrow in the tenant tz by adding 24h then formatting again.
  const tomorrowDate = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const tomorrowStr = ymdFmt.format(tomorrowDate);
  const tomorrowLabel = labelFmt.format(tomorrowDate);

  const adaptiveContext = buildAdaptiveContext(adaptiveProfile);

  const systemPrompt = mode === 'client'
    ? buildClientPrompt(tenantName, tz, todayStr, tomorrowStr, todayLabel, tomorrowLabel, currentTime, employeeListForClient, knowledgeContext, adaptiveContext)
    : buildEmployeePrompt(conversation.bot_context?.user_name || 'tu compañero', tenantName, tz, todayStr, tomorrowStr, todayLabel, tomorrowLabel, currentTime, knowledgeContext, adaptiveContext);

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory,
      { role: 'user', content: userMessage },
    ];

    // First AI call with tools
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages,
        tools: AI_TOOLS,
      }),
    });

    if (!response.ok) {
      console.error('AI gateway error:', response.status, await response.text());
      return mode === 'client'
        ? 'Disculpa, tengo un problema técnico momentáneo. ¿Podrías intentar de nuevo? 🙏'
        : 'Error al procesar tu solicitud. Intenta de nuevo.';
    }

    const result = await response.json();
    const choice = result.choices?.[0];

    if (!choice) return 'No pude generar una respuesta. Intenta reformular tu pregunta.';

    // Track tools used for adaptive learning
    const toolsUsed: string[] = [];
    // Check if AI wants to call tools
    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls) {
      const toolCalls = choice.message.tool_calls;
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        toolsUsed.push(fnName);
        let fnArgs: any;
        try {
          fnArgs = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments;
        } catch {
          fnArgs = {};
        }

        console.log(`Executing tool: ${fnName}`, JSON.stringify(fnArgs));
        const toolResult = await executeTool(fnName, fnArgs, tenantId, supabase, conversation, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        console.log(`Tool result: ${toolResult.substring(0, 200)}`);

        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: toolResult,
        });
      }

      // Second AI call with tool results
      const followUpResponse = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [...messages, choice.message, ...toolResults],
        }),
      });

      if (!followUpResponse.ok) {
        console.error('AI follow-up error:', followUpResponse.status);
        return 'Ejecuté la acción pero tuve un problema generando la respuesta. Intenta de nuevo.';
      }

      const followUpResult = await followUpResponse.json();
      const finalReply = followUpResult.choices?.[0]?.message?.content || 'Acción ejecutada correctamente.';

      // Async adaptive learning (fire-and-forget)
      analyzeAndLearn(supabase, apiKey, tenantId, contactPhone, userMessage, finalReply, mode, toolsUsed)
        .catch(e => console.error('[ADAPTIVE] async error:', e));

      return finalReply;
    }

    // No tool calls — direct response
    const directReply = choice.message?.content || 'No pude generar una respuesta.';

    // Async adaptive learning (fire-and-forget)
    analyzeAndLearn(supabase, apiKey, tenantId, contactPhone, userMessage, directReply, mode, toolsUsed)
      .catch(e => console.error('[ADAPTIVE] async error:', e));

    return directReply;
  } catch (err) {
    console.error('AI error:', err);
    return 'Disculpa, tengo un problema técnico. Intenta de nuevo en un momento.';
  }
}
