import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, X, CheckCircle2, FileText, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { TWILIO_COUNTRIES } from '@/lib/twilio-countries';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  requestType: 'hosted_sms' | 'port_in';
  onSubmitted?: () => void;
}

interface UploadedDoc {
  type: 'loa' | 'carrier_bill' | 'id_document';
  name: string;
  storage_path: string;
}

const DOC_TYPES: { key: UploadedDoc['type']; label: string; help: string }[] = [
  { key: 'loa', label: 'Carta de autorización (LOA)', help: 'PDF firmado por el titular autorizando la migración a Twilio.' },
  { key: 'carrier_bill', label: 'Factura reciente del carrier', help: 'PDF o imagen de la última factura (menos de 30 días) mostrando el número.' },
  { key: 'id_document', label: 'Identificación oficial del titular', help: 'INE, pasaporte o similar en imagen o PDF.' },
];

const HostedNumberRequestForm = ({ open, onOpenChange, requestType, onSubmitted }: Props) => {
  const [phone, setPhone] = useState('+1');
  const [country, setCountry] = useState<string>(requestType === 'hosted_sms' ? 'US' : 'US');
  const [carrier, setCarrier] = useState('');
  const [caps, setCaps] = useState({ sms: true, voice: requestType === 'port_in', mms: false });
  const [docs, setDocs] = useState<UploadedDoc[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const eligibleCountries = requestType === 'hosted_sms'
    ? TWILIO_COUNTRIES.filter((c) => ['US', 'CA'].includes(c.code))
    : TWILIO_COUNTRIES.filter((c) => ['US', 'CA', 'MX'].includes(c.code));

  const reset = () => {
    setPhone('+1');
    setCountry('US');
    setCarrier('');
    setCaps({ sms: true, voice: requestType === 'port_in', mms: false });
    setDocs([]);
    setUploading(null);
    setSubmitting(false);
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 300);
  };

  const handleUpload = async (docType: UploadedDoc['type'], file: File) => {
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
      const path = `${profile.tenant_id}/pending/${Date.now()}_${docType}_${safeName}`;
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
    if (!/^\+[1-9]\d{6,15}$/.test(phone)) {
      toast.error('Número inválido. Usa formato E.164 (+1234567890)');
      return;
    }
    if (docs.length < 3) {
      toast.error('Adjunta los 3 documentos requeridos antes de enviar');
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('byon-request', {
        body: {
          request_type: requestType,
          phone_number: phone,
          country_code: country,
          current_carrier: carrier || undefined,
          desired_capabilities: caps,
          documents: docs,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error al enviar');
      toast.success('Solicitud enviada. El equipo de soporte la revisará en las próximas 24-48 horas hábiles.');
      onSubmitted?.();
      handleClose(false);
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo enviar la solicitud');
    } finally {
      setSubmitting(false);
    }
  };

  const isPortIn = requestType === 'port_in';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isPortIn ? 'Solicitar portabilidad total' : 'Solicitar Hosted SMS'}</DialogTitle>
          <DialogDescription>
            {isPortIn
              ? 'Migra tu número completo a Twilio. Toma 2 a 4 semanas y el número deja tu operadora actual.'
              : 'Conserva tu operadora de voz y deja que Twilio gestione tus SMS. Toma 5 a 15 días hábiles.'}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-[var(--rx-amber)]/10 border border-[var(--rx-amber)]/30 p-3 flex gap-2 text-xs text-foreground">
          <AlertTriangle size={14} className="text-[var(--rx-amber)] shrink-0 mt-0.5" />
          <p>
            Esta solicitud requiere aprobación manual por parte del equipo de soporte y trámite ante Twilio y tu operadora.
            Tiempos estimados: <strong>{isPortIn ? '2 a 4 semanas' : '5 a 15 días hábiles'}</strong>.
          </p>
        </div>

        <div className="space-y-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1">País del número</label>
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm border border-[var(--rx-b1)]"
              >
                {eligibleCountries.map((c) => (
                  <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Número (E.164)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.trim())}
                placeholder="+15558675310"
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm border border-[var(--rx-b1)]"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium block mb-1">Operadora actual (opcional)</label>
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="Ej: Telcel, AT&T, Verizon"
              className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm border border-[var(--rx-b1)]"
            />
          </div>

          <div>
            <label className="text-xs font-medium block mb-1">Capacidades deseadas</label>
            <div className="flex gap-2 flex-wrap">
              {(['sms', 'voice', 'mms'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setCaps((p) => ({ ...p, [k]: !p[k] }))}
                  className={`text-xs px-3 py-1.5 rounded-lg border ${caps[k] ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'bg-[var(--rx-s2)] border-[var(--rx-b1)]'}`}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            <p className="text-xs font-semibold mb-2">Documentos requeridos</p>
            <div className="space-y-2">
              {DOC_TYPES.map((dt) => {
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
            {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
            Enviar solicitud a soporte
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HostedNumberRequestForm;
