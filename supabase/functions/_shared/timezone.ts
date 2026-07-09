// Shared timezone helpers for Edge Functions.
// Kept dependency-free (Deno std / Intl only) to avoid pulling date-fns-tz
// into every function.

/**
 * Resolve the IANA timezone for a tenant.
 *
 * Priority (matches send-reminders/resolveTenantTimezone):
 *   1. settings_json.branches[default].timezone
 *   2. settings_json.branches[0].timezone
 *   3. settings_json.timezone
 *   4. tenants.timezone (column)
 *   5. 'America/Mexico_City'
 */
export function resolveTenantTimezoneFrom(
  settings: unknown,
  tenantTimezoneColumn?: string | null,
): string {
  const s = (settings ?? {}) as Record<string, unknown>;
  const branches = Array.isArray((s as any).branches) ? ((s as any).branches as any[]) : [];
  const def = branches.find((b) => b && b.is_default) || branches[0] || null;
  const branchTz = def && typeof def.timezone === 'string' ? String(def.timezone).trim() : '';
  if (branchTz) return branchTz;
  const legacyTz = typeof (s as any).timezone === 'string' ? String((s as any).timezone).trim() : '';
  if (legacyTz) return legacyTz;
  const col = typeof tenantTimezoneColumn === 'string' ? tenantTimezoneColumn.trim() : '';
  if (col) return col;
  return 'America/Mexico_City';
}

/** Return the tenant timezone by reading tenants row (settings_json + timezone column). */
export async function resolveTenantTimezone(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string | null | undefined,
  fallback = 'America/Mexico_City',
): Promise<string> {
  if (!tenantId) return fallback;
  try {
    const { data } = await supabase
      .from('tenants')
      .select('settings_json, timezone')
      .eq('id', tenantId)
      .maybeSingle();
    return resolveTenantTimezoneFrom(data?.settings_json, data?.timezone) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Get the UTC-offset (minutes) of an IANA timezone at a specific UTC instant.
 * Handles DST correctly for any IANA zone.
 */
function getTzOffsetMinutes(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce((acc: Record<string, string>, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  // Intl formats hour "24" for midnight in some locales; normalize.
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(hour), Number(parts.minute), Number(parts.second),
  );
  return (asUTC - date.getTime()) / 60000;
}

/**
 * Interpret a naive wall-clock datetime (YYYY-MM-DDTHH:mm[:ss]) as local time in `tz`
 * and return the equivalent UTC Date. Equivalent to date-fns-tz's zonedTimeToUtc.
 */
export function zonedTimeToUtc(naive: string, tz: string): Date {
  // Strip any accidental Z or offset the caller left in.
  const clean = String(naive).trim()
    .replace(/Z$/i, '')
    .replace(/([+-]\d{2}:?\d{2})$/, '');
  const [datePart, timePartRaw] = clean.split('T');
  const timePart = timePartRaw || '00:00:00';
  const [Y, M, D] = datePart.split('-').map(Number);
  const [h, m, s] = timePart.split(':').map(Number);
  if (!Y || !M || !D || Number.isNaN(h) || Number.isNaN(m)) {
    // Fallback: let Date parse it, callers should validate upstream.
    return new Date(naive);
  }
  // Initial guess: treat wall-clock as UTC.
  const utcGuess = Date.UTC(Y, M - 1, D, h, m, s || 0);
  // Compute the offset of `tz` at that instant and shift.
  const offsetMin = getTzOffsetMinutes(tz, new Date(utcGuess));
  return new Date(utcGuess - offsetMin * 60000);
}

/** Format an ISO/UTC date in the given IANA timezone using Spanish (Mexico) locale. */
export function formatInTimezone(
  date: Date | string,
  tz: string,
  opts: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('es-MX', { ...opts, timeZone: tz }).format(d);
}
