import { useState } from 'react';
import { Loader2, ShieldCheck, ArrowRight, CheckCircle2, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type Step = 'phone' | 'verify' | 'done';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onVerified?: () => void;
}

const VerifiedCallerIdWizard = ({ open, onOpenChange, onVerified }: Props) => {
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('+52');
  const [via, setVia] = useState<'sms' | 'call'>('sms');
  const [loading, setLoading] = useState(false);
  const [validationCode, setValidationCode] = useState<string | null>(null);

  const reset = () => {
    setStep('phone');
    setPhone('+52');
    setValidationCode(null);
    setLoading(false);
  };

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 300);
  };

  const startVerification = async () => {
    if (!/^\+[1-9]\d{6,15}$/.test(phone)) {
      toast.error('Formato inválido. Usa E.164, por ejemplo +5215512345678');
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-verify-caller-id', {
        body: { action: 'start', phone_number: phone, via },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Error iniciando verificación');
      setValidationCode(data?.validation_code || null);
      setStep('verify');
      toast.success('Verificación iniciada. Revisa tu teléfono.');
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo iniciar la verificación');
    } finally {
      setLoading(false);
    }
  };

  const checkVerification = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-verify-caller-id', {
        body: { action: 'confirm', phone_number: phone },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Aún no verificado');
      if (data.verified) {
        setStep('done');
        toast.success('¡Número verificado!');
        onVerified?.();
      } else {
        toast.info(data?.message || 'Aún no aparece verificado. Intenta en unos segundos.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Aún no verificado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--rx-brand)]" /> Verificar mi número (Twilio)
          </DialogTitle>
          <DialogDescription>
            Verifica tu número personal para usarlo como remitente en SMS y llamadas salientes.
          </DialogDescription>
        </DialogHeader>

        {step === 'phone' && (
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Número (E.164)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.trim())}
                placeholder="+5215512345678"
                className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary"
              />
              <p className="text-[10px] text-[var(--rx-t2)] mt-1">Incluye código de país con el signo +.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Método de verificación</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setVia('sms')}
                  className={`flex-1 text-xs px-3 py-2 rounded-lg border ${via === 'sms' ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'bg-[var(--rx-s2)] border-[var(--rx-b1)]'}`}
                >
                  SMS
                </button>
                <button
                  onClick={() => setVia('call')}
                  className={`flex-1 text-xs px-3 py-2 rounded-lg border ${via === 'call' ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground border-primary' : 'bg-[var(--rx-s2)] border-[var(--rx-b1)]'}`}
                >
                  Llamada
                </button>
              </div>
              <p className="text-[10px] text-[var(--rx-t2)] mt-1">Twilio suele usar llamada de voz para verificación; el SMS depende del país.</p>
            </div>
            <Button onClick={startVerification} disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
              Iniciar verificación
            </Button>
          </div>
        )}

        {step === 'verify' && (
          <div className="space-y-4">
            <div className="bg-[var(--rx-s2)]/60 rounded-lg p-4 text-sm text-foreground">
              <p className="font-semibold mb-2">Twilio te contactó a {phone}</p>
              {validationCode ? (
                <p className="text-[var(--rx-t2)]">
                  Cuando te llame, ingresa este código en tu teléfono:
                  <span className="block mt-2 font-mono text-2xl text-center text-[var(--rx-brand)]">{validationCode}</span>
                </p>
              ) : (
                <p className="text-[var(--rx-t2)]">Sigue las instrucciones que recibirás por {via === 'sms' ? 'SMS' : 'llamada'}.</p>
              )}
            </div>
            <Button onClick={checkVerification} disabled={loading} className="w-full gap-2">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              Ya lo hice, verificar
            </Button>
            <button
              onClick={() => setStep('phone')}
              className="w-full text-xs text-[var(--rx-t2)] hover:text-foreground"
            >
              Volver al paso anterior
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="space-y-4 text-center py-4">
            <div className="w-14 h-14 mx-auto rounded-full bg-[var(--rx-emerald)]/15 flex items-center justify-center">
              <CheckCircle2 size={28} className="text-[var(--rx-emerald)]" />
            </div>
            <div>
              <p className="text-base font-semibold text-foreground">Número verificado</p>
              <p className="text-xs text-[var(--rx-t2)] mt-1 font-mono">{phone}</p>
              <p className="text-xs text-[var(--rx-t2)] mt-3">
                Ya puedes usarlo como remitente en llamadas y SMS salientes. Recuerda: las respuestas seguirán llegando a tu operadora normal.
              </p>
            </div>
            <Button onClick={() => handleClose(false)} className="w-full">Cerrar</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default VerifiedCallerIdWizard;
