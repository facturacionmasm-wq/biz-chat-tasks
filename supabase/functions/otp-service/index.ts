import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, data } = await req.json();

    if (action === 'request') {
      const { phone, tenantId } = data;

      // Generate 6-digit OTP
      const code = Math.floor(100000 + Math.random() * 900000).toString();

      // Hash the code (simple hash for demo; use bcrypt in production)
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(code));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Expires in 5 minutes
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

      // Insert OTP challenge
      const { error } = await supabase.from('otp_challenges').insert({
        tenant_id: tenantId,
        phone,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
        max_attempts: 3,
      });

      if (error) throw error;

      // In production: send via WhatsApp API
      // For now, log the code (would be sent via WhatsApp)
      console.log(`OTP for ${phone}: ${code}`);

      return new Response(JSON.stringify({
        success: true,
        message: 'OTP enviado por WhatsApp',
        // Only for development:
        _debug_code: code,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'verify') {
      const { phone, code, tenantId } = data;

      // Hash the provided code
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(code));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const codeHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Find the most recent unverified OTP for this phone
      const { data: challenges, error } = await supabase
        .from('otp_challenges')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('phone', phone)
        .is('verified_at', null)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error) throw error;

      if (!challenges || challenges.length === 0) {
        return new Response(JSON.stringify({ success: false, error: 'No hay OTP pendiente' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const challenge = challenges[0];

      // Check expiration
      if (new Date(challenge.expires_at) < new Date()) {
        return new Response(JSON.stringify({ success: false, error: 'OTP expirado' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Check max attempts
      if (challenge.attempts >= challenge.max_attempts) {
        return new Response(JSON.stringify({ success: false, error: 'Máximo de intentos alcanzado' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Increment attempts
      await supabase.from('otp_challenges').update({ attempts: challenge.attempts + 1 }).eq('id', challenge.id);

      // Verify code
      if (challenge.code_hash !== codeHash) {
        return new Response(JSON.stringify({ success: false, error: 'Código incorrecto' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Mark as verified
      await supabase.from('otp_challenges').update({ verified_at: new Date().toISOString() }).eq('id', challenge.id);

      // Log audit event
      await supabase.from('audit_events').insert({
        tenant_id: tenantId,
        event_type: 'otp.verified',
        resource_type: 'otp_challenge',
        resource_id: challenge.id,
        payload: { phone },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Identidad verificada. Sesión válida por 30 minutos.',
        sessionExpiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
