import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const SYSTEM_PROMPT = `Eres "Aria", el asistente virtual inteligente de OfficeHub — una plataforma SaaS multi-tenant empresarial. Eres experta, profesional, empática y concisa.

## TU ROL
- Asistente operativo 24/7 que ayuda a los usuarios con TODAS las funcionalidades del sistema.
- Guía paso a paso en procesos complejos.
- Soporte técnico interno.
- Detectas errores y sugieres soluciones.
- Generas documentación interactiva bajo demanda.
- **PUEDES gestionar Google Calendar**: consultar, crear, modificar y eliminar eventos directamente.

## ARQUITECTURA DEL SISTEMA
- **Multi-tenant**: Cada empresa (tenant) tiene datos aislados. Todos los datos se filtran por tenant_id.
- **Roles**: super_admin, owner, admin, staff, partner, guest. Los permisos se gestionan por módulo.
- **Base de datos**: PostgreSQL con RLS (Row Level Security) en todas las tablas.
- **Autenticación**: Email/password, Google OAuth, Apple Sign In.
- **Backend**: Edge Functions (Deno) + Lovable Cloud.

## MÓDULOS DISPONIBLES

### 📊 Dashboard
Panel principal con métricas: llamadas, WhatsApp, citas, tareas pendientes. Resumen semanal generado por IA.

### 📞 Llamadas (Twilio + ElevenLabs)
- Agente de voz IA con WebRTC (ElevenLabs).
- Registro automático de llamadas con transcripción.
- Resúmenes automáticos con análisis de sentimiento.
- Transferencia de llamadas con notificaciones.
- Tags y datos extraídos automáticamente.

### 💬 WhatsApp Business
- Bot inteligente "Aria" con flujos diferenciados para clientes y empleados.
- Clientes: registro (nombre/email), agenda, preguntas frecuentes.
- Empleados: acceso por PIN, consulta de agenda/tareas/gastos personales.
- Bandeja de entrada con asignación de agentes.
- Respuestas basadas en Knowledge Hub.

### 📅 Agenda / Citas
- Programación de citas con reglas de disponibilidad por usuario.
- Buffers antes/después, límite de citas por día.
- Integración con Google Calendar (OAuth).
- Recordatorios automáticos por WhatsApp.

### 💬 Chat Interno
- Canales de comunicación por equipo.
- Mensajería en tiempo real.
- Recibos de lectura.

### 📆 Calendario
- Vista de calendario con eventos y citas integradas.

### 📁 Proyectos
- Tableros Kanban con tareas, prioridades y asignaciones.

### 📚 Knowledge Hub
- Repositorio de conocimientos con categorías y tags.
- Búsqueda semántica (RAG) vía IA.
- Visibilidad diferenciada: interno vs externo.
- Importación desde URLs (Firecrawl) y PDFs (visión artificial).
- Sincronización con ElevenLabs para el agente de voz.

### 🎯 OKRs
- Objetivos y resultados clave por equipo.

### 🎓 Entrenamiento IA
- Sandbox para entrenar al bot de WhatsApp.
- Ciclo de aprendizaje: rechazar respuesta incorrecta → corrección manual → se guarda en Knowledge Hub.

### 💰 Gastos
- Registro de gastos con categorías, montos, recibos.
- OCR para tickets.
- Flujo de aprobación.

### 🔑 Credenciales Compartidas
- Bóveda segura para credenciales de plataformas (usuario/contraseña cifrados).

### ⚙️ Configuración
- Perfil personal, branding (logo, colores, favicon), gestión de equipo.
- Invitación de miembros con flujo de aprobación.
- Roles y permisos granulares por módulo.
- Reglas de disponibilidad por usuario.
- PIN de seguridad para WhatsApp.

### 🔗 Integraciones
- Twilio (llamadas/SMS), WhatsApp Business API, ElevenLabs (voz IA), Stripe (facturación), Google Calendar, Firecrawl.

### 🛡️ Auditoría
- Log de todos los eventos del sistema por tenant.

### 💳 Suscripciones
- Planes: Trial → Básico → Pro → Enterprise.
- Stripe para pagos recurrentes.
- Bloqueo automático por trial expirado.

## REGLAS DE COMPORTAMIENTO

1. **Respeta roles**: Si el usuario es staff, no le expliques funciones de admin. Adapta tu respuesta a su rol.
2. **Nunca ejecutes acciones sin confirmación**: Siempre pregunta antes de hacer cambios destructivos (eliminar eventos). Para consultas y creación, puedes actuar directamente.
3. **Sé concisa**: Respuestas claras y accionables. Usa markdown para formatear.
4. **Detecta contexto**: Si el usuario menciona la página en la que está, ofrece ayuda específica.
5. **Modo experto vs básico**: Si detectas jerga técnica, responde en modo experto. Si no, simplifica.
6. **Idioma**: Siempre responde en español a menos que el usuario escriba en otro idioma.
7. **Seguridad**: Nunca reveles datos sensibles, claves API, configuraciones internas del servidor.
8. **Empatía**: Si el usuario reporta un error, muestra comprensión y ofrece soluciones paso a paso.

## GOOGLE CALENDAR - INSTRUCCIONES DE USO DE HERRAMIENTAS

Cuando el usuario pida algo relacionado con su calendario, eventos, citas o agenda de Google:

1. **Consultar eventos**: Usa \`calendar_list_events\` para mostrar los próximos eventos. Formatea los resultados de forma legible.
2. **Crear eventos**: Usa \`calendar_create_event\` con los datos proporcionados. Asegúrate de tener título, fecha/hora inicio y fin. Si falta la hora de fin, asume 1 hora después del inicio.
3. **Modificar eventos**: Primero busca el evento con \`calendar_list_events\`, luego usa \`calendar_update_event\` con el event_id.
4. **Eliminar eventos**: Siempre pide confirmación antes de eliminar. Usa \`calendar_delete_event\`.
5. **Fechas**: Usa formato ISO 8601. Si el usuario dice "mañana a las 3pm", calcula la fecha correcta.
6. **Si el calendario no está conectado**: Indica al usuario que vaya a **Configuración → Google Calendar** para conectar su cuenta.

## CAPACIDADES ESPECIALES

- **Manual de Usuario**: Puedes generar documentación por módulo cuando se solicite.
- **Manual Técnico**: Puedes explicar arquitectura, RLS, edge functions, integraciones.
- **Diagnóstico**: Puedes analizar errores reportados y sugerir soluciones.
- **Optimización**: Puedes sugerir mejores prácticas de uso.
- **Tutoriales**: Puedes crear guías paso a paso para cualquier proceso.
- **Gestión de Calendario**: Puedes ver, crear, editar y eliminar eventos de Google Calendar.

## FORMATO DE RESPUESTAS
- Usa **negrita** para destacar acciones importantes.
- Usa listas numeradas para pasos.
- Usa emojis moderadamente para hacer la conversación amigable.
- Usa bloques de código cuando sea relevante.
- Incluye enlaces internos cuando menciones módulos: "Ve a **Configuración → Equipo**".`;

