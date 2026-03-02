
-- =============================================
-- SECURITY FIX: Drop all "Service role manages" policies
-- Service role ALREADY bypasses RLS, so USING(true) policies
-- are redundant and dangerous (they grant ALL access to everyone)
-- =============================================

DROP POLICY IF EXISTS "Service role manages call costs" ON public.call_costs;
DROP POLICY IF EXISTS "Service role manages jobs" ON public.call_jobs;
DROP POLICY IF EXISTS "Service role manages churn metrics" ON public.churn_model_metrics;
DROP POLICY IF EXISTS "Service role manages contacts" ON public.contacts;
DROP POLICY IF EXISTS "Service role manages expenses" ON public.expenses;
DROP POLICY IF EXISTS "Service role manages projections" ON public.financial_projections;
DROP POLICY IF EXISTS "Service role manages fraud logs" ON public.fraud_detection_logs;
DROP POLICY IF EXISTS "Service role manages thresholds" ON public.fraud_thresholds;
DROP POLICY IF EXISTS "Service role manages fx_rates" ON public.fx_rates;
DROP POLICY IF EXISTS "Service role manages global metrics" ON public.global_metrics_daily;
DROP POLICY IF EXISTS "Service role manages plan pricing" ON public.global_plan_pricing;
DROP POLICY IF EXISTS "Service role manages calendar tokens" ON public.google_calendar_tokens;
DROP POLICY IF EXISTS "Service role manages margin" ON public.margin_metrics;
DROP POLICY IF EXISTS "Service role manages OTP" ON public.otp_challenges;
DROP POLICY IF EXISTS "Service role manages plan changes" ON public.plan_change_history;
DROP POLICY IF EXISTS "Service role manages evaluations" ON public.pricing_evaluations;
DROP POLICY IF EXISTS "Service role manages pricing rules" ON public.pricing_rules;
DROP POLICY IF EXISTS "Service role reads subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS "Service role manages realtime margin" ON public.realtime_margin_state;
DROP POLICY IF EXISTS "Service role manages targets" ON public.regional_margin_targets;
DROP POLICY IF EXISTS "Service role manages reminders" ON public.reminders;
DROP POLICY IF EXISTS "Service role manages retention offers" ON public.retention_offers;
DROP POLICY IF EXISTS "Service role manages packages" ON public.service_packages;
DROP POLICY IF EXISTS "Service role manages credentials" ON public.shared_credentials;
DROP POLICY IF EXISTS "Service role manages stripe customers" ON public.stripe_customers;
DROP POLICY IF EXISTS "Service role manages usage records" ON public.stripe_usage_records;
DROP POLICY IF EXISTS "Service role manages churn scores" ON public.tenant_churn_scores;
DROP POLICY IF EXISTS "Service role manages LTV" ON public.tenant_ltv_estimates;
DROP POLICY IF EXISTS "Service role manages offer history" ON public.tenant_offer_history;
DROP POLICY IF EXISTS "Service role manages balances" ON public.tenant_package_balances;
DROP POLICY IF EXISTS "Service role manages phone numbers" ON public.tenant_phone_numbers;
DROP POLICY IF EXISTS "Service role manages pricing adjustments" ON public.tenant_pricing_adjustments;
DROP POLICY IF EXISTS "Service role manages rate limits" ON public.tenant_rate_limits;
DROP POLICY IF EXISTS "Service role manages subscriptions" ON public.tenant_subscriptions;
DROP POLICY IF EXISTS "Service role manages usage" ON public.tenant_usage_monthly;
DROP POLICY IF EXISTS "Service role manages reconciled costs" ON public.usage_costs_reconciled;
DROP POLICY IF EXISTS "Service role manages volume tiers" ON public.volume_tiers;
DROP POLICY IF EXISTS "Service role manages usage events" ON public.whatsapp_usage_events;

-- Also drop other overly permissive policies
DROP POLICY IF EXISTS "Require authentication for contacts" ON public.contacts;
DROP POLICY IF EXISTS "Require authentication for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Service role writes audit" ON public.audit_events;
DROP POLICY IF EXISTS "Service role writes call events" ON public.call_events;

-- =============================================
-- ADD updated_at TRIGGERS for all tables that need them
-- =============================================
DO $$
DECLARE
  tbl TEXT;
  tables TEXT[] := ARRAY[
    'appointments', 'assistant_conversations', 'assistant_settings',
    'call_jobs', 'call_records', 'contacts', 'expenses',
    'fraud_thresholds', 'global_plan_pricing', 'google_calendar_tokens',
    'knowledge_items', 'pricing_rules', 'profiles', 'realtime_margin_state',
    'regional_margin_targets', 'service_packages', 'shared_credentials',
    'stripe_customers', 'subscription_plans', 'tenant_phone_numbers',
    'tenant_rate_limits', 'tenant_subscriptions', 'tenant_usage_monthly',
    'tenants', 'usage_costs_reconciled', 'volume_tiers', 'whatsapp_conversations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      tbl
    );
  END LOOP;
END $$;
