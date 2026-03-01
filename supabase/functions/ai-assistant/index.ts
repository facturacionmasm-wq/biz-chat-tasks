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
2. **Nunca ejecutes acciones sin confirmación**: Siempre pregunta antes de hacer cambios.
3. **Sé concisa**: Respuestas claras y accionables. Usa markdown para formatear.
4. **Detecta contexto**: Si el usuario menciona la página en la que está, ofrece ayuda específica.
5. **Modo experto vs básico**: Si detectas jerga técnica, responde en modo experto. Si no, simplifica.
6. **Idioma**: Siempre responde en español a menos que el usuario escriba en otro idioma.
7. **Seguridad**: Nunca reveles datos sensibles, claves API, configuraciones internas del servidor.
8. **Empatía**: Si el usuario reporta un error, muestra comprensión y ofrece soluciones paso a paso.

## CAPACIDADES ESPECIALES

- **Manual de Usuario**: Puedes generar documentación por módulo cuando se solicite.
- **Manual Técnico**: Puedes explicar arquitectura, RLS, edge functions, integraciones.
- **Diagnóstico**: Puedes analizar errores reportados y sugerir soluciones.
- **Optimización**: Puedes sugerir mejores prácticas de uso.
- **Tutoriales**: Puedes crear guías paso a paso para cualquier proceso.

## FORMATO DE RESPUESTAS
- Usa **negrita** para destacar acciones importantes.
- Usa listas numeradas para pasos.
- Usa emojis moderadamente para hacer la conversación amigable.
- Usa bloques de código cuando sea relevante.
- Incluye enlaces internos cuando menciones módulos: "Ve a **Configuración → Equipo**".`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth check
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
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

    // Fetch knowledge items for RAG context
    const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    
    // Get user's tenant
    const { data: profile } = await serviceClient
      .from('profiles')
      .select('tenant_id')
      .eq('user_id', userId)
      .maybeSingle();

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

      // Get recent knowledge items for context
      const { data: knowledge } = await serviceClient
        .from('knowledge_items')
        .select('title, content, category')
        .eq('tenant_id', profile.tenant_id)
        .eq('active', true)
        .limit(10)
        .order('updated_at', { ascending: false });

      if (knowledge && knowledge.length > 0) {
        contextualPrompt += `\n## KNOWLEDGE HUB (Artículos recientes del tenant)\n`;
        knowledge.forEach(k => {
          contextualPrompt += `### ${k.title} [${k.category || 'General'}]\n${k.content?.substring(0, 500)}\n\n`;
        });
      }
    }

    // Stream the response
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-3-flash-preview',
        messages: [
          { role: 'system', content: contextualPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      const errText = await response.text();
      console.error(`AI gateway error: ${status} ${errText}`);
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

    return new Response(response.body, {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });
  } catch (error) {
    console.error('ai-assistant error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
