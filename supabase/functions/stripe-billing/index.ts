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
    const { action, tenant_id, email, name, plan_slug, currency: reqCurrency, package_id, service_type } = await req.json();

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

        // Aggregate usage from whatsapp_usage_events for the current month
        const now = new Date();
        const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;

        const { data: events } = await supabase
          .from('whatsapp_usage_events')
          .select('units')
          .eq('tenant_id', tenant_id)
          .gte('occurred_at', periodStart);

        const totalUnits = (events || []).reduce((sum: number, e: any) => sum + Number(e.units), 0);

        if (totalUnits === 0) {
          return new Response(JSON.stringify({ message: 'No usage to report', units: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Report usage to Stripe (set = absolute for the period)
        const usageRecord = await stripeRequest(
          `/subscription_items/${stripeCustomer.stripe_metered_item_id}/usage_records`,
          'POST',
          {
            quantity: String(totalUnits),
            timestamp: String(Math.floor(Date.now() / 1000)),
            action: 'set',
          },
          STRIPE_SECRET_KEY
        );

        // Save record for auditing
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        await supabase.from('stripe_usage_records').insert({
          tenant_id,
          stripe_subscription_item_id: stripeCustomer.stripe_metered_item_id,
          quantity: totalUnits,
          period_start: periodStart.split('T')[0],
          period_end: `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`,
          stripe_usage_record_id: usageRecord.id,
          status: 'reported',
          reported_at: new Date().toISOString(),
        });

        console.log(`Reported ${totalUnits} units for tenant ${tenant_id}`);

        return new Response(JSON.stringify({
          success: true,
          units_reported: totalUnits,
          stripe_usage_record_id: usageRecord.id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 3. CREATE SETUP SESSION (card registration)
      // ============================================
      case 'create_setup_session': {
        if (!tenant_id || !email) {
          return new Response(JSON.stringify({ error: 'tenant_id and email required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get or create Stripe customer
        let { data: existing } = await supabase
          .from('stripe_customers')
          .select('stripe_customer_id')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        let customerId = existing?.stripe_customer_id;

        if (!customerId) {
          const customer = await stripeRequest('/customers', 'POST', {
            email,
            name: name || email,
            'metadata[tenant_id]': tenant_id,
            'metadata[source]': 'setup_session',
          }, STRIPE_SECRET_KEY);
          customerId = customer.id;

          await supabase.from('stripe_customers').upsert({
            tenant_id,
            stripe_customer_id: customerId,
            email,
            name: name || email,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id' });
        }

        // Determine redirect based on service_type
        const origin = req.headers.get('origin') || 'https://biz-chat-tasks.lovable.app';
        const setupRoute = service_type === 'whatsapp' ? '/whatsapp' : '/calls';

        const session = await stripeRequest('/checkout/sessions', 'POST', {
          customer: customerId,
          mode: 'setup',
          'payment_method_types[0]': 'card',
          success_url: `${origin}${setupRoute}?setup=success`,
          cancel_url: `${origin}${setupRoute}?setup=cancel`,
          'metadata[tenant_id]': tenant_id,
          'metadata[mode]': 'pay_as_you_go',
        }, STRIPE_SECRET_KEY);

        // Audit
        await supabase.from('audit_events').insert({
          tenant_id,
          event_type: 'billing.setup_session_created',
          resource_type: 'stripe_session',
          resource_id: session.id,
          payload: { session_url: session.url },
        });

        return new Response(JSON.stringify({
          success: true,
          checkout_url: session.url,
          session_id: session.id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 4. CHECK PAYMENT METHOD
      // ============================================
      case 'check_payment_method': {
        if (!tenant_id) {
          return new Response(JSON.stringify({ error: 'tenant_id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: sc } = await supabase
          .from('stripe_customers')
          .select('stripe_customer_id')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        if (!sc?.stripe_customer_id) {
          return new Response(JSON.stringify({ has_payment_method: false }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Check if customer has payment methods
        const paymentMethods = await stripeRequest(
          `/payment_methods?customer=${sc.stripe_customer_id}&type=card&limit=1`,
          'GET', undefined, STRIPE_SECRET_KEY
        );

        return new Response(JSON.stringify({
          has_payment_method: paymentMethods.data.length > 0,
          stripe_customer_id: sc.stripe_customer_id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 5. PURCHASE PACKAGE (one-time payment + card setup)
      // ============================================
      case 'purchase_package': {
        if (!tenant_id || !package_id || !email) {
          return new Response(JSON.stringify({ error: 'tenant_id, package_id and email required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get package details
        const { data: pkg } = await supabase
          .from('service_packages')
          .select('*')
          .eq('id', package_id)
          .eq('active', true)
          .maybeSingle();

        if (!pkg) {
          return new Response(JSON.stringify({ error: 'Package not found' }), {
            status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get or create Stripe customer
        let { data: existingCust } = await supabase
          .from('stripe_customers')
          .select('stripe_customer_id')
          .eq('tenant_id', tenant_id)
          .maybeSingle();

        let custId = existingCust?.stripe_customer_id;

        if (!custId) {
          const customer = await stripeRequest('/customers', 'POST', {
            email,
            name: name || email,
            'metadata[tenant_id]': tenant_id,
            'metadata[source]': 'package_purchase',
          }, STRIPE_SECRET_KEY);
          custId = customer.id;

          await supabase.from('stripe_customers').upsert({
            tenant_id,
            stripe_customer_id: custId,
            email,
            name: name || email,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'tenant_id' });
        }

        // Create one-time price for this package
        const priceCurrency = (pkg as any).currency?.toLowerCase() || 'mxn';
        const priceAmount = Math.round((pkg as any).price * 100); // cents

        // Search for existing price with metadata
        const existingPrices = await stripeRequest(
          `/prices?active=true&limit=20&lookup_keys=${package_id}_${priceCurrency}`,
          'GET', undefined, STRIPE_SECRET_KEY
        );

        let priceId: string;
        if (existingPrices.data.length > 0) {
          priceId = existingPrices.data[0].id;
        } else {
          // Create product for this package if needed
          const products = await stripeRequest('/products?active=true&limit=100', 'GET', undefined, STRIPE_SECRET_KEY);
          let packageProduct = products.data.find((p: any) => p.metadata?.type === 'officehub_package');

          if (!packageProduct) {
            packageProduct = await stripeRequest('/products', 'POST', {
              name: 'OfficeHub - Paquete de Servicio',
              description: 'Paquete prepagado de minutos o mensajes',
              'metadata[type]': 'officehub_package',
            }, STRIPE_SECRET_KEY);
          }

          const newPrice = await stripeRequest('/prices', 'POST', {
            product: packageProduct.id,
            unit_amount: String(priceAmount),
            currency: priceCurrency,
            lookup_key: `${package_id}_${priceCurrency}`,
          }, STRIPE_SECRET_KEY);
          priceId = newPrice.id;
        }

        // Create Checkout Session in payment mode
        const origin = req.headers.get('origin') || 'https://biz-chat-tasks.lovable.app';
        const successRoute = (pkg as any).service_type === 'voice' ? '/calls' : '/whatsapp';

        const session = await stripeRequest('/checkout/sessions', 'POST', {
          customer: custId,
          mode: 'payment',
          'line_items[0][price]': priceId,
          'line_items[0][quantity]': '1',
          'payment_intent_data[setup_future_usage]': 'off_session',
          success_url: `${origin}${successRoute}?package=success&pkg_id=${package_id}`,
          cancel_url: `${origin}${successRoute}?package=cancel`,
          'metadata[tenant_id]': tenant_id,
          'metadata[package_id]': package_id,
          'metadata[service_type]': (pkg as any).service_type,
          'metadata[units]': String((pkg as any).units),
        }, STRIPE_SECRET_KEY);

        // Provision balance immediately (will be confirmed by webhook)
        await supabase.from('tenant_package_balances').insert({
          tenant_id,
          package_id,
          service_type: (pkg as any).service_type,
          units_purchased: (pkg as any).units,
          units_used: 0,
          status: 'pending_payment',
          stripe_payment_intent_id: session.payment_intent || session.id,
        });

        // Audit
        await supabase.from('audit_events').insert({
          tenant_id,
          event_type: 'billing.package_purchase_initiated',
          resource_type: 'service_package',
          resource_id: package_id,
          payload: {
            package_name: (pkg as any).name,
            units: (pkg as any).units,
            price: (pkg as any).price,
            currency: (pkg as any).currency,
            session_id: session.id,
          },
        });

        return new Response(JSON.stringify({
          success: true,
          checkout_url: session.url,
          session_id: session.id,
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // ============================================
      // 6. GET BILLING STATUS
      // ============================================
      case 'get_billing_status': {
        if (!tenant_id) {
          return new Response(JSON.stringify({ error: 'tenant_id required' }), {
            status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const now = new Date();
        const periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;

        const [customerRes, usageRes, marginRes] = await Promise.all([
          supabase.from('stripe_customers').select('*').eq('tenant_id', tenant_id).maybeSingle(),
          supabase.from('whatsapp_usage_events').select('event_type, units, occurred_at')
            .eq('tenant_id', tenant_id).gte('occurred_at', periodStart),
          supabase.from('realtime_margin_state').select('*').eq('tenant_id', tenant_id).maybeSingle(),
        ]);

        // Aggregate usage
        const usageEvents = usageRes.data || [];
        const totalUnits = usageEvents.reduce((sum: number, e: any) => sum + Number(e.units), 0);
        const byType: Record<string, number> = {};
        for (const ev of usageEvents) {
          byType[ev.event_type] = (byType[ev.event_type] || 0) + Number(ev.units);
        }

        return new Response(JSON.stringify({
          customer: customerRes.data,
          current_month_usage: { total_units: totalUnits, by_type: byType, event_count: usageEvents.length },
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
