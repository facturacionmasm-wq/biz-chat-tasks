import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, Upload, X, CheckCircle2, FileText, AlertTriangle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getTwilioCountry, type TwilioNumberType } from '@/lib/twilio-countries';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  countryCode: string;
  numberType?: TwilioNumberType;
  onSubmitted?: () => void;
}

type EntityType = 'business' | 'individual';

interface UploadedDoc {
  type: string;
  name: string;
  storage_path: string;
}

// Common Twilio Regulatory Bundle documents. Exact requirements depend on the
// country and number type; the support team validates against Twilio's live list.
const DOC_TYPES: { key: string; label: string; help: string; entity: 'both' | 'business' | 'individual' }[] = [
  { key: 'gov_id', label: 'Identificación oficial del representante', help: 'INE, pasaporte o cédula del titular / representante legal.', entity: 'both' },
  { key: 'address_proof', label: 'Comprobante de domicilio local', help: 'Recibo (luz, agua, teléfono) menor a 3 meses con el domicilio en el país del número.', entity: 'both' },
  { key: 'business_registration', label: 'Registro de la empresa', help: 'Acta constitutiva, certificate of incorporation o equivalente.', entity: 'business' },
  { key: 'tax_id_doc', label: 'RFC / Tax ID / VAT', help: 'Constancia de situación fiscal, certificado del RFC o equivalente.', entity: 'business' },
];

