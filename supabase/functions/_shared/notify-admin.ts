// Shared helper to notify a tenant's owner/admin about a critical event.
// Sends an internal_messages row (in-app inbox) plus an email via Resend when available.
// deno-lint-ignore-file no-explicit-any

const RESEND_FROM = 'no-reply@rybixholding.com';

export interface AdminNotification {
  tenantId: string;
  subject: string;
  body: string;       // plain-text body used both for internal_messages and email
  htmlBody?: string;  // optional richer HTML for email
  eventType?: string; // audit tag
}

async function findTenantOwners(admin: any, tenantId: string): Promise<Array<{ userId: string; email: string | null; name: string | null }>> {
  // Prefer owners; fall back to admins.
  const { data: ownerRoles } = await admin
    .from('user_roles')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .in('role', ['owner', 'admin']);
  const userIds = (ownerRoles ?? []).map((r: any) => r.user_id);
  if (!userIds.length) return [];
  const { data: profs } = await admin
    .from('profiles')
    .select('user_id, email, name')
    .in('user_id', userIds);
  return (profs ?? []).map((p: any) => ({ userId: p.user_id, email: p.email, name: p.name }));
}

export async function notifyTenantAdmin(admin: any, n: AdminNotification): Promise<{ delivered: number; errors: string[] }> {
  const errors: string[] = [];
  let delivered = 0;

  const targets = await findTenantOwners(admin, n.tenantId);
  if (!targets.length) {
    return { delivered: 0, errors: ['no_admin_recipients'] };
  }

  // 1) In-app inbox
  try {
    const rows = targets.map((t) => ({
      tenant_id: n.tenantId,
      recipient_id: t.userId,
      subject: n.subject,
      body: n.body,
      channel: 'system',
    }));
    const { error } = await admin.from('internal_messages').insert(rows);
    if (error) errors.push(`internal_messages: ${error.message}`);
    else delivered += rows.length;
  } catch (e) {
    errors.push(`internal_messages_exception: ${(e as Error).message}`);
  }

  // 2) Email via Resend (best-effort)
  const resendKey = Deno.env.get('RESEND_API_KEY');
  if (resendKey) {
    for (const t of targets) {
      if (!t.email) continue;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from: `RYBIX <${RESEND_FROM}>`,
            to: [t.email],
            subject: n.subject,
            text: n.body,
            html: n.htmlBody ?? `<pre style="font-family:system-ui;font-size:14px;white-space:pre-wrap">${escapeHtml(n.body)}</pre>`,
          }),
        });
        if (!res.ok) errors.push(`resend_${t.email}: ${res.status}`);
      } catch (e) {
        errors.push(`resend_exception_${t.email}: ${(e as Error).message}`);
      }
    }
  }

  // 3) Audit trail (non-blocking)
  try {
    await admin.from('audit_events').insert({
      tenant_id: n.tenantId,
      event_type: n.eventType ?? 'admin_notification',
      actor_id: null,
      resource_type: 'internal_messages',
      resource_id: null,
      payload: { subject: n.subject, targets: targets.length, errors },
    });
  } catch { /* best-effort */ }

  return { delivered, errors };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
