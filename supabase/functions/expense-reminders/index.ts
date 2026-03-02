import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

/**
 * Daily Expense Reminder Edge Function
 * 
 * Sends WhatsApp reminders to users who have approved budgets
 * but haven't uploaded a payment receipt yet.
 * 
 * Triggered by cron job (once daily at 9:00 AM Mexico City time).
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
  const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
  const TWILIO_PHONE_NUMBER = Deno.env.get('TWILIO_PHONE_NUMBER');

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
    return new Response(JSON.stringify({ error: 'Twilio not configured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // Find all approved budgets without payment receipt (paid_at is null)
    const { data: pendingBudgets, error: fetchError } = await supabase
      .from('expenses')
      .select('id, tenant_id, user_id, amount, currency, vendor_name, description, approved_at')
      .eq('type', 'budget')
      .eq('status', 'approved')
      .is('paid_at', null)
      .order('approved_at', { ascending: true });

    if (fetchError) {
      console.error('Fetch pending budgets error:', fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!pendingBudgets || pendingBudgets.length === 0) {
      return new Response(JSON.stringify({ ok: true, reminders_sent: 0, message: 'No pending budgets' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${pendingBudgets.length} approved budgets pending receipt`);

    let sent = 0;
    let failed = 0;
    const today = new Date().toISOString().split('T')[0];

    for (const budget of pendingBudgets) {
      try {
        // Check if reminder was already sent today
        const { data: existingReminder } = await supabase
          .from('expense_reminders')
          .select('id')
          .eq('expense_id', budget.id)
          .eq('reminder_date', today)
          .maybeSingle();

        if (existingReminder) {
          console.log(`Reminder already sent today for expense ${budget.id}`);
          continue;
        }

        // Get user's WhatsApp number
        const { data: profile } = await supabase
          .from('profiles')
          .select('name, whatsapp_number, phone')
          .eq('user_id', budget.user_id)
          .eq('tenant_id', budget.tenant_id)
          .maybeSingle();

        const recipientPhone = profile?.whatsapp_number || profile?.phone;
        if (!recipientPhone) {
          console.log(`No phone for user ${budget.user_id}, skipping`);
          continue;
        }

        // Calculate days since approval
        const approvedDate = new Date(budget.approved_at);
        const daysSinceApproval = Math.floor((Date.now() - approvedDate.getTime()) / (1000 * 60 * 60 * 24));

        // Send reminder
        const reminderMsg = `⏰ *Recordatorio de comprobante pendiente*\n\n• ${budget.vendor_name || budget.description || 'Presupuesto'}\n• $${budget.amount} ${budget.currency || 'MXN'}\n• Aprobado hace ${daysSinceApproval} día(s)\n\nEnvíame la *foto del comprobante de pago* para completar el registro 📸`;

        const fromWhatsApp = TWILIO_PHONE_NUMBER.startsWith('whatsapp:') ? TWILIO_PHONE_NUMBER : `whatsapp:${TWILIO_PHONE_NUMBER}`;
        const toWhatsApp = recipientPhone.startsWith('whatsapp:') ? recipientPhone : `whatsapp:${recipientPhone}`;

        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              From: fromWhatsApp,
              To: toWhatsApp,
              Body: reminderMsg,
            }).toString(),
          }
        );

        const twilioResult = await twilioRes.json();
        const success = twilioRes.ok && twilioResult.sid;

        // Record reminder
        await supabase.from('expense_reminders').insert({
          tenant_id: budget.tenant_id,
          expense_id: budget.id,
          recipient_user_id: budget.user_id,
          recipient_phone: recipientPhone,
          reminder_date: today,
          status: success ? 'sent' : 'failed',
          sent_at: success ? new Date().toISOString() : null,
          error_message: success ? null : (twilioResult.message || 'Twilio error'),
        });

        if (success) {
          sent++;
          console.log(`Reminder sent for expense ${budget.id} to ${recipientPhone}`);
        } else {
          failed++;
          console.error(`Failed to send reminder for expense ${budget.id}:`, twilioResult.message);
        }
      } catch (e) {
        failed++;
        console.error(`Error processing budget ${budget.id}:`, e);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      reminders_sent: sent,
      reminders_failed: failed,
      total_pending: pendingBudgets.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Expense reminders error:', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
