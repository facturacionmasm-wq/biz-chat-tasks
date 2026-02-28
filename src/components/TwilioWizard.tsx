import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, ArrowRight, ArrowLeft, Copy, ExternalLink, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface TwilioWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS = [
  { title: 'Credenciales', description: 'Ingresa tus datos de Twilio' },
  { title: 'Verificación', description: 'Validamos tu cuenta' },
  { title: 'Webhook', description: 'Configuración automática' },
  { title: 'Listo', description: 'Integración completada' },
];

const TwilioWizard = ({ onComplete, onCancel }: TwilioWizardProps) => {
  const [step, setStep] = useState(0);
  const [accountSid, setAccountSid] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; friendlyName?: string; error?: string } | null>(null);
  const [webhookResult, setWebhookResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  const handleVerify = async () => {
    if (!accountSid.trim() || !authToken.trim() || !phoneNumber.trim()) {
      toast.error('Todos los campos son obligatorios');
      return;
    }
    setLoading(true);
    setVerifyResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-setup', {
        body: {
          action: 'verify',
          accountSid: accountSid.trim(),
          authToken: authToken.trim(),
          phoneNumber: phoneNumber.trim(),
        },
      });
      if (error) throw error;
      if (data?.ok) {
        setVerifyResult({ ok: true, friendlyName: data.friendlyName || phoneNumber });
        setStep(2);
      } else {
        setVerifyResult({ ok: false, error: data?.error || 'No se pudo verificar la cuenta' });
      }
    } catch (err: any) {
      setVerifyResult({ ok: false, error: err.message || 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  };

  const handleConfigureWebhook = async () => {
    setLoading(true);
    setWebhookResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('twilio-setup', {
        body: {
          action: 'configure_webhook',
          accountSid: accountSid.trim(),
          authToken: authToken.trim(),
          phoneNumber: phoneNumber.trim(),
          webhookUrl,
        },
      });
      if (error) throw error;
      if (data?.ok) {
        setWebhookResult({ ok: true });
        setStep(3);
      } else {
        setWebhookResult({ ok: false, error: data?.error || 'No se pudo configurar el webhook' });
      }
    } catch (err: any) {
      setWebhookResult({ ok: false, error: err.message || 'Error de conexión' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Progress steps */}
      <div className="flex items-center gap-1">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-1 flex-1">
            <div className={`flex items-center gap-1.5 ${i <= step ? 'text-primary' : 'text-muted-foreground'}`}>
              {i < step ? (
                <CheckCircle2 size={16} className="text-success shrink-0" />
              ) : i === step ? (
                <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold text-primary-foreground">{i + 1}</span>
                </div>
              ) : (
                <Circle size={16} className="shrink-0 opacity-40" />
              )}
              <span className="text-[11px] font-medium truncate hidden sm:inline">{s.title}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-1 ${i < step ? 'bg-success' : 'bg-border'}`} />
            )}
          </div>
        ))}
      </div>

      {/* Step 0: Credentials */}
      {step === 0 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">¿Dónde encuentro mis credenciales?</p>
            <p>Inicia sesión en <a href="https://console.twilio.com" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">console.twilio.com <ExternalLink size={10} /></a> y ve a <strong>Account Info</strong> en el dashboard principal.</p>
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Account SID *</label>
            <input
              value={accountSid}
              onChange={e => setAccountSid(e.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground font-mono"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Auth Token *</label>
            <input
              type="password"
              value={authToken}
              onChange={e => setAuthToken(e.target.value)}
              placeholder="Tu Auth Token secreto"
              className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-foreground block mb-1">Número de WhatsApp *</label>
            <input
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              placeholder="whatsapp:+14155238886"
              className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Formato: whatsapp:+[código][número]. Ej: whatsapp:+5215512345678</p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
            <Button onClick={() => setStep(1)} disabled={!accountSid.trim() || !authToken.trim() || !phoneNumber.trim()} className="flex-1 gap-1">
              Siguiente <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Verify */}
      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-card border border-border rounded-lg p-4 space-y-2 text-sm">
            <p className="font-medium text-foreground">Verificaremos tu cuenta de Twilio</p>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>✓ Validar Account SID y Auth Token</p>
              <p>✓ Comprobar que el número de WhatsApp está activo</p>
              <p>✓ Verificar permisos de la cuenta</p>
            </div>
          </div>

          {verifyResult && !verifyResult.ok && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
              <div className="text-xs text-destructive">
                <p className="font-medium">Error de verificación</p>
                <p>{verifyResult.error}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(0)} className="flex-1 gap-1">
              <ArrowLeft size={14} /> Atrás
            </Button>
            <Button onClick={handleVerify} disabled={loading} className="flex-1 gap-1">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Verificando...</> : <>Verificar cuenta <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Webhook */}
      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex items-start gap-2">
            <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-medium text-foreground">Cuenta verificada correctamente</p>
              <p className="text-muted-foreground">{verifyResult?.friendlyName}</p>
            </div>
          </div>

          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Configuración automática del webhook</p>
            <p className="text-xs text-muted-foreground">
              Configuraremos automáticamente la URL del webhook en tu cuenta de Twilio para recibir mensajes entrantes.
            </p>
            <div>
              <label className="text-[10px] font-medium text-muted-foreground block mb-1">URL del webhook</label>
              <div className="flex items-center gap-2">
                <input
                  value={webhookUrl}
                  readOnly
                  className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs outline-none border border-border text-muted-foreground font-mono"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('URL copiada'); }}
                  className="text-xs bg-secondary text-secondary-foreground p-2 rounded-lg hover:bg-secondary/80 shrink-0"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          </div>

          {webhookResult && !webhookResult.ok && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
              <div className="text-xs text-destructive">
                <p className="font-medium">Error al configurar webhook</p>
                <p>{webhookResult.error}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1 gap-1">
              <ArrowLeft size={14} /> Atrás
            </Button>
            <Button onClick={handleConfigureWebhook} disabled={loading} className="flex-1 gap-1">
              {loading ? <><Loader2 size={14} className="animate-spin" /> Configurando...</> : <>Configurar webhook <ArrowRight size={14} /></>}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 3 && (
        <div className="space-y-4 animate-fade-in text-center py-4">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-success" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">¡Integración completada!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tu número de WhatsApp via Twilio está listo para recibir mensajes.
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-left space-y-1.5">
            <p className="font-medium text-foreground">Resumen de configuración:</p>
            <p className="text-muted-foreground">• Cuenta: <span className="text-foreground font-mono">{accountSid.slice(0, 10)}...</span></p>
            <p className="text-muted-foreground">• Número: <span className="text-foreground font-mono">{phoneNumber}</span></p>
            <p className="text-muted-foreground">• Webhook: <span className="text-success">Configurado ✓</span></p>
          </div>
          <Button onClick={onComplete} className="w-full mt-2">
            Finalizar
          </Button>
        </div>
      )}
    </div>
  );
};

export default TwilioWizard;