// Tool definitions for function calling
const CALENDAR_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'calendar_list_events',
      description: 'Lista los próximos eventos del Google Calendar del usuario. Úsalo cuando el usuario quiera ver su agenda, próximos eventos, o buscar un evento específico.',
      parameters: {
        type: 'object',
        properties: {
          time_min: { type: 'string', description: 'Fecha/hora mínima en ISO 8601 (ej: 2026-03-07T00:00:00-06:00). Default: ahora.' },
          time_max: { type: 'string', description: 'Fecha/hora máxima en ISO 8601. Opcional.' },
          max_results: { type: 'number', description: 'Máximo de eventos a retornar (1-50). Default: 10.' },
          query: { type: 'string', description: 'Texto para buscar en eventos. Opcional.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_create_event',
      description: 'Crea un nuevo evento en el Google Calendar del usuario.',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Título del evento.' },
          start_datetime: { type: 'string', description: 'Fecha/hora de inicio en ISO 8601 (ej: 2026-03-10T14:00:00-06:00).' },
          end_datetime: { type: 'string', description: 'Fecha/hora de fin en ISO 8601.' },
          description: { type: 'string', description: 'Descripción del evento. Opcional.' },
          location: { type: 'string', description: 'Ubicación del evento. Opcional.' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Lista de emails de asistentes. Opcional.' },
        },
        required: ['summary', 'start_datetime', 'end_datetime'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_update_event',
      description: 'Modifica un evento existente en Google Calendar. Requiere el event_id del evento a modificar.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID del evento a modificar.' },
          summary: { type: 'string', description: 'Nuevo título. Opcional.' },
          start_datetime: { type: 'string', description: 'Nueva fecha/hora de inicio. Opcional.' },
          end_datetime: { type: 'string', description: 'Nueva fecha/hora de fin. Opcional.' },
          description: { type: 'string', description: 'Nueva descripción. Opcional.' },
          location: { type: 'string', description: 'Nueva ubicación. Opcional.' },
          attendees: { type: 'array', items: { type: 'string' }, description: 'Nueva lista de asistentes. Opcional.' },
        },
        required: ['event_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calendar_delete_event',
      description: 'Elimina un evento de Google Calendar. SIEMPRE pide confirmación al usuario antes de usar esta herramienta.',
      parameters: {
        type: 'object',
        properties: {
          event_id: { type: 'string', description: 'ID del evento a eliminar.' },
        },
        required: ['event_id'],
      },
    },
  },
];

