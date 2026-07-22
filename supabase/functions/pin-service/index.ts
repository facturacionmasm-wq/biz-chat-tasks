import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Generate a random salt
function generateSalt(length = 16): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Hash PIN with salt using PBKDF2 (much stronger than plain SHA-256)
async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  const hashArray = Array.from(new Uint8Array(derivedBits));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

  try {
    const { action, pin, user_id, tenant_id, pin_hash_input } = await req.json();

    // Action: hash_pin — called from client with auth
    if (action === 'hash_pin') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(authHeader.replace('Bearer ', ''));
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const userId = claimsData.claims.sub;
      if (!pin || pin.length < 4 || pin.length > 6) {
        return new Response(JSON.stringify({ error: 'PIN must be 4-6 digits' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const salt = generateSalt();
      const hash = await hashPinWithSalt(pin, salt);
      const pinHash = `${salt}:${hash}`;

      // Store via service role
      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { error } = await adminClient
        .from('profiles')
        .update({
          pin_hash: pinHash,
          pin_must_change: false,
          pin_temp_expires_at: null,
          pin_updated_at: new Date().toISOString(),
        })
        .eq('user_id', userId);

      if (error) throw error;

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Action: admin_reset_pin — owner/admin resets another user's PIN → generates 6-digit temp PIN
    if (action === 'admin_reset_pin') {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (!user_id) {
        return new Response(JSON.stringify({ error: 'user_id required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // RPC validates caller role; also sets pin_must_change=true + expiry
      const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: rpcData, error: rpcErr } = await callerClient.rpc('admin_reset_user_pin', {
        _target_user: user_id,
      });
      if (rpcErr) {
        return new Response(JSON.stringify({ error: rpcErr.message }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const pinPlain = (rpcData as any)?.pin_plaintext as string;
      const expiresAt = (rpcData as any)?.expires_at as string;
      if (!pinPlain) {
        return new Response(JSON.stringify({ error: 'RPC did not return PIN' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Hash the temp PIN with PBKDF2 and persist
      const salt = generateSalt();
      const hash = await hashPinWithSalt(pinPlain, salt);
      const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      const { error: updErr } = await admin
        .from('profiles')
        .update({ pin_hash: `${salt}:${hash}` })
        .eq('user_id', user_id);
      if (updErr) throw updErr;

      return new Response(JSON.stringify({
        success: true,
        pin_temp: pinPlain,
        expires_at: expiresAt,
        must_change: true,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }


    // Action: verify_pin — called from whatsapp-bot (service-to-service)
    if (action === 'verify_pin') {
      if (!pin || !tenant_id) {
        return new Response(JSON.stringify({ error: 'Missing pin or tenant_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Find all profiles with a pin_hash in this tenant
      const { data: profiles } = await adminClient
        .from('profiles')
        .select('id, user_id, name, tenant_id, pin_hash, pin_must_change, pin_temp_expires_at')
        .eq('tenant_id', tenant_id)
        .not('pin_hash', 'is', null);

      if (!profiles || profiles.length === 0) {
        return new Response(JSON.stringify({ match: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const buildMatch = (profile: any) => {
        const mustChange = !!profile.pin_must_change;
        const expiresAt = profile.pin_temp_expires_at ? new Date(profile.pin_temp_expires_at) : null;
        const expired = mustChange && expiresAt ? expiresAt.getTime() < Date.now() : false;
        return {
          match: true,
          user_id: profile.user_id,
          name: profile.name,
          profile_id: profile.id,
          must_change: mustChange,
          expired,
          expires_at: profile.pin_temp_expires_at,
        };
      };

      for (const profile of profiles) {
        const storedHash = profile.pin_hash;
        if (!storedHash) continue;

        if (storedHash.includes(':')) {
          const [salt, hash] = storedHash.split(':');
          const computed = await hashPinWithSalt(pin, salt);
          if (computed === hash) {
            return new Response(JSON.stringify(buildMatch(profile)), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        } else {
          const encoder = new TextEncoder();
          const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(pin));
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const legacyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          if (legacyHash === storedHash) {
            const newSalt = generateSalt();
            const newHash = await hashPinWithSalt(pin, newSalt);
            await adminClient
              .from('profiles')
              .update({ pin_hash: `${newSalt}:${newHash}` })
              .eq('user_id', profile.user_id);

            return new Response(JSON.stringify(buildMatch(profile)), {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }
      }


      return new Response(JSON.stringify({ match: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('PIN service error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
