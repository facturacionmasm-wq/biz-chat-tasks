import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// AES-GCM encryption using Web Crypto API
async function getEncryptionKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('CREDENTIALS_ENCRYPTION_KEY');
  if (!secret) throw new Error('CREDENTIALS_ENCRYPTION_KEY not configured');
  
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('credential-vault-salt-v1'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encrypt(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext)
  );
  // Format: base64(iv):base64(ciphertext)
  const ivB64 = btoa(String.fromCharCode(...iv));
  const ctB64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  return `enc:${ivB64}:${ctB64}`;
}

async function decrypt(ciphertext: string): Promise<string> {
  // Handle legacy plaintext (not encrypted)
  if (!ciphertext.startsWith('enc:')) {
    return ciphertext;
  }
  
  const key = await getEncryptionKey();
  const [, ivB64, ctB64] = ciphertext.split(':');
  const iv = Uint8Array.from(atob(ivB64), c => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64), c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ct
  );
  return new TextDecoder().decode(decrypted);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace('Bearer ', '');
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let tenantId: string;
  let userId: string | null = null;

  // Check if this is a service-role call (from whatsapp-bot)
  if (token === SUPABASE_SERVICE_ROLE_KEY) {
    // Service-role call: tenant_id must be in the body
    const body = await req.json();
    if (!body.tenant_id) {
      return new Response(JSON.stringify({ error: 'tenant_id required for service calls' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    tenantId = body.tenant_id;
    userId = body.user_id || null;

    // Process the action from parsed body
    return await processAction(body, tenantId, userId, adminClient, corsHeaders);
  }

  // Regular user call: validate JWT
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claimsData, error: claimsError } = await anonClient.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  userId = claimsData.claims.sub as string;

  // Get user's tenant
  const { data: profile } = await adminClient
    .from('profiles')
    .select('tenant_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile) {
    return new Response(JSON.stringify({ error: 'Profile not found' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  tenantId = profile.tenant_id;

  try {
    const body = await req.json();
    return await processAction(body, tenantId, userId, adminClient, corsHeaders);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Credential vault error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processAction(
  body: any,
  tenantId: string,
  userId: string | null,
  adminClient: any,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const { action, id, platform_name, username, password, notes } = body;

  if (action === 'encrypt_save') {
    const encryptedPassword = await encrypt(password);
    
    if (id) {
      const { error } = await adminClient
        .from('shared_credentials')
        .update({
          platform_name,
          username,
          password_encrypted: encryptedPassword,
          notes: notes || null,
        })
        .eq('id', id)
        .eq('tenant_id', tenantId);
      if (error) throw error;
    } else {
      const { error } = await adminClient
        .from('shared_credentials')
        .insert({
          tenant_id: tenantId,
          platform_name,
          username,
          password_encrypted: encryptedPassword,
          notes: notes || null,
          created_by: userId,
        });
      if (error) throw error;
    }

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (action === 'decrypt') {
    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing credential id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: cred } = await adminClient
      .from('shared_credentials')
      .select('password_encrypted')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (!cred) {
      return new Response(JSON.stringify({ error: 'Credential not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const decrypted = await decrypt(cred.password_encrypted);
    return new Response(JSON.stringify({ password: decrypted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'Unknown action' }), {
    status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
