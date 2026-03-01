import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// Stripe signature verification using Web Crypto API
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  const parts = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1];

  if (!timestamp || !signature) return false;

  // Reject if timestamp is older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSig = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (expectedSig.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('STRIPE_WEBHOOK_SECRET not configured');
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Read raw body for signature verification
  const body = await req.text();
  const sigHeader = req.headers.get('stripe-signature');
  if (!sigHeader) {
    return new Response(JSON.stringify({ error: 'Missing stripe-signature header' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const valid = await verifyStripeSignature(body, sigHeader, STRIPE_WEBHOOK_SECRET);
  if (!valid) {
    console.error('Invalid Stripe signature');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const event = JSON.parse(body);
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  console.log(`Processing Stripe event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const tenantId = session.metadata?.tenant_id;
        const planSlug = session.metadata?.plan_slug;
        if (!tenantId || !planSlug) {
          console.error('Missing metadata in checkout session', session.id);
          break;
        }

        // Find plan
        const { data: plan } = await adminClient
          .from('subscription_plans')
          .select('id')
          .eq('slug', planSlug)
          .maybeSingle();

        if (!plan) {
          console.error('Plan not found:', planSlug);
          break;
        }

        // Upsert subscription
        const { error } = await adminClient
          .from('tenant_subscriptions')
          .upsert({
            tenant_id: tenantId,
            plan_id: plan.id,
            status: 'active',
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            current_period_start: new Date().toISOString(),
            trial_ends_at: null,
            canceled_at: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id' });

        if (error) console.error('Error upserting subscription:', error);
        else console.log(`Tenant ${tenantId} activated on plan ${planSlug}`);
        break;
      }

      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const { data: sub } = await adminClient
          .from('tenant_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle();

        if (sub) {
          await adminClient
            .from('tenant_subscriptions')
            .update({
              status: 'active',
              current_period_start: new Date(invoice.period_start * 1000).toISOString(),
              current_period_end: new Date(invoice.period_end * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.id);
          console.log(`Invoice paid for subscription ${subscriptionId}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        if (!subscriptionId) break;

        const { data: sub } = await adminClient
          .from('tenant_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subscriptionId)
          .maybeSingle();

        if (sub) {
          await adminClient
            .from('tenant_subscriptions')
            .update({
              status: 'past_due',
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.id);
          console.log(`Payment failed for subscription ${subscriptionId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const { data: sub } = await adminClient
          .from('tenant_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (sub) {
          const statusMap: Record<string, string> = {
            active: 'active',
            past_due: 'past_due',
            canceled: 'canceled',
            unpaid: 'blocked',
            incomplete: 'past_due',
            incomplete_expired: 'blocked',
            trialing: 'trialing',
            paused: 'blocked',
          };

          await adminClient
            .from('tenant_subscriptions')
            .update({
              status: statusMap[subscription.status] || subscription.status,
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
              canceled_at: subscription.canceled_at
                ? new Date(subscription.canceled_at * 1000).toISOString()
                : null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.id);
          console.log(`Subscription ${subscription.id} updated to ${subscription.status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const { data: sub } = await adminClient
          .from('tenant_subscriptions')
          .select('id')
          .eq('stripe_subscription_id', subscription.id)
          .maybeSingle();

        if (sub) {
          await adminClient
            .from('tenant_subscriptions')
            .update({
              status: 'canceled',
              canceled_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', sub.id);
          console.log(`Subscription ${subscription.id} canceled`);
        }
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Webhook processing error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
