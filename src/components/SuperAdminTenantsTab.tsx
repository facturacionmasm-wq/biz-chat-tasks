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
import { Loader2, RefreshCw, ShieldOff, ShieldCheck, Clock, CreditCard, Crown, Phone } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { TWILIO_COUNTRIES, getTwilioCountry, type TwilioNumberType } from '@/lib/twilio-countries';

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
  | { kind: 'activate'; tenant: AdminTenantRow };

const statusBadge = (status: string, isBlocked: boolean) => {
  if (isBlocked) return 'bg-destructive/10 text-[var(--rx-rose)]';
  if (status === 'active') return 'bg-[rgba(0,232,122,.1)] text-[var(--rx-emerald)]';
  if (status === 'trialing') return 'bg-primary/10 text-[var(--rx-brand)]';
  if (status === 'past_due') return 'bg-warning/10 text-[var(--rx-amber)]';
  return 'bg-muted text-[var(--rx-t2)]';
};

export default function SuperAdminTenantsTab() {
  const [rows, setRows] = useState<AdminTenantRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [extendDaysDraft, setExtendDaysDraft] = useState<Record<string, number>>({});

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

  const runAction = useCallback(async () => {
    if (!pending) return;
    const { tenant } = pending;
    setBusyId(tenant.tenant_id);
    try {
      let action: string;
      let extend_days: number | null = null;
      if (pending.kind === 'extend_trial') {
        action = 'extend_trial';
        extend_days = pending.days;
      } else if (pending.kind === 'block') {
        action = 'block';
      } else if (pending.kind === 'activate') {
        action = 'activate';
      } else {
        action = pending.status === 'active' ? 'activate'
          : pending.status === 'trialing' ? 'set_trialing'
          : 'set_past_due';
      }

      const { error } = await supabase.rpc('admin_manage_tenant_subscription', {
        _tenant_id: tenant.tenant_id,
        _action: action,
        _extend_days: extend_days,
      });
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
    <div className="rx-panel">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-foreground flex items-center gap-2">
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
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        {t.is_master && <Crown size={12} className="text-[var(--rx-amber)]" />}
                        {t.tenant_name}
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
                            className="h-7 w-14 text-xs"
                          />
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1 text-xs"
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
                          <SelectTrigger className="h-7 w-[110px] text-xs">
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
                            size="sm" variant="outline" className="h-7 gap-1 text-xs text-[var(--rx-emerald)]"
                            disabled={busy}
                            onClick={() => setPending({ kind: 'activate', tenant: t })}
                          >
                            <ShieldCheck size={12} /> Activar
                          </Button>
                        ) : (
                          <Button
                            size="sm" variant="outline" className="h-7 gap-1 text-xs text-[var(--rx-rose)]"
                            disabled={busy || t.is_master}
                            onClick={() => setPending({ kind: 'block', tenant: t })}
                          >
                            <ShieldOff size={12} /> Bloquear
                          </Button>
                        )}

                        <Button
                          size="sm" variant="outline" className="h-7 gap-1 text-xs"
                          disabled={busy}
                          onClick={() => openProvision(t)}
                        >
                          <Phone size={12} /> Asignar número Twilio
                        </Button>
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

      {/* Twilio provisioning dialog */}
      <Dialog open={!!provTenant} onOpenChange={(open) => !open && !provPurchasing && setProvTenant(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Asignar número Twilio {provTenant ? `— ${provTenant.tenant_name}` : ''}</DialogTitle>
            <DialogDescription>
              Primero lista los números disponibles (sin costo). La compra solo se ejecuta al confirmar y consume saldo de Twilio.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">País (ISO)</label>
              <Input value={provCountry} onChange={e => setProvCountry(e.target.value)} className="h-8 w-20 uppercase" maxLength={2} />
            </div>
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">Área (opcional)</label>
              <Input value={provAreaCode} onChange={e => setProvAreaCode(e.target.value)} className="h-8 w-24" placeholder="415" />
            </div>
            <Button size="sm" onClick={listAvailable} disabled={provListing} className="h-8 gap-2">
              {provListing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Listar disponibles
            </Button>
          </div>

          <div className="max-h-72 overflow-y-auto border border-[var(--rx-b1)] rounded-lg">
            {provNumbers.length === 0 ? (
              <p className="text-sm text-[var(--rx-t2)] text-center py-8">Sin resultados. Lista los disponibles para elegir uno.</p>
            ) : (
              <ul className="divide-y divide-[var(--rx-b1)]">
                {provNumbers.map(n => (
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
                    </label>
                  </li>
                ))}
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
  );
}

