import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

/**
 * ElevenLabs ↔ Twilio Native Integration Setup
 *
 * This function imports a Twilio phone number into ElevenLabs
 * and assigns the configured agent. ElevenLabs then automatically
 * configures the Twilio voice webhook to point to their own servers,
 * handling the Twilio↔ElevenLabs protocol bridge natively.
 *
 * Actions:
 *   - "setup"    → Import number + assign agent
 *   - "status"   → Check if number is already imported
 *   - "remove"   → Remove number from ElevenLabs
 */

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
  const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await anonClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'No autorizado' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const ELEVENLABS_API_KEY = Deno.env.get('ELEVENLABS_API_KEY');
  const ELEVENLABS_AGENT_ID = Deno.env.get('ELEVENLABS_AGENT_ID');
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

  if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID) {
    return new Response(JSON.stringify({ error: 'ElevenLabs no configurado. Se requiere API Key y Agent ID.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return new Response(JSON.stringify({ error: 'Twilio no configurado. Se requiere Account SID, Auth Token y Phone Number.' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const elHeaders = {
    'xi-api-key': ELEVENLABS_API_KEY,
    'Content-Type': 'application/json',
  };

  try {
    const { action } = await req.json();

    // ═══════════ STATUS: List imported numbers ═══════════
    if (action === 'status') {
      const res = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
        headers: elHeaders,
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Error listando números: ${err}`);
      }
      const data = await res.json();
      // Find our number
      const phoneNumbers = data.phone_numbers || data || [];
      const found = Array.isArray(phoneNumbers)
        ? phoneNumbers.find((p: any) =>
            p.phone_number === TWILIO_PHONE_NUMBER ||
            p.phone_number === TWILIO_PHONE_NUMBER.replace(/^\+/, '')
          )
        : null;

      return new Response(JSON.stringify({
        configured: !!found,
        phone_number: TWILIO_PHONE_NUMBER,
        agent_id: ELEVENLABS_AGENT_ID,
        details: found || null,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════ SETUP: Import number + assign agent ═══════════
    if (action === 'setup') {
      // Step 0: Verify the number exists in Twilio as an Incoming Phone Number
      console.log(`[el-twilio] Verifying ${TWILIO_PHONE_NUMBER} in Twilio account...`);
      const encodedNumber = encodeURIComponent(TWILIO_PHONE_NUMBER);
      const twilioListRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodedNumber}`,
        {
          headers: {
            'Authorization': 'Basic ' + btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`),
          },
        }
      );
      if (twilioListRes.ok) {
        const twilioData = await twilioListRes.json();
        if (!twilioData.incoming_phone_numbers || twilioData.incoming_phone_numbers.length === 0) {
          return new Response(JSON.stringify({
            error: `El número ${TWILIO_PHONE_NUMBER} NO está comprado en tu cuenta de Twilio. ` +
              `Debes comprarlo en Twilio Console → Phone Numbers → Buy a Number, ` +
              `o actualizar el secret TWILIO_PHONE_NUMBER con un número que ya tengas comprado.`,
          }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.log(`[el-twilio] ✓ Number verified in Twilio`);
      } else {
        console.warn(`[el-twilio] Could not verify number in Twilio (${twilioListRes.status}), proceeding anyway...`);
      }

      // Step 1: Import the Twilio phone number into ElevenLabs
      console.log(`[el-twilio] Importing ${TWILIO_PHONE_NUMBER} into ElevenLabs...`);

      const importRes = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
        method: 'POST',
        headers: elHeaders,
        body: JSON.stringify({
          provider: 'twilio',
          phone_number: TWILIO_PHONE_NUMBER,
          label: 'Rybix Voice Agent',
          sid: TWILIO_ACCOUNT_SID,
          token: TWILIO_AUTH_TOKEN,
        }),
      });

      if (!importRes.ok) {
        const errText = await importRes.text();
        console.error(`[el-twilio] Import error [${importRes.status}]:`, errText);

        // If already exists, try to find it
        if (importRes.status === 404) {
          throw new Error(
            `El número ${TWILIO_PHONE_NUMBER} no se encontró en tu cuenta de Twilio. ` +
            `Asegúrate de que esté comprado como "Incoming Phone Number" (no solo como Verified Caller ID) ` +
            `en tu consola de Twilio antes de conectarlo.`
          );
        } else if (importRes.status === 409 || importRes.status === 422 || errText.includes('already')) {
          console.log('[el-twilio] Number may already be imported, checking...');
        } else {
          throw new Error(`Error importando número en ElevenLabs: ${errText}`);
        }
      }

      let phoneNumberId: string | null = null;

      if (importRes.ok) {
        const importData = await importRes.json();
        phoneNumberId = importData.phone_number_id || importData.id;
        console.log(`[el-twilio] Number imported: ${phoneNumberId}`);
      }

      // If import failed (already exists), find the existing number
      if (!phoneNumberId) {
        const listRes = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
          headers: elHeaders,
        });
        if (listRes.ok) {
          const listData = await listRes.json();
          const numbers = listData.phone_numbers || listData || [];
          const existing = Array.isArray(numbers)
            ? numbers.find((p: any) =>
                p.phone_number === TWILIO_PHONE_NUMBER ||
                p.phone_number === TWILIO_PHONE_NUMBER.replace(/^\+/, '')
              )
            : null;
          if (existing) {
            phoneNumberId = existing.phone_number_id || existing.id;
            console.log(`[el-twilio] Found existing number: ${phoneNumberId}`);
          }
        }
      }

      if (!phoneNumberId) {
        throw new Error('No se pudo obtener el ID del número de teléfono en ElevenLabs');
      }

      // Step 2: Assign the agent to handle inbound calls
      console.log(`[el-twilio] Assigning agent ${ELEVENLABS_AGENT_ID} to number ${phoneNumberId}...`);

      const assignRes = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${phoneNumberId}`, {
        method: 'PATCH',
        headers: elHeaders,
        body: JSON.stringify({
          agent_id: ELEVENLABS_AGENT_ID,
        }),
      });

      // Step 3: Configure post-call webhook on the agent so calls get registered
      const webhookUrl = `${supabaseUrl}/functions/v1/elevenlabs-post-call`;
      console.log(`[el-twilio] Configuring post-call webhook: ${webhookUrl}`);
      try {
        const agentRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${ELEVENLABS_AGENT_ID}`, {
          method: 'PATCH',
          headers: elHeaders,
          body: JSON.stringify({
            platform_settings: {
              webhook: {
                url: webhookUrl,
                events: ['call.ended', 'conversation.ended'],
              },
            },
          }),
        });
        if (!agentRes.ok) {
          const errText = await agentRes.text();
          console.error(`[el-twilio] Webhook config error [${agentRes.status}]:`, errText);
        } else {
          console.log('[el-twilio] Post-call webhook configured on agent');
        }
      } catch (e) {
        console.error('[el-twilio] Webhook config failed:', e);
      }

      if (!assignRes.ok) {
        const errText = await assignRes.text();
        console.error(`[el-twilio] Assign error [${assignRes.status}]:`, errText);
        // Not fatal - the number might already be assigned
        console.log('[el-twilio] Agent assignment may have failed, but number is imported');
      } else {
        console.log('[el-twilio] Agent assigned successfully');
      }

      // Audit
      const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: profile } = await serviceClient
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profile?.tenant_id) {
        await serviceClient.from('audit_events').insert({
          tenant_id: profile.tenant_id,
          actor_id: user.id,
          event_type: 'elevenlabs.twilio_native_setup',
          resource_type: 'phone_number',
          resource_id: phoneNumberId,
          payload: {
            phone_number: TWILIO_PHONE_NUMBER,
            agent_id: ELEVENLABS_AGENT_ID,
            action: 'setup',
          },
        });
      }

      return new Response(JSON.stringify({
        success: true,
        phone_number_id: phoneNumberId,
        message: 'Número importado y agente asignado. ElevenLabs ahora maneja las llamadas entrantes directamente.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ═══════════ REMOVE: Remove number from ElevenLabs ═══════════
    if (action === 'remove') {
      // Find the number first
      const listRes = await fetch('https://api.elevenlabs.io/v1/convai/phone-numbers', {
        headers: elHeaders,
      });
      if (!listRes.ok) throw new Error('Error listando números');

      const listData = await listRes.json();
      const numbers = listData.phone_numbers || listData || [];
      const existing = Array.isArray(numbers)
        ? numbers.find((p: any) =>
            p.phone_number === TWILIO_PHONE_NUMBER ||
            p.phone_number === TWILIO_PHONE_NUMBER.replace(/^\+/, '')
          )
        : null;

      if (!existing) {
        return new Response(JSON.stringify({ success: true, message: 'Número no encontrado en ElevenLabs (ya removido)' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const numberId = existing.phone_number_id || existing.id;
      const delRes = await fetch(`https://api.elevenlabs.io/v1/convai/phone-numbers/${numberId}`, {
        method: 'DELETE',
        headers: elHeaders,
      });

      if (!delRes.ok) {
        const errText = await delRes.text();
        throw new Error(`Error removiendo número: ${errText}`);
      }

      return new Response(JSON.stringify({ success: true, message: 'Número removido de ElevenLabs' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Acción no reconocida. Use: setup, status, remove' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Error desconocido';
    console.error('[el-twilio] Error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
