import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

// ---- Signature Verification ----
async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1];
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1];
  if (!timestamp || !signature) return false;

  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp);
  if (age > 300) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`));
  const expectedSig = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (expectedSig.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    mismatch |= expectedSig.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---- Helpers ----
function getAdminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}

async function logAudit(client: any, tenantId: string, eventType: string, payload: Record<string, unknown>) {
  const { error } = await client.from('audit_events').insert({
    tenant_id: tenantId,
    event_type: eventType,
    resource_type: 'subscription',
    resource_id: payload.stripe_subscription_id || payload.session_id || null,
    payload,
  });
  if (error) console.error('Audit log error:', error);
}

async function resolveTenantBySubscription(client: any, subscriptionId: string) {
  const { data } = await client
    .from('tenant_subscriptions')
    .select('id, tenant_id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  return data;
}

async function resolveTenantByCustomer(client: any, customerId: string) {
  const { data } = await client
    .from('stripe_customers')
    .select('tenant_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  return data;
}

// ---- Event Handlers ----
async function handleCheckoutCompleted(client: any, session: any) {
  const tenantId = session.metadata?.tenant_id;
  const planSlug = session.metadata?.plan_slug;
  if (!tenantId || !planSlug) {
    console.error('Missing metadata in checkout session', session.id);
    return;
  }

  const { data: plan } = await client
    .from('subscription_plans')
    .select('id')
    .eq('slug', planSlug)
    .maybeSingle();

  if (!plan) {
    console.error('Plan not found:', planSlug);
    return;
  }

  const { error } = await client
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

  if (error) {
    console.error('Error upserting subscription:', error);
  } else {
    console.log(`Tenant ${tenantId} activated on plan ${planSlug}`);
    await logAudit(client, tenantId, 'subscription.activated', {
      plan_slug: planSlug,
      stripe_subscription_id: session.subscription,
      session_id: session.id,
      stripe_customer_id: session.customer,
    });

    // Also update stripe_customers table
    await client.from('stripe_customers').upsert({
      tenant_id: tenantId,
      stripe_customer_id: session.customer,
      stripe_subscription_id: session.subscription,
      email: session.customer_email || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' });
  }
}

async function handleInvoicePaid(client: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const sub = await resolveTenantBySubscription(client, subscriptionId);
  if (!sub) return;

  await client.from('tenant_subscriptions').update({
    status: 'active',
    current_period_start: new Date(invoice.period_start * 1000).toISOString(),
    current_period_end: new Date(invoice.period_end * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  console.log(`Invoice paid for subscription ${subscriptionId}`);
  await logAudit(client, sub.tenant_id, 'subscription.invoice_paid', {
    stripe_subscription_id: subscriptionId,
    invoice_id: invoice.id,
    amount_paid: invoice.amount_paid,
    currency: invoice.currency,
    // Metered billing details
    lines: invoice.lines?.data?.map((l: any) => ({
      description: l.description,
      amount: l.amount,
      quantity: l.quantity,
      price_id: l.price?.id,
      usage_type: l.price?.recurring?.usage_type,
    })) || [],
  });
}

async function handleInvoicePaymentFailed(client: any, invoice: any) {
  const subscriptionId = invoice.subscription;
  if (!subscriptionId) return;

  const sub = await resolveTenantBySubscription(client, subscriptionId);
  if (!sub) return;

  await client.from('tenant_subscriptions').update({
    status: 'past_due',
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  console.log(`Payment failed for subscription ${subscriptionId}`);

  // Block new calls for past_due tenants
  await client.from('audit_events').insert({
    tenant_id: sub.tenant_id,
    event_type: 'billing.calls_blocked',
    resource_type: 'subscription',
    resource_id: subscriptionId,
    payload: {
      reason: 'payment_failed',
      invoice_id: invoice.id,
      attempt_count: invoice.attempt_count,
    },
  });

  await logAudit(client, sub.tenant_id, 'subscription.payment_failed', {
    stripe_subscription_id: subscriptionId,
    invoice_id: invoice.id,
    attempt_count: invoice.attempt_count,
  });
}

async function handleSubscriptionUpdated(client: any, subscription: any) {
  const sub = await resolveTenantBySubscription(client, subscription.id);
  if (!sub) {
    // Try by customer
    const customer = await resolveTenantByCustomer(client, subscription.customer);
    if (!customer) return;

    // This might be a new subscription - link it
    const { data: plan } = await client
      .from('subscription_plans')
      .select('id')
      .eq('slug', 'basic')
      .maybeSingle();

    if (plan) {
      await client.from('tenant_subscriptions').upsert({
        tenant_id: customer.tenant_id,
        plan_id: plan.id,
        stripe_customer_id: subscription.customer,
        stripe_subscription_id: subscription.id,
        status: mapStripeStatus(subscription.status),
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });
    }
    return;
  }

  const newStatus = mapStripeStatus(subscription.status);
  await client.from('tenant_subscriptions').update({
    status: newStatus,
    current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    canceled_at: subscription.canceled_at
      ? new Date(subscription.canceled_at * 1000).toISOString()
      : null,
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  // Update stripe_customers with latest item IDs
  const meteredItem = subscription.items?.data?.find((i: any) =>
    i.price?.recurring?.usage_type === 'metered'
  );
  const baseItem = subscription.items?.data?.find((i: any) =>
    !i.price?.recurring?.usage_type
  );

  if (meteredItem || baseItem) {
    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (meteredItem) updateData.stripe_metered_item_id = meteredItem.id;
    if (baseItem) updateData.stripe_base_item_id = baseItem.id;
    await client.from('stripe_customers').update(updateData).eq('tenant_id', sub.tenant_id);
  }

  console.log(`Subscription ${subscription.id} updated to ${subscription.status}`);
  await logAudit(client, sub.tenant_id, 'subscription.updated', {
    stripe_subscription_id: subscription.id,
    new_status: newStatus,
    stripe_status: subscription.status,
  });
}

async function handleSubscriptionDeleted(client: any, subscription: any) {
  const sub = await resolveTenantBySubscription(client, subscription.id);
  if (!sub) return;

  await client.from('tenant_subscriptions').update({
    status: 'canceled',
    canceled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sub.id);

  console.log(`Subscription ${subscription.id} canceled`);
  await logAudit(client, sub.tenant_id, 'subscription.canceled', {
    stripe_subscription_id: subscription.id,
  });
}

function mapStripeStatus(stripeStatus: string): string {
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
  return statusMap[stripeStatus] || stripeStatus;
}

// ---- Main Handler ----
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
  const client = getAdminClient();

  console.log(`Processing Stripe event: ${event.type} (${event.id})`);

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(client, event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(client, event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(client, event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(client, event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(client, event.data.object);
        break;

      case 'invoice.finalized': {
        // Log for visibility into metered billing invoices
        const invoice = event.data.object;
        const customerData = await resolveTenantByCustomer(client, invoice.customer);
        if (customerData) {
          await logAudit(client, customerData.tenant_id, 'billing.invoice_finalized', {
            invoice_id: invoice.id,
            amount_due: invoice.amount_due,
            currency: invoice.currency,
            lines_count: invoice.lines?.data?.length || 0,
          });
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
