// Shared helpers for the isolated load-test harness.
//
// Dry-run is OFF by default in production. It only turns on when ONE of these
// explicit signals is present:
//   1. Env var LOADTEST_MODE = "1" (set manually during a test window; unset after).
//   2. Incoming request header  x-loadtest: 1
//   3. Tenant settings_json.loadtest === true (the reserved LOADTEST tenant).
//
// Never enable dry-run implicitly for any other tenant.

export const LOADTEST_TENANT_ID = '10ad7e57-0000-4000-a000-000000000001';
export const LOADTEST_PHONE_PREFIX = '+10000000';
export const LOADTEST_EMAIL_DOMAIN = 'loadtest.local';

export function isDryRun(
  req: Request | null,
  tenantSettings?: unknown,
): boolean {
  try {
    if (Deno.env.get('LOADTEST_MODE') === '1') return true;
  } catch {
    /* Deno env unreadable → ignore */
  }
  if (req && req.headers.get('x-loadtest') === '1') return true;
  if (
    tenantSettings &&
    typeof tenantSettings === 'object' &&
    (tenantSettings as Record<string, unknown>).loadtest === true
  ) {
    return true;
  }
  return false;
}

export function isLoadtestPhone(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const cleaned = String(raw).trim().replace(/[\s().-]/g, '');
  return cleaned.startsWith(LOADTEST_PHONE_PREFIX);
}

export function simulatedOk(
  kind: string,
  meta: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ok: true,
    dry_run: true,
    kind,
    simulated_at: Date.now(),
    simulated_sid: `SIM_${kind.toUpperCase()}_${crypto.randomUUID()}`,
    ...meta,
  };
}
