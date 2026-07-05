import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Loader2, Phone, ArrowRight, ArrowLeft, CheckCircle2, ShieldAlert, ShieldCheck, Clock, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { TWILIO_COUNTRIES, getTwilioCountry, type TwilioNumberType } from '@/lib/twilio-countries';
import RegulatoryBundleRequestForm from '@/components/byon/RegulatoryBundleRequestForm';

interface AvailableNumber {
  phone_number: string;
  friendly_name: string;
  locality?: string;
  region?: string;
  capabilities?: Record<string, boolean>;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchased?: (phoneNumber: string) => void;
  defaultCountry?: string;
}

type Step = 1 | 2 | 3 | 4 | 5;

export default function TenantNumberPurchaseWizard({ open, onOpenChange, onPurchased, defaultCountry }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [country, setCountry] = useState<string>((defaultCountry || 'US').toUpperCase());
  const [type, setType] = useState<TwilioNumberType>('Local');
  const [areaCode, setAreaCode] = useState('');
  const [listing, setListing] = useState(false);
  const [numbers, setNumbers] = useState<AvailableNumber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [acceptCharge, setAcceptCharge] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [purchasedNumber, setPurchasedNumber] = useState<string | null>(null);
  const [bundleFormOpen, setBundleFormOpen] = useState(false);
  const [bundleStatus, setBundleStatus] = useState<'unknown' | 'none' | 'pending' | 'approved' | 'rejected'>('unknown');
  const [bundleLoading, setBundleLoading] = useState(false);

  const countryMeta = useMemo(() => getTwilioCountry(country), [country]);
  const requiresBundle = !!countryMeta?.requiresBundle;
  const bundleApproved = bundleStatus === 'approved';
  const bundleBlocked = requiresBundle && !bundleApproved;

  const reset = useCallback(() => {
    setStep(1);
    setCountry((defaultCountry || 'US').toUpperCase());
    setType('Local');
    setAreaCode('');
    setNumbers([]);
    setSelected(null);
    setAcceptCharge(false);
    setPurchasedNumber(null);
  }, [defaultCountry]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (countryMeta && !countryMeta.types.includes(type)) {
      setType(countryMeta.types[0]);
    }
  }, [countryMeta, type]);

  const refreshBundleStatus = useCallback(async () => {
    if (!requiresBundle || !open) {
      setBundleStatus('unknown');
      return;
    }
    setBundleLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setBundleStatus('none'); return; }
      const { data: profile } = await supabase
        .from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
      if (!profile?.tenant_id) { setBundleStatus('none'); return; }
      const { data: req } = await supabase
        .from('byon_requests')
        .select('status, created_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('country_code', country)
        .eq('request_type', 'regulatory_bundle')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!req) setBundleStatus('none');
      else if (req.status === 'approved') setBundleStatus('approved');
      else if (req.status === 'rejected') setBundleStatus('rejected');
      else setBundleStatus('pending');
    } catch (_) {
      setBundleStatus('none');
    } finally {
      setBundleLoading(false);
    }
  }, [requiresBundle, open, country]);

  useEffect(() => { refreshBundleStatus(); }, [refreshBundleStatus]);


  const goList = useCallback(async () => {
    setListing(true);
    setNumbers([]);
    setSelected(null);
    try {
      const { data, error } = await supabase.functions.invoke('tenant-provision-number', {
        body: {
          country_code: country,
          type,
          areaCode: areaCode.trim() || undefined,
          dryRun: true,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        if (data?.error === 'billing_gate') {
          toast.error(data.message || 'Suscripción no activa.');
          return;
        }
        throw new Error(data?.message || data?.error || 'Error al listar');
      }
      setNumbers(data.numbers || []);
      setStep(3);
      if ((data.numbers || []).length === 0) toast.info('Sin números disponibles con esos filtros.');
    } catch (err: any) {
      console.error('[tenant-purchase] list error', err);
      toast.error(err.message || 'Error al listar números');
    } finally {
      setListing(false);
    }
  }, [country, type, areaCode]);

  const goPurchase = useCallback(async () => {
    if (!selected) return;
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke('tenant-provision-number', {
        body: {
          country_code: country,
          type,
          phoneNumber: selected,
          dryRun: false,
        },
      });
      if (error) throw error;
      if (!data?.ok) {
        if (data?.error === 'already_provisioned') {
          toast.info(`Ya tienes un número asignado: ${data.phone_number}`);
          setPurchasedNumber(data.phone_number);
          setStep(5);
          return;
        }
        if (data?.error === 'billing_gate') {
          toast.error(data.message || 'Suscripción no activa.');
          return;
        }
        if (data?.error === 'payment_method_required') {
          toast.error('Registra un método de pago antes de comprar un número.');
          try {
            const { data: setup } = await supabase.functions.invoke('stripe-billing', {
              body: { action: 'create_setup_session', return_to: window.location.pathname },
            });
            if (setup?.url) window.location.href = setup.url;
          } catch (_) { /* ignore */ }
          return;
        }
        throw new Error(data?.message || data?.error || 'Error al comprar');
      }
      if (data?.charge && data.charge.ok === false) {
        toast.warning('Número comprado, pero el cargo automático quedó pendiente. Revisa tu método de pago.');
      } else if (data?.charge?.ok) {
        toast.success('Número comprado y cobrado correctamente.');
      }
      setPurchasedNumber(data.phone_number);
      setStep(5);
      onPurchased?.(data.phone_number);
      toast.success(`Número asignado: ${data.phone_number}`);
    } catch (err: any) {
      console.error('[tenant-purchase] purchase error', err);
      toast.error(err.message || 'Error al comprar número');
    } finally {
      setPurchasing(false);
    }
  }, [selected, country, type, onPurchased]);

  const closeAndDone = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (!purchasing ? onOpenChange(o) : null)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Phone size={18} className="text-[var(--rx-brand)]" /> Comprar número de teléfono
          </DialogTitle>
          <DialogDescription>
            Elige país, tipo y número. El cobro es mensual y recurrente a través de Twilio.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs text-[var(--rx-t2)] mb-4">
          {['País', 'Tipo', 'Elegir', 'Confirmar', 'Listo'].map((label, i) => {
            const n = (i + 1) as Step;
            const active = step === n;
            const done = step > n;
            return (
              <div key={label} className="flex items-center gap-1">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                  done ? 'bg-[var(--rx-emerald)] text-white'
                       : active ? 'bg-[var(--rx-brand)] text-black'
                       : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'
                }`}>{n}</span>
                <span className={active ? 'text-foreground font-medium' : ''}>{label}</span>
                {i < 4 && <span className="opacity-40">›</span>}
              </div>
            );
          })}
        </div>

        {/* Step 1: País */}
        {step === 1 && (
          <div className="space-y-4">
            <div>
              <label className="text-xs text-[var(--rx-t2)] block mb-1">País / región</label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {TWILIO_COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.flag} {c.name} ({c.code}){c.requiresBundle ? ' ⚠️' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {requiresBundle && (
              <div className="rounded-lg border p-3 text-xs space-y-2 bg-[var(--rx-amber)]/10 border-[var(--rx-amber)]/30">
                {bundleStatus === 'approved' ? (
                  <div className="flex items-start gap-2">
                    <ShieldCheck size={16} className="text-[var(--rx-emerald)] shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground">Regulatory Bundle aprobado ✓</p>
                      <p className="text-[var(--rx-t2)] mt-1">
                        Ya puedes comprar un número en {countryMeta?.name}. El cobro se realiza al confirmar la compra.
                      </p>
                    </div>
                  </div>
                ) : bundleStatus === 'pending' ? (
                  <div className="flex items-start gap-2">
                    <Clock size={16} className="text-[var(--rx-amber)] shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Documentos en revisión</p>
                      <p className="text-[var(--rx-t2)] mt-1">
                        Tu Regulatory Bundle para {countryMeta?.name} está siendo revisado por Twilio (24 a 72 h hábiles).
                        Te avisaremos cuando quede aprobado.
                      </p>
                      <button
                        onClick={refreshBundleStatus}
                        className="mt-2 text-[var(--rx-brand)] underline text-[11px]"
                        disabled={bundleLoading}
                      >
                        {bundleLoading ? 'Consultando…' : 'Actualizar estado'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={16} className="text-[var(--rx-amber)] shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-foreground">Este país requiere verificación (Regulatory Bundle)</p>
                      <p className="text-[var(--rx-t2)] mt-1">
                        Twilio exige documentación de identidad y domicilio local para vender números en {countryMeta?.name}.
                        Sube los documentos aquí; en cuanto Twilio los apruebe podrás elegir el número y se realizará el cobro.
                      </p>
                      {bundleStatus === 'rejected' && (
                        <p className="text-[var(--rx-rose)] mt-1 text-[11px]">
                          La solicitud anterior fue rechazada. Corrige los documentos y vuelve a enviarla.
                        </p>
                      )}
                      <Button
                        onClick={() => setBundleFormOpen(true)}
                        size="sm"
                        className="mt-2 gap-1.5"
                      >
                        <Upload size={12} /> Subir documentos de verificación
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={() => setStep(2)} disabled={bundleBlocked} className="gap-2">
                Siguiente <ArrowRight size={14} />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 2: Tipo + prefijo */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--rx-t2)] block mb-1">Tipo de número</label>
                <Select value={type} onValueChange={(v) => setType(v as TwilioNumberType)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(countryMeta?.types || ['Local', 'Mobile', 'TollFree']).map((t) => (
                      <SelectItem key={t} value={t}>
                        {t === 'Local' ? 'Local (fijo)' : t === 'Mobile' ? 'Móvil' : 'Toll‑Free (0800)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-[var(--rx-t2)] block mb-1">Área / prefijo (opcional)</label>
                <Input value={areaCode} onChange={(e) => setAreaCode(e.target.value)} className="h-10" placeholder="415" />
              </div>
            </div>
            <p className="text-xs text-[var(--rx-t2)]">
              Ejemplos: <span className="font-mono">415</span> para San Francisco, <span className="font-mono">55</span> para CDMX.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2"><ArrowLeft size={14} /> Atrás</Button>
              <Button onClick={goList} disabled={listing} className="gap-2">
                {listing ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                Buscar números
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Elegir número */}
        {step === 3 && (
          <div className="space-y-3">
            <div className="max-h-72 overflow-y-auto border border-[var(--rx-b1)] rounded-lg">
              {numbers.length === 0 ? (
                <div className="text-sm text-[var(--rx-t2)] text-center py-8">
                  Sin resultados con esos filtros. Ajusta el prefijo o el tipo.
                </div>
              ) : (
                <ul className="divide-y divide-[var(--rx-b1)]">
                  {numbers.map((n) => {
                    const caps = n.capabilities || {};
                    return (
                      <li key={n.phone_number}>
                        <label className="flex items-center gap-3 p-2 px-3 hover:bg-[var(--rx-s2)]/40 cursor-pointer">
                          <input
                            type="radio"
                            name="tenant-prov-number"
                            checked={selected === n.phone_number}
                            onChange={() => setSelected(n.phone_number)}
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
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2"><ArrowLeft size={14} /> Atrás</Button>
              <Button onClick={() => setStep(4)} disabled={!selected} className="gap-2">
                Siguiente <ArrowRight size={14} />
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 4: Confirmar */}
        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--rx-b1)] p-4 space-y-2">
              <div className="text-xs text-[var(--rx-t2)]">Vas a comprar</div>
              <div className="font-mono text-lg text-foreground">{selected}</div>
              <div className="text-xs text-[var(--rx-t2)]">
                {countryMeta?.flag} {countryMeta?.name} · {type}
              </div>
            </div>
            <div className="rounded-lg bg-[var(--rx-amber)]/10 border border-[var(--rx-amber)]/30 p-3 text-xs text-foreground space-y-1">
              <p className="font-semibold">Costo estimado y cobro automático</p>
              <p className="text-[var(--rx-t2)]">
                Al confirmar, verificamos tu tarjeta en Stripe y hacemos el cargo del primer mes de renta del número
                (~$1–$15 USD/mes según país y tipo). El consumo por uso se factura aparte.
                Detalle: <a href="https://www.twilio.com/en-us/pricing" target="_blank" rel="noreferrer" className="underline">pricing.twilio.com</a>.
              </p>
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={acceptCharge} onChange={(e) => setAcceptCharge(e.target.checked)} className="mt-0.5" />
              <span className="text-[var(--rx-t2)]">
                Acepto el cobro recurrente mensual de este número y el consumo asociado.
              </span>
            </label>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(3)} disabled={purchasing} className="gap-2"><ArrowLeft size={14} /> Atrás</Button>
              <Button onClick={goPurchase} disabled={!acceptCharge || purchasing} className="gap-2">
                {purchasing ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
                Comprar
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step 5: Éxito */}
        {step === 5 && purchasedNumber && (
          <div className="space-y-4 text-center py-4">
            <div className="mx-auto w-14 h-14 rounded-full bg-[var(--rx-emerald)]/15 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-[var(--rx-emerald)]" />
            </div>
            <div>
              <p className="text-sm text-[var(--rx-t2)]">Número asignado a tu cuenta</p>
              <p className="font-mono text-xl text-foreground mt-1">{purchasedNumber}</p>
            </div>
            <p className="text-xs text-[var(--rx-t2)] max-w-md mx-auto">
              Ya puedes conectar WhatsApp o el Agente de Voz usando este número.
            </p>
            <DialogFooter>
              <Button onClick={closeAndDone} className="gap-2 mx-auto">Continuar</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>

      <RegulatoryBundleRequestForm
        open={bundleFormOpen}
        onOpenChange={setBundleFormOpen}
        countryCode={country}
        numberType={type}
        onSubmitted={() => { setBundleStatus('pending'); refreshBundleStatus(); }}
      />
    </Dialog>
  );
}
