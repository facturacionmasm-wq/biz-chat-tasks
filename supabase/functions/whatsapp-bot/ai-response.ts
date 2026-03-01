import { AI_GATEWAY_URL } from "./constants.ts";
import { AI_TOOLS } from "./tools.ts";
import { executeTool } from "./tool-executor.ts";
import { buildClientPrompt, buildEmployeePrompt } from "./prompts.ts";

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

  // === KNOWLEDGE RETRIEVAL ===
  const [{ data: corrections }, { data: generalKnowledge }] = await Promise.all([
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
  ]);

  const allKnowledge = [...(corrections || []), ...(generalKnowledge || [])];
  const knowledgeContext = allKnowledge.map((k: any) => {
    const prefix = k.category === 'Entrenamiento IA' ? '⚠️ CORRECCIÓN PRIORITARIA' : (k.category || 'General');
    const content = k.category === 'Entrenamiento IA' ? k.content : k.content?.substring(0, 800);
    return `[${prefix}] ${k.title}:\n${content}`;
  }).join('\n\n') || '';

  // Get recent messages and employees in parallel
  const [{ data: recentMsgs }, { data: employees }] = await Promise.all([
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
  ]);

  const chatHistory = (recentMsgs || []).reverse().map((m: any) => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.body || '',
  }));

  const employeeList = employees?.map((e: any) => `- ${e.name} (${e.email || 'sin email'})`).join('\n') || 'No hay empleados registrados';

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentTime = today.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  const systemPrompt = mode === 'client'
    ? buildClientPrompt(todayStr, currentTime, employeeList, knowledgeContext)
    : buildEmployeePrompt(conversation.bot_context?.user_name || 'tu compañero', todayStr, currentTime, knowledgeContext);

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

    // Check if AI wants to call tools
    if (choice.finish_reason === 'tool_calls' || choice.message?.tool_calls) {
      const toolCalls = choice.message.tool_calls;
      const toolResults: any[] = [];

      for (const tc of toolCalls) {
        const fnName = tc.function.name;
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
      return followUpResult.choices?.[0]?.message?.content || 'Acción ejecutada correctamente.';
    }

    // No tool calls — direct response
    return choice.message?.content || 'No pude generar una respuesta.';
  } catch (err) {
    console.error('AI error:', err);
    return 'Disculpa, tengo un problema técnico. Intenta de nuevo en un momento.';
  }
}