const RegulatoryBundleRequestForm = ({ open, onOpenChange, countryCode, numberType = 'Local', onSubmitted }: Props) => {
  const country = getTwilioCountry(countryCode);
  const [entityType, setEntityType] = useState<EntityType>('business');
  const [businessName, setBusinessName] = useState('');
  const [contactName, setContactName] = useState('');
  const [address, setAddress] = useState('');
  const [taxId, setTaxId] = useState('');
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requiredKeys = DOC_TYPES.filter((d) => d.entity === 'both' || d.entity === entityType).map((d) => d.key);

  const reset = () => {
    setEntityType('business');
    setBusinessName('');
    setContactName('');
    setAddress('');
    setTaxId('');
    setDocs([]);
    setUploading(null);
    setSubmitting(false);
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 300);
  };

  const handleUpload = async (docType: string, file: File) => {
    if (file.size > 15 * 1024 * 1024) {
      toast.error('El archivo debe pesar menos de 15 MB');
      return;
    }
    setUploading(docType);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
      if (!profile?.tenant_id) throw new Error('Sin tenant');
      const safeName = file.name.replace(/[^\w.\-]+/g, '_');
      const path = `${profile.tenant_id}/bundle/${countryCode}/${Date.now()}_${docType}_${safeName}`;
      const { error } = await supabase.storage.from('byon-requests').upload(path, file, { upsert: false });
      if (error) throw error;
      setDocs((prev) => [...prev.filter((d) => d.type !== docType), { type: docType, name: file.name, storage_path: path }]);
      toast.success(`${file.name} subido`);
    } catch (e: any) {
      toast.error(e?.message || 'Error al subir el archivo');
    } finally {
      setUploading(null);
    }
  };

  const submit = async () => {
    if (entityType === 'business' && !businessName.trim()) {
      toast.error('Ingresa el nombre legal de la empresa');
      return;
    }
    if (!contactName.trim()) {
      toast.error('Ingresa el nombre del contacto');
      return;
    }
    if (!address.trim()) {
      toast.error('Ingresa la dirección local en el país del número');
      return;
    }
    const missing = requiredKeys.filter((k) => !docs.some((d) => d.type === k));
    if (missing.length > 0) {
      toast.error(`Faltan documentos: ${missing.length}`);
      return;
    }
    setSubmitting(true);
    try {
      // 1) Crear la solicitud BYON
      const { data, error } = await supabase.functions.invoke('byon-request', {
        body: {
          request_type: 'regulatory_bundle',
          country_code: countryCode,
          entity_type: entityType,
          business_name: businessName || null,
          contact_name: contactName,
          address,
          tax_id: taxId || null,
          number_type: numberType,
          documents: docs,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error al enviar');
      const byonRequestId = data?.request?.id;

      // 2) Cobrar la fee de verificación ($15 USD) vía Stripe
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user!.id).maybeSingle();

      const { data: charge, error: chargeErr } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'charge_verification_fee',
          tenant_id: profile?.tenant_id,
          byon_request_id: byonRequestId,
          country_code: countryCode,
          amount: VERIFICATION_FEE_USD,
          currency: 'usd',
        },
      });

      if (chargeErr || !charge?.ok) {
        const errMsg = (charge as any)?.error;
        if (errMsg === 'no_payment_method' || errMsg === 'no_customer') {
          toast.error('Necesitas registrar una tarjeta antes de enviar. Te redirigimos...');
          // Redirigir a Stripe Setup
          const { data: setup } = await supabase.functions.invoke('stripe-billing', {
            body: {
              action: 'create_setup_session',
              tenant_id: profile?.tenant_id,
              return_to: `${window.location.origin}/integrations`,
            },
          });
          if (setup?.url) window.location.href = setup.url;
          return;
        }
        throw new Error((charge as any)?.message || chargeErr?.message || 'Error en el cobro');
      }

      toast.success(`Cobro de $${VERIFICATION_FEE_USD} USD procesado. Documentos enviados. Nuestro equipo los registra ante Twilio en las próximas horas.`);
      onSubmitted?.();
      handleClose(false);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar la solicitud');
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--rx-brand)]" />
            Verificación para {country?.flag} {country?.name}
          </DialogTitle>
          <DialogDescription>
            Twilio exige un <strong>Regulatory Bundle</strong> aprobado antes de vender números en este país.
            Sube los documentos aquí; nuestro equipo los registra ante Twilio y en cuanto se aprueban podrás comprar el número y se hará el cobro.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-[var(--rx-amber)]/10 border border-[var(--rx-amber)]/30 p-3 flex gap-2 text-xs text-foreground">
          <AlertTriangle size={14} className="text-[var(--rx-amber)] shrink-0 mt-0.5" />
          <p>
            Aprobación estimada: <strong>24 a 72 horas hábiles</strong>. Recibirás una notificación en la app.
            No se realiza ningún cargo hasta que Twilio apruebe la documentación y confirmes la compra del número.
          </p>
        </div>

        <div className="space-y-3 mt-2">
          <div>
            <label className="text-xs font-medium block mb-1">Tipo de titular</label>
            <div className="flex gap-2">
              {(['business', 'individual'] as EntityType[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setEntityType(k)}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${entityType === k ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'bg-[var(--rx-s2)] border-[var(--rx-b1)]'}`}
                >
                  {k === 'business' ? 'Empresa' : 'Persona física'}
                </button>
              ))}
            </div>
          </div>

          {entityType === 'business' && (
            <div>
              <label className="text-xs font-medium block mb-1">Nombre legal de la empresa</label>
              <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme S.A. de C.V." className="h-9" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">Contacto responsable</label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Nombre y apellido" className="h-9" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">RFC / Tax ID (opcional)</label>
              <Input value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="RFC / VAT" className="h-9" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1">Dirección local en {country?.name}</label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, número, colonia, ciudad, CP" className="h-9" />
            <p className="text-[10px] text-[var(--rx-t2)] mt-1">
              Twilio exige una dirección dentro del país del número. Coincide con el comprobante de domicilio.
            </p>
          </div>

          <div className="pt-2">
            <p className="text-xs font-semibold mb-2">Documentos requeridos ({requiredKeys.length})</p>
            <div className="space-y-2">
              {DOC_TYPES.filter((d) => d.entity === 'both' || d.entity === entityType).map((dt) => {
                const uploaded = docs.find((d) => d.type === dt.key);
                return (
                  <div key={dt.key} className="border border-[var(--rx-b1)] rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium">{dt.label}</p>
                      {uploaded && (
                        <span className="text-[10px] text-[var(--rx-emerald)] flex items-center gap-1">
                          <CheckCircle2 size={10} /> Subido
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--rx-t2)] mb-2">{dt.help}</p>
                    {uploaded ? (
                      <div className="flex items-center justify-between text-xs bg-[var(--rx-s2)]/50 rounded-md px-2 py-1.5">
                        <span className="flex items-center gap-1.5 truncate">
                          <FileText size={12} /> {uploaded.name}
                        </span>
                        <button
                          onClick={() => setDocs((prev) => prev.filter((d) => d.type !== dt.key))}
                          className="text-[var(--rx-t2)] hover:text-[var(--rx-rose)]"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <label className="flex items-center gap-2 text-xs cursor-pointer text-[var(--rx-brand)] hover:opacity-80">
                        {uploading === dt.key ? (
                          <><Loader2 size={12} className="animate-spin" /> Subiendo...</>
                        ) : (
                          <><Upload size={12} /> Elegir archivo (PDF o imagen)</>
                        )}
                        <input
                          type="file"
                          accept=".pdf,image/*"
                          className="hidden"
                          disabled={uploading !== null}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleUpload(dt.key, f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Button onClick={submit} disabled={submitting} className="w-full gap-2">
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Enviar documentos para verificación
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RegulatoryBundleRequestForm;
