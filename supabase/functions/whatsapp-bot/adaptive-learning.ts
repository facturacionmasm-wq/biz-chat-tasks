// Adaptive learning engine for WhatsApp bot
// Analyzes interactions and updates user profiles for personalized responses

import { AI_GATEWAY_URL } from "./constants.ts";

interface AdaptiveProfile {
  tone_profile: {
    formality: 'formal' | 'neutral' | 'casual';
    verbosity: 'brief' | 'normal' | 'detailed';
    emoji_level: 'none' | 'minimal' | 'moderate' | 'heavy';
    detected_language: string;
  };
  learned_defaults: Record<string, string>;
  interaction_patterns: {
    frequent_actions: Array<{ action: string; count: number }>;
    active_hours: number[];
    weekly_patterns: Record<string, string[]>;
  };
  process_shortcuts: {
    skip_confirmations: boolean;
    auto_fill_fields: Record<string, string>;
  };
  recent_learnings: Array<{
    type: 'correction' | 'preference' | 'pattern' | 'shortcut';
    content: string;
    timestamp: string;
  }>;
  interaction_count: number;
  positive_signals: number;
  negative_signals: number;
}

/**
 * Get or create adaptive profile for a contact
 */
export async function getAdaptiveProfile(
  supabase: any,
  tenantId: string,
  contactPhone: string
): Promise<AdaptiveProfile | null> {
  const { data } = await supabase
    .from('bot_adaptive_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('contact_phone', contactPhone)
    .maybeSingle();

  return data || null;
}

/**
 * Build adaptive context string for injection into AI prompts
 */
export function buildAdaptiveContext(profile: AdaptiveProfile | null): string {
  if (!profile || profile.interaction_count < 3) return '';

  const parts: string[] = [];

  // Tone adaptation
  const tone = profile.tone_profile;
  if (tone.formality !== 'neutral' || tone.verbosity !== 'normal' || tone.emoji_level !== 'moderate') {
    const toneDesc: string[] = [];
    if (tone.formality === 'formal') toneDesc.push('usa un tono más formal y profesional');
    if (tone.formality === 'casual') toneDesc.push('usa un tono más casual y relajado, como con un amigo');
    if (tone.verbosity === 'brief') toneDesc.push('sé extremadamente breve, este usuario prefiere respuestas cortas');
    if (tone.verbosity === 'detailed') toneDesc.push('da respuestas más detalladas, este usuario aprecia la información completa');
    if (tone.emoji_level === 'none' || tone.emoji_level === 'minimal') toneDesc.push('usa pocos o ningún emoji');
    if (tone.emoji_level === 'heavy') toneDesc.push('usa emojis generosamente');
    if (toneDesc.length > 0) {
      parts.push(`ADAPTACIÓN DE TONO: ${toneDesc.join('. ')}.`);
    }
  }

  // Learned defaults
  const defaults = profile.learned_defaults;
  if (Object.keys(defaults).length > 0) {
    const defaultsStr = Object.entries(defaults)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    parts.push(`VALORES POR DEFECTO APRENDIDOS (usa estos si el usuario no especifica): ${defaultsStr}`);
  }

  // Process shortcuts
  const shortcuts = profile.process_shortcuts;
  if (shortcuts.skip_confirmations) {
    parts.push('ATAJO: Este usuario prefiere ejecución directa sin confirmaciones adicionales.');
  }
  if (Object.keys(shortcuts.auto_fill_fields).length > 0) {
    const autoFill = Object.entries(shortcuts.auto_fill_fields)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ');
    parts.push(`AUTO-COMPLETAR: Si no se especifica, usa: ${autoFill}`);
  }

  // Frequent actions
  const freqActions = profile.interaction_patterns.frequent_actions;
  if (freqActions.length > 0) {
    const topActions = freqActions
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(a => `${a.action} (${a.count}x)`)
      .join(', ');
    parts.push(`ACCIONES FRECUENTES: ${topActions}. Anticipa estas necesidades.`);
  }

  // Recent learnings
  const learnings = profile.recent_learnings;
  if (learnings.length > 0) {
    const recentStr = learnings
      .slice(-5)
      .map(l => `- [${l.type}] ${l.content}`)
      .join('\n');
    parts.push(`LECCIONES RECIENTES APRENDIDAS:\n${recentStr}`);
  }

  if (parts.length === 0) return '';

  return `\n\n=== PERFIL ADAPTATIVO DEL USUARIO (interacciones: ${profile.interaction_count}) ===\n${parts.join('\n')}\n=== FIN PERFIL ADAPTATIVO ===`;
}

/**
 * Analyze an interaction and update the adaptive profile
 * Called asynchronously after each bot response
 */
export async function analyzeAndLearn(
  supabase: any,
  apiKey: string,
  tenantId: string,
  contactPhone: string,
  userMessage: string,
  botReply: string,
  botState: string,
  toolsUsed: string[]
): Promise<void> {
  try {
    // Get or create profile
    const { data: existing } = await supabase
      .from('bot_adaptive_profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('contact_phone', contactPhone)
      .maybeSingle();

    const currentHour = new Date().getHours();
    const dayOfWeek = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'][new Date().getDay()];

    if (!existing) {
      // Create initial profile
      await supabase.from('bot_adaptive_profiles').insert({
        tenant_id: tenantId,
        contact_phone: contactPhone,
        interaction_count: 1,
        last_interaction_at: new Date().toISOString(),
        interaction_patterns: {
          frequent_actions: toolsUsed.length > 0
            ? toolsUsed.map(t => ({ action: t, count: 1 }))
            : [],
          active_hours: [currentHour],
          weekly_patterns: { [dayOfWeek]: [botState] },
        },
      });
      return;
    }

    // Update interaction count and patterns
    const patterns = existing.interaction_patterns || { frequent_actions: [], active_hours: [], weekly_patterns: {} };
    
    // Update active hours (keep unique, rolling)
    const activeHours = [...new Set([...(patterns.active_hours || []), currentHour])].slice(-24);
    
    // Update frequent actions
    const freqActions = patterns.frequent_actions || [];
    for (const tool of toolsUsed) {
      const existing_action = freqActions.find((a: any) => a.action === tool);
      if (existing_action) {
        existing_action.count++;
      } else {
        freqActions.push({ action: tool, count: 1 });
      }
    }

    // Update weekly patterns
    const weeklyPatterns = patterns.weekly_patterns || {};
    const dayActions = weeklyPatterns[dayOfWeek] || [];
    if (toolsUsed.length > 0) {
      dayActions.push(...toolsUsed);
      weeklyPatterns[dayOfWeek] = dayActions.slice(-20); // Keep last 20 per day
    }

    // Detect signals from user message
    const negativeSignals = /\b(no|mal|error|incorrecto|equivocad|otra vez|repite|no entend|no era|está mal|wrong)\b/i.test(userMessage);
    const positiveSignals = /\b(gracias|genial|perfecto|excelente|bien|listo|cool|super|increíble|wow|buenísimo)\b/i.test(userMessage);

    // Detect tone preferences from user's message style
    const toneUpdates: Record<string, any> = {};
    const msgLen = userMessage.length;
    const hasEmojis = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(userMessage);
    const isFormal = /\b(usted|estimad|atentamente|cordialmente|por favor|le solicito|me permito)\b/i.test(userMessage);
    const isCasual = /\b(we|wey|neta|chido|orale|nmms|jaja|xd|lol|bro)\b/i.test(userMessage);

    const currentTone = existing.tone_profile || { formality: 'neutral', verbosity: 'normal', emoji_level: 'moderate', detected_language: 'es-MX' };
    
    // Only update tone after enough interactions to be confident
    if (existing.interaction_count >= 5) {
      if (isFormal && currentTone.formality !== 'formal') toneUpdates.formality = 'formal';
      if (isCasual && currentTone.formality !== 'casual') toneUpdates.formality = 'casual';
      if (hasEmojis) toneUpdates.emoji_level = 'heavy';
    }

    // Every 10 interactions, do a deeper AI analysis
    const shouldDeepAnalyze = existing.interaction_count > 0 && existing.interaction_count % 10 === 0;
    let deepLearnings: any[] = [];

    if (shouldDeepAnalyze && apiKey) {
      deepLearnings = await performDeepAnalysis(apiKey, existing, userMessage, botReply, toolsUsed);
    }

    // Merge learnings
    const recentLearnings = existing.recent_learnings || [];
    if (negativeSignals) {
      recentLearnings.push({
        type: 'correction',
        content: `Usuario expresó insatisfacción. Mensaje: \"${userMessage.substring(0, 100)}\"`,
        timestamp: new Date().toISOString(),
      });
    }
    deepLearnings.forEach(l => recentLearnings.push(l));
    
    // Keep only last 20 learnings
    const trimmedLearnings = recentLearnings.slice(-20);

    // Build update
    const update: Record<string, any> = {
      interaction_count: existing.interaction_count + 1,
      last_interaction_at: new Date().toISOString(),
      interaction_patterns: {
        frequent_actions: freqActions.sort((a: any, b: any) => b.count - a.count).slice(0, 15),
        active_hours: activeHours,
        weekly_patterns: weeklyPatterns,
      },
      recent_learnings: trimmedLearnings,
    };

    if (positiveSignals) update.positive_signals = existing.positive_signals + 1;
    if (negativeSignals) update.negative_signals = existing.negative_signals + 1;

    if (Object.keys(toneUpdates).length > 0) {
      update.tone_profile = { ...currentTone, ...toneUpdates };
    }

    // Auto-learn defaults from repeated patterns
    if (existing.interaction_count >= 8) {
      const learnedDefaults = existing.learned_defaults || {};
      // Check if user always mentions the same employee
      const empMentions = freqActions.filter((a: any) => a.action === 'schedule_appointment');
      if (empMentions.length > 0 && empMentions[0].count >= 3) {
        // The AI will pick up on this through the frequent_actions context
      }
      update.learned_defaults = learnedDefaults;
    }

    // Auto-enable skip_confirmations if user consistently shows impatience
    if (existing.interaction_count >= 15) {
      const shortcuts = existing.process_shortcuts || { skip_confirmations: false, auto_fill_fields: {} };
      const briefRatio = (msgLen < 30 ? 1 : 0);
      // If negative signals are high relative to interactions, enable shortcuts
      if (existing.negative_signals > existing.interaction_count * 0.15 && !shortcuts.skip_confirmations) {
        shortcuts.skip_confirmations = true;
        update.process_shortcuts = shortcuts;
        trimmedLearnings.push({
          type: 'shortcut',
          content: 'Auto-habilitado: ejecución directa sin confirmaciones extras (usuario muestra preferencia por rapidez)',
          timestamp: new Date().toISOString(),
        });
        update.recent_learnings = trimmedLearnings;
      }
    }

    await supabase
      .from('bot_adaptive_profiles')
      .update(update)
      .eq('id', existing.id);

  } catch (err) {
    console.error('[ADAPTIVE] Learning error (non-fatal):', err);
  }
}

/**
 * Deep analysis using AI every N interactions
 */
async function performDeepAnalysis(
  apiKey: string,
  profile: any,
  lastUserMsg: string,
  lastBotReply: string,
  toolsUsed: string[]
): Promise<Array<{ type: string; content: string; timestamp: string }>> {
  try {
    const response = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          {
            role: 'system',
            content: `Eres un motor de análisis de comportamiento de usuario. Analiza el perfil de interacción y el último intercambio para extraer lecciones de mejora.

Perfil actual:
- Interacciones: ${profile.interaction_count}
- Señales positivas: ${profile.positive_signals}
- Señales negativas: ${profile.negative_signals}
- Tono: ${JSON.stringify(profile.tone_profile)}
- Acciones frecuentes: ${JSON.stringify(profile.interaction_patterns?.frequent_actions || [])}
- Atajos activos: ${JSON.stringify(profile.process_shortcuts)}

Responde SOLO en JSON con este formato:
{
  "learnings": [
    {"type": "preference|pattern|shortcut|correction", "content": "descripción concisa de la lección"}
  ],
  "tone_update": {"formality": "formal|neutral|casual", "verbosity": "brief|normal|detailed"} // solo si detectas cambio claro
  "suggested_defaults": {"key": "value"} // valores por defecto sugeridos
}

Si no hay nada notable que aprender, devuelve: {"learnings": []}`,
          },
          {
            role: 'user',
            content: `Último mensaje del usuario: \"${lastUserMsg.substring(0, 300)}\"\nRespuesta del bot: \"${lastBotReply.substring(0, 300)}\"\nHerramientas usadas: ${toolsUsed.join(', ') || 'ninguna'}`,
          },
        ],
      }),
    });

    if (!response.ok) return [];

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return (parsed.learnings || []).map((l: any) => ({
      ...l,
      timestamp: new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}
