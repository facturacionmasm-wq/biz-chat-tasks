import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeRequest(path: string, method: string, body?: Record<string, string>, stripeKey?: string) {
  const key = stripeKey || Deno.env.get('STRIPE_SECRET_KEY')!;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const opts: RequestInit = { method, headers };
  if (body) {
    opts.body = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${STRIPE_API}${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Stripe error (${res.status}): ${JSON.stringify(data.error)}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
  if (!STRIPE_SECRET_KEY) {
    return new Response(JSON.stringify({ error: 'STRIPE_SECRET_KEY not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { action, tenant_id, email, name, plan_slug, currency: reqCurrency } = await req.json();

    switch (action) {
      // ============================================
      // 1. CREATE CUSTOMER + SUBSCRIPTION
      // ============================================
      case 'create_customer_and_subscribe': {
        if (!tenant_id || !email) {
          return new Response(JSON.stringify({ error: 'tenant_id and email required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if customer already exists
        const { data: existing } = await supabase
          .from('stripe_customers')
          .select('*')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (existing?.stripe_customer_id) {
          return new Response(JSON.stringify({
            message: 'Customer already exists',
            stripe_customer_id: existing.stripe_customer_id,
            stripe_subscription_id: existing.stripe_subscription_id,
          }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
        }

        // Get tenant info for currency/region
        const { data: tenantInfo } = await supabase
          .from('tenants')
          .select('currency, country_code, region')
          .eq('id', tenant_id)
          .maybeSingle();

        const tenantCurrency = (reqCurrency || tenantInfo?.currency || 'mxn').toLowerCase();
        const tenantCountry = tenantInfo?.country_code || 'MX';
        const tenantRegion = tenantInfo?.region || 'LATAM';

        // Get localized pricing if available
        const { data: localPricing } = await supabase
          .from('global_plan_pricing')
          .select('base_price, overage_price, currency')
          .eq('country_code', tenantCountry)
          .eq('active', true)
          .limit(1)
          .maybeSingle();

        const basePriceAmount = localPricing ? Math.round(localPricing.base_price * 100) : 49900;
        const overagePriceAmount = localPricing ? Math.round(localPricing.overage_price * 100) : 150;
        const priceCurrency = localPricing?.currency?.toLowerCase() || tenantCurrency;

        // Create Stripe customer
        const customer = await stripeRequest('/customers', 'POST', {
          email,
          name: name || email,
          'metadata[tenant_id]': tenant_id,
          'metadata[country]': tenantCountry,
          'metadata[region]': tenantRegion,
          'metadata[source]': 'officehub_auto',
        }, STRIPE_SECRET_KEY);

        console.log(`Created Stripe customer: ${customer.id} for tenant ${tenant_id} (${tenantCountry}/${priceCurrency})`);

        // Get or create products and prices for this currency
        const products = await ensureProductsExist(STRIPE_SECRET_KEY, priceCurrency, basePriceAmount, overagePriceAmount);

        // Create subscription with base + metered items
        const subParams: Record<string, string> = {
          customer: customer.id,
          'items[0][price]': products.basePriceId,
          'items[1][price]': products.meteredPriceId,
          'metadata[tenant_id]': tenant_id,
          'metadata[country]': tenantCountry,
          'metadata[region]': tenantRegion,
          payment_behavior: 'default_incomplete',
          'payment_settings[save_default_payment_method]': 'on_subscription',
          'expand[0]': 'latest_invoice.payment_intent',
        };

        // Add trial if plan requires it
        if (plan_slug === 'trial' || !plan_slug) {
          subParams['trial_period_days'] = '15';
        }

        const subscription = await stripeRequest('/subscriptions', 'POST', subParams, STRIPE_SECRET_KEY);

        // Extract subscription item IDs
        const baseItem = subscription.items.data.find((i: any) =>
          i.price.id === products.basePriceId
        );
        const meteredItem = subscription.items.data.find((i: any) =>
          i.price.id === products.meteredPriceId
        );

        // Save to database
        await supabase.from('stripe_customers').upsert({
          tenant_id,
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          stripe_base_item_id: baseItem?.id || null,
          stripe_metered_item_id: meteredItem?.id || null,
          email,
          name: name || email,
          metadata: { plan_slug: plan_slug || 'basic' },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id' });

        // Update tenant_subscriptions
        const { data: plan } = await supabase
          .from('subscription_plans')
          .select('id')
          .eq('slug', plan_slug || 'basic')
          .maybeSingle();

        if (plan) {
          await supabase.from('tenant_subscriptions').upsert({
            tenant_id,
            plan_id: plan.id,
            status: plan_slug === 'trial' || !plan_slug ? 'trialing' : 'active',
            stripe_customer_id: customer.id,
            stripe_subscription_id: subscription.id,
            trial_ends_at: subscription.trial_end
              ? new Date(subscription.trial_end * 1000).toISOString()
              : null,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id' });
        }

        // Audit
        await supabase.from('audit_events').insert({
          tenant_id,
          event_type: 'billing.customer_created',
          resource_type: 'stripe_customer',
          resource_id: customer.id,
          payload: {
            stripe_customer_id: customer.id,
            stripe_subscription_id: subscription.id,
            plan_slug: plan_slug || 'basic',
          },
        });

        const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret || null;

        return new Response(JSON.stringify({
          success: true,
          stripe_customer_id: customer.id,
          stripe_subscription_id: subscription.id,
          client_secret: clientSecret,
          status: subscription.status,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 2. REPORT USAGE TO STRIPE
      // ============================================
      case 'report_usage': {
        if (!tenant_id) {
          return new Response(JSON.stringify({ error: 'tenant_id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: stripeCustomer } = await supabase
          .from('stripe_customers')
          .select('stripe_metered_item_id')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (!stripeCustomer?.stripe_metered_item_id) {
          return new Response(JSON.stringify({ error: 'No metered subscription item found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get current month usage
        const now = new Date();
        const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const { data: usage } = await supabase
          .from('tenant_usage_monthly')
          .select('total_minutes')
          .eq('tenant_id', tenant_id)
          .eq('period_start', periodStart)
          .maybeSingle();

        const totalMinutes = Math.ceil(usage?.total_minutes || 0);

        if (totalMinutes === 0) {
          return new Response(JSON.stringify({ message: 'No usage to report' }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Report usage to Stripe
        const usageRecord = await stripeRequest(
          `/subscription_items/${stripeCustomer.stripe_metered_item_id}/usage_records`,
          'POST',
          {
            quantity: String(totalMinutes),
            timestamp: String(Math.floor(Date.now() / 1000)),
            action: 'set', // set = absolute, not incremental
          },
          STRIPE_SECRET_KEY
        );

        // Save record
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        await supabase.from('stripe_usage_records').insert({
          tenant_id,
          stripe_subscription_item_id: stripeCustomer.stripe_metered_item_id,
          quantity: totalMinutes,
          period_start: periodStart,
          period_end: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`,
          stripe_usage_record_id: usageRecord.id,
          status: 'reported',
          reported_at: new Date().toISOString(),
        });

        console.log(`Reported ${totalMinutes} minutes for tenant ${tenant_id}`);

        return new Response(JSON.stringify({
          success: true,
          minutes_reported: totalMinutes,
          stripe_usage_record_id: usageRecord.id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 3. GET BILLING STATUS
      // ============================================
      case 'get_billing_status': {
        if (!tenant_id) {
          return new Response(JSON.stringify({ error: 'tenant_id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const [customerRes, usageRes, marginRes] = await Promise.all([
          supabase.from('stripe_customers').select('*').eq('tenant_id', tenant_id).maybeSingle(),
          supabase.from('tenant_usage_monthly').select('*').eq('tenant_id', tenant_id)
            .order('period_start', { ascending: false }).limit(3),
          supabase.from('realtime_margin_state').select('*').eq('tenant_id', tenant_id).maybeSingle(),
        ]);

        return new Response(JSON.stringify({
          customer: customerRes.data,
          usage_history: usageRes.data,
          margin_state: marginRes.data,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Stripe billing error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Ensure products and prices exist in Stripe (multi-currency aware)
async function ensureProductsExist(stripeKey: string, currency = 'mxn', baseAmount = 49900, meteredAmount = 150) {
  // Search for existing products
  const products = await stripeRequest('/products?active=true&limit=100', 'GET', undefined, stripeKey);

  let baseProduct = products.data.find((p: any) => p.metadata?.type === 'officehub_base');
  let meteredProduct = products.data.find((p: any) => p.metadata?.type === 'officehub_metered');

  // Create base product if not exists
  if (!baseProduct) {
    baseProduct = await stripeRequest('/products', 'POST', {
      name: 'OfficeHub - Plan Base',
      description: 'Suscripción mensual base de OfficeHub',
      'metadata[type]': 'officehub_base',
    }, stripeKey);
  }

  // Create metered product if not exists
  if (!meteredProduct) {
    meteredProduct = await stripeRequest('/products', 'POST', {
      name: 'OfficeHub - Uso por Unidad',
      description: 'Cargo por unidad de consumo (mensajes, minutos)',
      'metadata[type]': 'officehub_metered',
    }, stripeKey);
  }

  // Get or create prices for the specified currency
  const prices = await stripeRequest(`/prices?active=true&product=${baseProduct.id}&limit=50`, 'GET', undefined, stripeKey);
  let basePrice = prices.data.find((p: any) =>
    p.recurring?.interval === 'month' && !p.recurring?.usage_type && p.currency === currency
  );

  if (!basePrice) {
    basePrice = await stripeRequest('/prices', 'POST', {
      product: baseProduct.id,
      unit_amount: String(baseAmount),
      currency,
      'recurring[interval]': 'month',
    }, stripeKey);
    console.log(`Created base price for ${currency}: ${basePrice.id}`);
  }

  const meteredPrices = await stripeRequest(`/prices?active=true&product=${meteredProduct.id}&limit=50`, 'GET', undefined, stripeKey);
  let meteredPrice = meteredPrices.data.find((p: any) =>
    p.recurring?.usage_type === 'metered' && p.currency === currency
  );

  if (!meteredPrice) {
    meteredPrice = await stripeRequest('/prices', 'POST', {
      product: meteredProduct.id,
      unit_amount: String(meteredAmount),
      currency,
      'recurring[interval]': 'month',
      'recurring[usage_type]': 'metered',
      'recurring[aggregate_usage]': 'last_during_period',
    }, stripeKey);
    console.log(`Created metered price for ${currency}: ${meteredPrice.id}`);
  }

  return {
    baseProductId: baseProduct.id,
    meteredProductId: meteredProduct.id,
    basePriceId: basePrice.id,
    meteredPriceId: meteredPrice.id,
  };
}
