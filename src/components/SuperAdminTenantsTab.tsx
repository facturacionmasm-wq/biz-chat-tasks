import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, RefreshCw, ShieldOff, ShieldCheck, Clock, CreditCard, Crown, Phone, Trash2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TWILIO_COUNTRIES, getTwilioCountry, type TwilioNumberType } from '@/lib/twilio-countries';
import SuperAdminByonRequests from '@/components/SuperAdminByonRequests';
import { useIsDesktop } from '@/hooks/useMediaQuery';


interface AdminTenantRow {
  tenant_id: string;
  tenant_name: string;
  status: string;
  plan_slug: string | null;
  plan_name: string | null;
  trial_ends_at: string | null;
  days_remaining: number;
  is_blocked: boolean;
  is_master: boolean;
}

type PendingAction =
  | { kind: 'extend_trial'; tenant: AdminTenantRow; days: number }
  | { kind: 'set_status'; tenant: AdminTenantRow; status: 'active' | 'trialing' | 'past_due' }
  | { kind: 'block'; tenant: AdminTenantRow }
  | { kind: 'activate'; tenant: AdminTenantRow }
  | { kind: 'change_plan'; tenant: AdminTenantRow; plan_slug: string };

interface PlanOption { slug: string; name: string; }

const statusBadge = (status: string, isBlocked: boolean) => {
  if (isBlocked) return 'bg-destructive/10 text-[var(--rx-rose)]';
  if (status === 'active') return 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]';
  if (status === 'trialing') return 'bg-primary/10 text-[var(--rx-brand)]';
  if (status === 'past_due') return 'bg-warning/10 text-[var(--rx-amber)]';
  return 'bg-muted text-[var(--rx-t2)]';
};