// Map tool name → calendar action
function toolNameToAction(toolName: string): string {
  const map: Record<string, string> = {
    calendar_list_events: 'list_events',
    calendar_create_event: 'create_event',
    calendar_update_event: 'update_event',
    calendar_delete_event: 'delete_event',
  };
  return map[toolName] || toolName;
}

// Execute a calendar tool call via the calendar-tools edge function
async function executeCalendarTool(
  supabaseUrl: string,
  serviceKey: string,
  userId: string,
  toolName: string,
  args: any,
): Promise<string> {
  try {
    const action = toolNameToAction(toolName);
    const res = await fetch(`${supabaseUrl}/functions/v1/calendar-tools`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        'X-Service-Call': 'true',
      },
      body: JSON.stringify({ action, user_id: userId, ...args }),
    });

    const data = await res.json();
    if (!res.ok) {
      return JSON.stringify({ error: data.error || 'Error al ejecutar la acción de calendario', calendar_not_connected: data.calendar_not_connected });
    }
    return JSON.stringify(data);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : 'Error desconocido ejecutando herramienta de calendario' });
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const userId = claimsData.claims.sub as string;

  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    return new Response(JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { messages, currentPage, userRole, conversationId } = await req.json();

    // Build context-aware system message
    let contextualPrompt = SYSTEM_PROMPT;
    
    if (userRole) {
      contextualPrompt += `\n\n## CONTEXTO DEL USUARIO ACTUAL\n- Rol: ${userRole}\n`;
    }
    if (currentPage) {
      contextualPrompt += `- Página actual: ${currentPage}\n`;
    }

    // Add current date/time for calendar context
    contextualPrompt += `- Fecha y hora actual: ${new Date().toISOString()}\n`;
    contextualPrompt += `- Zona horaria de referencia: America/Mexico_City\n`;

    const serviceClient = createClient(supabaseUrl, serviceKey);
    
    // Get user's tenant
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', userId)
      .maybeSingle();

    // Check if user has Google Calendar connected
    let calendarConnected = false;
    if (profile?.tenant_id) {
      const { data: calToken } = await serviceClient
        .from('google_calendar_tokens')
        .select('id, status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle();
      calendarConnected = !!calToken;
    }

    if (calendarConnected) {
      contextualPrompt += `- ✅ Google Calendar: CONECTADO. Puedes usar las herramientas de calendario.\n`;
    } else {
      contextualPrompt += `- ❌ Google Calendar: NO CONECTADO. Si el usuario pide algo del calendario, indícale que vaya a Configuración → Google Calendar.\n`;
    }

    if (profile?.tenant_id) {
      // Get assistant settings
      const { data: settings } = await serviceClient
        .from('assistant_settings')
        .select('custom_instructions, autonomy_level')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (settings?.custom_instructions) {
        contextualPrompt += `\n## INSTRUCCIONES PERSONALIZADAS DEL TENANT\n${settings.custom_instructions}\n`;
      }

      // Get training corrections (highest priority)
      const { data: corrections } = await serviceClient
        .from('knowledge_items')
        .select('title, content, category')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true)
        .eq('category', 'Entrenamiento IA')
        .order('updated_at', { ascending: false })
        .limit(15);

      // Get general knowledge
      const { data: generalKnowledge } = await serviceClient
        .from('knowledge_items')
        .select('title, content, category')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true)
        .neq('category', 'Entrenamiento IA')
        .order('updated_at', { ascending: false })
        .limit(30);

      const allKnowledge = [...(corrections || []), ...(generalKnowledge || [])];

      if (allKnowledge.length > 0) {
        contextualPrompt += `\n## KNOWLEDGE HUB (Base de conocimientos del tenant)\n`;
        contextualPrompt += `IMPORTANTE: Los artículos marcados como [⚠️ CORRECCIÓN] son correcciones humanas y tienen MÁXIMA prioridad.\n\n`;
        allKnowledge.forEach(k => {
          const prefix = k.category === 'Entrenamiento IA' ? '⚠️ CORRECCIÓN' : (k.category || 'General');
          const content = k.category === 'Entrenamiento IA' ? k.content : k.content?.substring(0, 600);
          contextualPrompt += `### ${k.title} [${prefix}]\n${content}\n\n`;
        });
      }
    }

    // ─── AI call with tool-calling loop ───
    const aiMessages: any[] = [
      { role: 'system', content: contextualPrompt },
      ...messages,
    ];

    const MAX_TOOL_ROUNDS = 5;
    let round = 0;
    let finalStream = false;

    while (round < MAX_TOOL_ROUNDS) {
      round++;

      const isLastRound = round === MAX_TOOL_ROUNDS;
      const requestBody: any = {
        model: 'google/gemini-3-flash-preview',
        messages: aiMessages,
      };

      // Only include tools if calendar is connected and not last round
      if (calendarConnected && !isLastRound) {
        requestBody.tools = CALENDAR_TOOLS;
        requestBody.tool_choice = 'auto';
      }

      // On last round or when we want the final answer, stream it
      if (isLastRound || finalStream) {
        requestBody.stream = true;
      }

      const response = await fetch(AI_GATEWAY_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const status = response.status;
        const errText = await response.text();
        console.error(`AI gateway error (round ${round}): ${status} ${errText}`);
        if (status === 429) {
          return new Response(JSON.stringify({ error: 'Límite de solicitudes excedido. Intenta de nuevo en un momento.' }), {
            status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: 'Créditos insuficientes. Contacta al administrador.' }), {
            status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ error: 'Error del servicio de IA' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // If streaming (final answer), pass through
      if (requestBody.stream) {
        return new Response(response.body, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
        });
      }

      // Non-streaming: check for tool calls
      const data = await response.json();
      const choice = data.choices?.[0];

      if (!choice) {
        return new Response(JSON.stringify({ error: 'No response from AI' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const msg = choice.message;

      // If no tool calls, we got a text response — re-request with streaming
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Add the assistant message to context and stream the final response
        aiMessages.push(msg);
        finalStream = true;
        // Actually, we already have the text, so convert to SSE format
        const content = msg.content || '';
        const sseData = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
        return new Response(sseData, {
          headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
        });
      }

      // Process tool calls
      aiMessages.push(msg);

      for (const toolCall of msg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs: any;
        try {
          fnArgs = JSON.parse(toolCall.function.arguments);
        } catch {
          fnArgs = {};
        }

        console.log(`Tool call: ${fnName}`, JSON.stringify(fnArgs));

        const result = await executeCalendarTool(supabaseUrl, serviceKey, userId, fnName, fnArgs);
        console.log(`Tool result: ${result.substring(0, 200)}`);

        aiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // Continue loop — AI will process tool results
    }

    // Should not reach here, but fallback
    return new Response(JSON.stringify({ error: 'Max tool rounds exceeded' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('ai-assistant error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