export default function SuperAdminTenantsTab() {
  const isDesktop = useIsDesktop();
  const [rows, setRows] = useState<AdminTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [extendDaysDraft, setExtendDaysDraft] = useState<Record<string, number>>({});
  const [plans, setPlans] = useState<PlanOption[]>([]);

  // Delete tenant flow
  const [deleteTarget, setDeleteTarget] = useState<AdminTenantRow | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Twilio provisioning state
  const [provTenant, setProvTenant] = useState<AdminTenantRow | null>(null);
  const [provCountry, setProvCountry] = useState('US');
  const [provType, setProvType] = useState<TwilioNumberType>('Local');
  const [provCapSms, setProvCapSms] = useState(true);
  const [provCapVoice, setProvCapVoice] = useState(true);
  const [provCapMms, setProvCapMms] = useState(false);
  const [provAreaCode, setProvAreaCode] = useState('');
  const [provListing, setProvListing] = useState(false);
  const [provPurchasing, setProvPurchasing] = useState(false);
  const [provNumbers, setProvNumbers] = useState<Array<{ phone_number: string; friendly_name: string; locality?: string; region?: string; capabilities?: Record<string, boolean> }>>([]);
  const [provSelected, setProvSelected] = useState<string | null>(null);
  const [provConfirm, setProvConfirm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('admin_list_tenants_with_subscription');
      if (error) throw error;
      setRows((data || []) as AdminTenantRow[]);
    } catch (err: any) {
      console.error('[SuperAdminTenants] load error', err);
      toast.error(err.message || 'Error al cargar tenants');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('subscription_plans').select('slug, name').order('price_monthly', { ascending: true, nullsFirst: false });
      setPlans((data || []) as PlanOption[]);
    })();
  }, []);

  const handleDeleteTenant = useCallback(async () => {
    if (!deleteTarget) return;
    if (deleteConfirmName.trim() !== deleteTarget.tenant_name) {
      toast.error('El nombre no coincide');
      return;
    }
    setDeleting(true);
    try {
      // Get current super_admin user id so the worker can authenticate the delete.
      const { data: userData } = await supabase.auth.getUser();
      const callerId = userData?.user?.id ?? null;

      // Try async enqueue first — deletes can take tens of seconds and hit gateway timeouts.
      let enqueued = false;
      try {
        const { data: jobRow, error: enqErr } = await supabase
          .from('background_jobs')
          .insert({
            tenant_id: null, // tenant is being deleted; keep NULL so hook doesn't show it after
            job_type: 'delete_tenant',
            payload: {
              tenant_id: deleteTarget.tenant_id,
              confirm_name: deleteTarget.tenant_name,
            },
            created_by: callerId,
            max_attempts: 1, // deletion is destructive — do NOT auto-retry
          })
          .select('id')
          .single();
        if (!enqErr && jobRow?.id) {
          enqueued = true;
          supabase.functions.invoke('background-job-worker', { body: {} }).catch(() => {});
          toast.success(`Borrado en proceso para "${deleteTarget.tenant_name}"`);
          setDeleteTarget(null);
          setDeleteConfirmName('');
          await load();
        }
      } catch (e) {
        console.warn('[admin-delete-tenant] enqueue failed, falling back to direct call:', e);
      }
      if (!enqueued) {
        const { data, error } = await supabase.functions.invoke('admin-delete-tenant', {
          body: { tenant_id: deleteTarget.tenant_id, confirm_name: deleteTarget.tenant_name },
        });
        const bodyErr = (data as any)?.error
          || (error as any)?.context?.responseJson?.error
          || (error as any)?.context?.body?.error;
        if (bodyErr) throw new Error(bodyErr);
        if (error) throw error;
        toast.success(`Tenant "${deleteTarget.tenant_name}" eliminado`);
        setDeleteTarget(null);
        setDeleteConfirmName('');
        await load();
      }
    } catch (err: any) {
      console.error('[admin-delete-tenant] error:', err);
      toast.error(err?.message || 'Error al eliminar tenant');
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, deleteConfirmName, load]);


  const runAction = useCallback(async () => {
    if (!pending) return;
    const { tenant } = pending;
    setBusyId(tenant.tenant_id);
    try {
      let action: string;
      let extend_days: number | null = null;
      let new_plan_slug: string | null = null;
      if (pending.kind === 'extend_trial') {
        action = 'extend_trial';
        extend_days = pending.days;
      } else if (pending.kind === 'block') {
        action = 'block';
      } else if (pending.kind === 'activate') {
        action = 'activate';
      } else if (pending.kind === 'change_plan') {
        action = 'change_plan';
        new_plan_slug = pending.plan_slug;
      } else {
        action = pending.status === 'active' ? 'activate'
          : pending.status === 'trialing' ? 'set_trialing'
          : 'set_past_due';
      }

      const { error } = await supabase.rpc('admin_manage_tenant_subscription', {
        _tenant_id: tenant.tenant_id,
        _action: action,
        _extend_days: extend_days,
        _new_plan_slug: new_plan_slug,
      } as any);
      if (error) throw error;
      toast.success('Cambio aplicado');
      setPending(null);
      await load();
    } catch (err: any) {
      console.error('[SuperAdminTenants] action error', err);
      toast.error(err.message || 'Error al aplicar cambio');
    } finally {
      setBusyId(null);
    }
  }, [pending, load]);

  const openProvision = useCallback((t: AdminTenantRow) => {
    setProvTenant(t);
    setProvCountry('US');
    setProvType('Local');
    setProvCapSms(true);
    setProvCapVoice(true);
    setProvCapMms(false);
    setProvAreaCode('');
    setProvNumbers([]);
    setProvSelected(null);
    setProvConfirm(false);
  }, []);

  const buildCapabilities = useCallback(() => {
    const caps: string[] = [];
    if (provCapSms) caps.push('SMS');
    if (provCapVoice) caps.push('Voice');
    if (provCapMms) caps.push('MMS');
    return caps;
  }, [provCapSms, provCapVoice, provCapMms]);

  const listAvailable = useCallback(async () => {
    if (!provTenant) return;
    setProvListing(true);
    setProvNumbers([]);
    setProvSelected(null);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-provision-number', {
        body: {
          tenant_id: provTenant.tenant_id,
          country_code: provCountry.trim().toUpperCase() || undefined,
          areaCode: provAreaCode.trim() || undefined,
          type: provType,
          capabilities: buildCapabilities(),
          dryRun: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error al listar');
      setProvNumbers(data.numbers || []);
      if ((data.numbers || []).length === 0) toast.info('Sin números disponibles con esos filtros');
    } catch (err: any) {
      console.error('[provision] list error', err);
      toast.error(err.message || 'Error al listar números');
    } finally {
      setProvListing(false);
    }
  }, [provTenant, provCountry, provAreaCode, provType, buildCapabilities]);

  const purchaseSelected = useCallback(async () => {
    if (!provTenant || !provSelected) return;
    setProvPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-provision-number', {
        body: {
          tenant_id: provTenant.tenant_id,
          country_code: provCountry.trim().toUpperCase() || undefined,
          phoneNumber: provSelected,
          type: provType,
          dryRun: false,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error al comprar');
      toast.success(`Número asignado: ${data.phone_number}`);
      setProvTenant(null);
      setProvConfirm(false);
      await load();
    } catch (err: any) {
      console.error('[provision] purchase error', err);
      toast.error(err.message || 'Error al comprar número');
    } finally {
      setProvPurchasing(false);
    }
  }, [provTenant, provSelected, provCountry, provType, load]);



  return (
    <div className="space-y-4">
    <SuperAdminByonRequests />
    <div className="rx-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="font-semibold text-foreground flex min-w-0 items-center gap-2">
          <CreditCard size={16} className="text-[var(--rx-brand)]" /> Gestión de tenants
        </h3>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refrescar
        </Button>
      </div>

      {loading ? (
        <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-[var(--rx-brand)]" /></div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-[var(--rx-t2)] text-center py-6">Sin tenants.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--rx-b1)] text-left">
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)]">Tenant</th>
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)]">Plan</th>
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)]">Estado</th>
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)]">Trial expira</th>
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)] text-right">Días</th>
                <th className="py-2 px-3 font-medium text-[var(--rx-t2)]">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(t => {
                const draft = extendDaysDraft[t.tenant_id] ?? 15;
                const busy = busyId === t.tenant_id;
                return (
                  <tr key={t.tenant_id} className="border-b border-[var(--rx-b1)]/50 align-top">
                    <td className="py-3 px-3 min-w-[160px] max-w-[240px]">
                      <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                        {t.is_master && <Crown size={12} className="text-[var(--rx-amber)]" />}
                        <span className="min-w-0 break-words leading-snug">{t.tenant_name}</span>
                      </div>
                      <div className="text-[10px] text-[var(--rx-t2)] font-mono mt-0.5">{t.tenant_id.slice(0, 8)}…</div>
                    </td>
                    <td className="py-3 px-3 text-[var(--rx-t2)]">{t.plan_name || '—'}</td>
                    <td className="py-3 px-3">
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${statusBadge(t.status, t.is_blocked)}`}>
                        {t.is_blocked ? 'BLOQUEADO' : t.status}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-[var(--rx-t2)] text-xs">
                      {t.trial_ends_at ? format(new Date(t.trial_ends_at), 'd MMM yyyy', { locale: es }) : '—'}
                    </td>
                    <td className="py-3 px-3 text-right font-semibold text-foreground">{t.days_remaining}</td>
                    <td className="py-3 px-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="flex items-center gap-1">
                          <Input
                            type="number"
                            min={1}
                            max={365}
                            value={draft}
                            disabled={busy}
                            onChange={e => setExtendDaysDraft(s => ({ ...s, [t.tenant_id]: Math.max(1, Number(e.target.value) || 15) }))}
                            className="h-7 w-16 px-2 text-xs"
                          />
                          <Button
                            size="sm" variant="outline" className="min-h-7 gap-1 px-2 py-1 text-xs"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'extend_trial', tenant: t, days: draft })}
                          >
                            <Clock size={12} /> Trial
                          </Button>
                        </div>

                        <Select
                          disabled={busy || t.is_master}
                          onValueChange={(v) => setPending({ kind: 'set_status', tenant: t, status: v as any })}
                        >
                          <SelectTrigger className="min-h-7 w-[110px] text-xs">
                            <SelectValue placeholder="Pago…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">active (pagado)</SelectItem>
                            <SelectItem value="trialing">trialing</SelectItem>
                            <SelectItem value="past_due">past_due</SelectItem>
                          </SelectContent>
                        </Select>

                        {t.is_blocked ? (
                          <Button
                            size="sm" variant="outline" className="min-h-7 gap-1 px-2 py-1 text-xs text-[var(--rx-emerald)]"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'activate', tenant: t })}
                          >
                            <ShieldCheck size={12} /> Activar
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="outline" className="min-h-7 gap-1 px-2 py-1 text-xs text-[var(--rx-rose)]"
                            disabled={busy || t.is_master}
                            onClick={() => setPending({ kind: 'block', tenant: t })}
                          >
                            <ShieldOff size={12} /> Bloquear
                          </Button>
                        )}

                        <Button
                          size="sm" variant="outline" className="min-h-7 gap-1 px-2 py-1 text-xs"
                          disabled={busy}
                          onClick={() => openProvision(t)}
                        >
                          <Phone size={12} /> Twilio
                        </Button>

                        <Select
                          disabled={busy || t.is_master || plans.length === 0}
                          value={t.plan_slug || undefined}
                          onValueChange={(v) => { if (v !== t.plan_slug) setPending({ kind: 'change_plan', tenant: t, plan_slug: v }); }}
                        >
                            <SelectTrigger className="min-h-7 w-[120px] text-xs">
                            <SelectValue placeholder="Plan…" />
                          </SelectTrigger>
                          <SelectContent>
                            {plans.map(p => (
                              <SelectItem key={p.slug} value={p.slug}>
                                <Package size={12} className="inline mr-1" /> {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {!t.is_master && (
                          <Button
                            size="sm" variant="outline" className="min-h-7 gap-1 px-2 py-1 text-xs text-[var(--rx-rose)]"
                            disabled={busy}
                            onClick={() => { setDeleteTarget(t); setDeleteConfirmName(''); }}
                          >
                            <Trash2 size={12} /> Eliminar
                          </Button>
                        )}
                      </div>

                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar acción</AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'extend_trial' && `Extender trial de "${pending.tenant.tenant_name}" por ${pending.days} días.`}
              {pending?.kind === 'block' && `Bloquear a "${pending.tenant.tenant_name}". El tenant no podrá usar servicios (WhatsApp, envíos).`}
              {pending?.kind === 'activate' && `Reactivar a "${pending.tenant.tenant_name}" (status: active).`}
              {pending?.kind === 'set_status' && `Cambiar estado de "${pending.tenant.tenant_name}" a "${pending.status}".`}
              {pending?.kind === 'change_plan' && `Cambiar plan de "${pending.tenant.tenant_name}" a "${plans.find(p => p.slug === pending.plan_slug)?.name || pending.plan_slug}".`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={runAction} disabled={!!busyId}>
              {busyId ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete tenant confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) { setDeleteTarget(null); setDeleteConfirmName(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[var(--rx-rose)] flex items-center gap-2">
              <Trash2 size={16} /> Eliminar tenant
            </DialogTitle>
            <DialogDescription>
              Esta acción es <strong>irreversible</strong>. Se eliminarán usuarios, suscripciones, números, gastos, documentos y todo dato asociado a <strong>{deleteTarget?.tenant_name}</strong>.
              Se cancelará su suscripción activa en Stripe si existe.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-[var(--rx-t2)]">
              Escribe el nombre exacto del tenant para confirmar: <span className="font-mono text-foreground">{deleteTarget?.tenant_name}</span>
            </label>
            <Input
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={deleteTarget?.tenant_name || ''}
              disabled={deleting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteTarget(null); setDeleteConfirmName(''); }} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTenant}
              disabled={deleting || deleteConfirmName.trim() !== (deleteTarget?.tenant_name || '__')}
              className="gap-2"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Eliminar definitivamente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Twilio provisioning dialog */}
      <Dialog open={!!provTenant} onOpenChange={(open) => !open && !provPurchasing && setProvTenant(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Asignar número Twilio {provTenant ? `— ${provTenant.tenant_name}` : ''}</DialogTitle>
            <DialogDescription>
              Primero lista los números disponibles (sin costo). La compra solo se ejecuta al confirmar y consume saldo de Twilio.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">País</label>
              <Select value={provCountry} onValueChange={(v) => { setProvCountry(v); const c = getTwilioCountry(v); if (c && !c.types.includes(provType)) setProvType(c.types[0]); }}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {TWILIO_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code}){c.requiresBundle ? ' ⚠️' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">Tipo</label>
              <Select value={provType} onValueChange={(v) => setProvType(v as TwilioNumberType)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(getTwilioCountry(provCountry)?.types || ['Local', 'Mobile', 'TollFree']).map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">Área / prefijo</label>
              <Input value={provAreaCode} onChange={e => setProvAreaCode(e.target.value)} className="h-9" placeholder="415" />
            </div>
            <div className="flex items-end">
              <Button size="sm" onClick={listAvailable} disabled={provListing} className="h-9 w-full gap-2">
                {provListing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Listar
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-[var(--rx-t2)] mb-3">
            <span className="font-medium text-foreground">Capacidades:</span>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={provCapSms} onChange={(e) => setProvCapSms(e.target.checked)} /> SMS</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={provCapVoice} onChange={(e) => setProvCapVoice(e.target.checked)} /> Voice</label>
            <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={provCapMms} onChange={(e) => setProvCapMms(e.target.checked)} /> MMS</label>
            {getTwilioCountry(provCountry)?.requiresBundle && (
              <span className="text-[var(--rx-amber)] ml-auto">⚠️ Este país requiere Regulatory Bundle en Twilio.</span>
            )}
          </div>

          <div className="max-h-72 overflow-y-auto border border-[var(--rx-b1)] rounded-lg">
            {provNumbers.length === 0 ? (
              <p className="text-sm text-[var(--rx-t2)] text-center py-8">Sin resultados. Lista los disponibles para elegir uno.</p>
            ) : (
              <ul className="divide-y divide-[var(--rx-b1)]">
                {provNumbers.map(n => {
                  const caps = n.capabilities || {};
                  return (
                    <li key={n.phone_number}>
                      <label className="flex items-center gap-3 p-2 px-3 hover:bg-[var(--rx-s2)]/40 cursor-pointer">
                        <input
                          type="radio"
                          name="prov-number"
                          checked={provSelected === n.phone_number}
                          onChange={() => setProvSelected(n.phone_number)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-sm text-foreground">{n.phone_number}</div>
                          <div className="text-xs text-[var(--rx-t2)] truncate">
                            {n.friendly_name}{n.locality ? ` · ${n.locality}` : ''}{n.region ? `, ${n.region}` : ''}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          {(caps as any).SMS && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--rx-s2)]/60">SMS</span>}
                          {(caps as any).voice && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--rx-s2)]/60">Voice</span>}
                          {(caps as any).MMS && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--rx-s2)]/60">MMS</span>}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-xs text-[var(--rx-amber)] mt-3">
            ⚠️ Comprar un número consume saldo real de Twilio y factura mensualmente. Solo procede si estás seguro.
          </p>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProvTenant(null)} disabled={provPurchasing}>Cancelar</Button>
            <Button
              onClick={() => setProvConfirm(true)}
              disabled={!provSelected || provPurchasing}
              className="gap-2"
            >
              <Phone size={14} /> Comprar número seleccionado
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={provConfirm} onOpenChange={(open) => !open && !provPurchasing && setProvConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar compra en Twilio</AlertDialogTitle>
            <AlertDialogDescription>
              Vas a comprar <span className="font-mono">{provSelected}</span> para el tenant "{provTenant?.tenant_name}".
              Esta acción consume saldo real de Twilio y genera cobros mensuales recurrentes. ¿Continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={provPurchasing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={purchaseSelected} disabled={provPurchasing}>
              {provPurchasing ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
              Confirmar compra
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </div>
  );
}

