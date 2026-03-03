import { useState } from 'react';
import { CheckCircle2, Circle, Loader2, ArrowRight, ArrowLeft, Copy, ExternalLink, AlertTriangle, Phone, Mic, Settings, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface VoiceAgentWizardProps {
  onComplete: () => void;
  onCancel: () => void;
  currentNumber?: string;
  isConnected?: boolean;
}

const STEPS = [
  { title: 'Bienvenida', description: 'Resumen del flujo', icon: Zap },
  { title: 'Webhook Backend', description: 'URL para Twilio', icon: Settings },
  { title: 'Twilio Config', description: 'Configura tu número', icon: Phone },
  { title: 'ElevenLabs Webhook', description: 'Conecta el webhook', icon: ExternalLink },
  { title: 'Vincular Agente', description: 'Conecta el agente IA', icon: Mic },
  { title: '¡Listo!', description: 'Todo configurado', icon: CheckCircle2 },
];

const VoiceAgentWizard = ({ onComplete, onCancel, currentNumber, isConnected }: VoiceAgentWizardProps) => {
  const [step, setStep] = useState(0);
  const [phoneNumber, setPhoneNumber] = useState(currentNumber || '');
  const [elevenlabsWebhookUrl, setElevenlabsWebhookUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupResult, setSetupResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const inboundWebhookUrl = `${supabaseUrl}/functions/v1/call-inbound-webhook`;
  const statusWebhookUrl = `${supabaseUrl}/functions/v1/call-status-webhook`;

  const normalizeE164 = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    const compact = trimmed.replace(/[\s\-().]/g, '');
    if (compact.startsWith('00')) return `+${compact.slice(2).replace(/\D/g, '')}`;
    if (compact.startsWith('+')) return `+${compact.slice(1).replace(/\D/g, '')}`;
    return `+${compact.replace(/\D/g, '')}`;
  };

  const isValidE164 = (value: string) => /^\+[1-9]\d{7,14}$/.test(value);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('URL copiada al portapapeles');
  };

  const handleFinalSetup = async () => {
    const normalized = normalizeE164(phoneNumber);
    if (!normalized || !isValidE164(normalized)) {
      toast.error('Número inválido. Usa formato E.164, ej: +12135551234');
      return;
    }

    setLoading(true);
    setSetupResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-twilio-setup', {
        body: { action: 'setup', phone_number: normalized },
      });

      if (error) {
        const contextError = (error as any)?.context?.error || (error as any)?.context?.json?.error;
        throw new Error(contextError || error.message || 'Error configurando agente de voz');
      }
      if (data?.error) throw new Error(data.error);

      setSetupResult({ ok: true });
      setStep(5);
    } catch (err: any) {
      setSetupResult({ ok: false, error: err.message || 'Error de configuración' });
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

      {/* Step 0: Welcome */}
      {step === 0 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Zap size={16} className="text-primary" /> ¿Cómo funciona?
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Este asistente te guiará para conectar tu número de Twilio con el agente de voz de ElevenLabs. El flujo es:
            </p>
            <div className="space-y-2.5">
              {[
                { num: '1', title: 'Llamada entrante a Twilio', desc: 'Un cliente llama a tu número de teléfono.' },
                { num: '2', title: 'Registro en tu backend', desc: 'La llamada se registra automáticamente con todos sus detalles.' },
                { num: '3', title: 'Conexión con ElevenLabs', desc: 'La llamada se redirige al agente de voz IA que conversa con el cliente.' },
                { num: '4', title: 'Post-llamada', desc: 'Se genera transcripción, resumen y se agendan citas si aplica.' },
              ].map(item => (
                <div key={item.num} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">{item.num}</span>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
            <p className="font-medium text-foreground mb-1">📋 Requisitos previos</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>Una cuenta de <strong>Twilio</strong> con un número de teléfono comprado (Incoming Phone Number)</li>
              <li>Una cuenta de <strong>ElevenLabs</strong> con un agente de voz configurado</li>
              <li>Las credenciales de Twilio (Account SID, Auth Token) configuradas en el sistema</li>
            </ul>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={onCancel} className="flex-1">Cancelar</Button>
            <Button onClick={() => setStep(1)} className="flex-1 gap-1">
              Comenzar <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 1: Backend Webhook URL */}
      {step === 1 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Settings size={16} className="text-primary" /> URLs de tu Backend
            </h3>
            <p className="text-xs text-muted-foreground">
              Estas son las URLs de webhook que tu backend utiliza para recibir y procesar las llamadas.
              Las necesitarás en el siguiente paso para configurar Twilio.
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1.5">
                📞 Webhook de Llamadas Entrantes
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={inboundWebhookUrl}
                  readOnly
                  className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs outline-none border border-border text-foreground font-mono"
                />
                <button
                  onClick={() => copyToClipboard(inboundWebhookUrl)}
                  className="text-xs bg-secondary text-secondary-foreground p-2 rounded-lg hover:bg-secondary/80 shrink-0"
                  title="Copiar URL"
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Esta URL recibe la llamada, la registra en la base de datos y conecta con ElevenLabs.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-foreground block mb-1.5">
                📊 Webhook de Estado (Status Callback)
              </label>
              <div className="flex items-center gap-2">
                <input
                  value={statusWebhookUrl}
                  readOnly
                  className="flex-1 bg-muted rounded-lg px-3 py-2 text-xs outline-none border border-border text-foreground font-mono"
                />
                <button
                  onClick={() => copyToClipboard(statusWebhookUrl)}
                  className="text-xs bg-secondary text-secondary-foreground p-2 rounded-lg hover:bg-secondary/80 shrink-0"
                  title="Copiar URL"
                >
                  <Copy size={14} />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                Recibe actualizaciones de estado de la llamada (completada, grabación lista, etc.).
              </p>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Importante</p>
              <p>Copia ambas URLs. Las usarás en el paso siguiente al configurar tu número en Twilio.</p>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(0)} className="flex-1 gap-1">
              <ArrowLeft size={14} /> Atrás
            </Button>
            <Button onClick={() => setStep(2)} className="flex-1 gap-1">
              Siguiente <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Twilio Configuration Guide */}
      {step === 2 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Phone size={16} className="text-primary" /> Configura Twilio
            </h3>
            <p className="text-xs text-muted-foreground">
              Sigue estos pasos en la <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">consola de Twilio <ExternalLink size={10} /></a>:
            </p>
          </div>

          <div className="space-y-3">
            {[
              {
                num: '1',
                title: 'Ve a Phone Numbers → Manage → Active Numbers',
                desc: 'Selecciona el número que quieres usar para el agente de voz.',
              },
              {
                num: '2',
                title: 'En "Voice Configuration" → "A Call Comes In"',
                desc: 'Selecciona "Webhook" y pega la URL de llamadas entrantes que copiaste en el paso anterior. Método: HTTP POST.',
                highlight: inboundWebhookUrl,
              },
              {
                num: '3',
                title: 'En "Status Callback URL"',
                desc: 'Pega la URL de estado. Esto permite rastrear el progreso de cada llamada.',
                highlight: statusWebhookUrl,
              },
              {
                num: '4',
                title: 'Guarda los cambios',
                desc: 'Haz clic en "Save configuration" en la parte inferior de la página.',
              },
            ].map(item => (
              <div key={item.num} className="bg-card border border-border rounded-lg p-3">
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <span className="text-[10px] font-bold text-primary">{item.num}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-foreground">{item.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{item.desc}</p>
                    {item.highlight && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <code className="text-[10px] bg-muted px-2 py-1 rounded font-mono text-foreground break-all flex-1">
                          {item.highlight}
                        </code>
                        <button
                          onClick={() => copyToClipboard(item.highlight!)}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                          title="Copiar"
                        >
                          <Copy size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1 gap-1">
              <ArrowLeft size={14} /> Atrás
            </Button>
            <Button onClick={() => setStep(3)} className="flex-1 gap-1">
              Ya lo configuré <ArrowRight size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Step 4: Connect Agent + Phone Number */}
      {step === 4 && (
        <div className="space-y-4 animate-fade-in">
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <h3 className="text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <Mic size={16} className="text-primary" /> Conecta ElevenLabs
            </h3>
            <p className="text-xs text-muted-foreground">
              Ahora necesitamos vincular tu número de Twilio con ElevenLabs para que el agente de voz IA atienda las llamadas.
            </p>
          </div>

          {/* ElevenLabs instructions */}
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">📋 Cómo obtener tus credenciales de ElevenLabs:</p>
            <ol className="space-y-1.5 list-decimal list-inside">
              <li>
                Ve a{' '}
                <a href="https://elevenlabs.io/app/conversational-ai" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                  ElevenLabs Conversational AI <ExternalLink size={10} />
                </a>
              </li>
              <li>Crea o selecciona un agente de voz existente</li>
              <li>Copia el <strong>Agent ID</strong> desde la configuración del agente</li>
              <li>
                Ve a tu{' '}
                <a href="https://elevenlabs.io/app/settings/api-keys" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                  perfil → API Keys <ExternalLink size={10} />
                </a>{' '}
                y copia tu <strong>API Key</strong>
              </li>
            </ol>
            <p className="text-destructive font-medium mt-2">
              ⚠️ Asegúrate de que el API Key y Agent ID estén configurados como secretos en tu backend (ELEVENLABS_API_KEY y ELEVENLABS_AGENT_ID).
            </p>
          </div>

          {/* Phone number input */}
          <div>
            <label className="text-xs font-medium text-foreground block mb-1.5">
              📞 Número de Twilio (formato E.164) *
            </label>
            <input
              value={phoneNumber}
              onChange={e => setPhoneNumber(e.target.value)}
              placeholder="Ej: +12135551234"
              className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary font-mono text-foreground placeholder:text-muted-foreground"
            />
            {phoneNumber && (() => {
              const normalized = normalizeE164(phoneNumber);
              const valid = isValidE164(normalized);
              const digitCount = normalized.replace(/\D/g, '').length;
              return (
                <div className={`text-[10px] mt-1 ${valid ? 'text-success' : 'text-destructive'}`}>
                  {valid
                    ? `✓ Formato válido: ${normalized}`
                    : `✗ Formato inválido (${digitCount} dígitos detectados, se requieren 8-15). Resultado: ${normalized || '—'}`
                  }
                </div>
              );
            })()}
            <p className="text-[10px] text-muted-foreground mt-1">
              Este es el mismo número que configuraste en Twilio en el paso anterior.
            </p>
          </div>

          {setupResult && !setupResult.ok && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
              <div className="text-xs text-destructive">
                <p className="font-medium">Error de configuración</p>
                <p>{setupResult.error}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(3)} className="flex-1 gap-1">
              <ArrowLeft size={14} /> Atrás
            </Button>
            <Button
              onClick={handleFinalSetup}
              disabled={loading || !phoneNumber.trim()}
              className="flex-1 gap-1"
            >
              {loading ? (
                <><Loader2 size={14} className="animate-spin" /> Configurando...</>
              ) : (
                <><Zap size={14} /> Conectar agente</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 5: Done */}
      {step === 5 && (
        <div className="space-y-4 animate-fade-in text-center py-4">
          <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} className="text-success" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">¡Agente de Voz Activo!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Tu número de Twilio está conectado con ElevenLabs. Las llamadas entrantes serán atendidas por el agente IA.
            </p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3 text-xs text-left space-y-1.5">
            <p className="font-medium text-foreground">Resumen de configuración:</p>
            <p className="text-muted-foreground">• Número: <span className="text-foreground font-mono">{normalizeE164(phoneNumber)}</span></p>
            <p className="text-muted-foreground">• Webhook entrante: <span className="text-success">Configurado ✓</span></p>
            <p className="text-muted-foreground">• Status callback: <span className="text-success">Configurado ✓</span></p>
            <p className="text-muted-foreground">• ElevenLabs: <span className="text-success">Conectado ✓</span></p>
          </div>

          <div className="bg-muted/50 rounded-lg p-3 text-xs text-left space-y-1.5">
            <p className="font-medium text-foreground">🧠 Próximos pasos recomendados:</p>
            <ul className="space-y-1 text-muted-foreground list-disc list-inside">
              <li>Configura las <strong>Client Tools</strong> en ElevenLabs (check_availability, book_appointment, etc.)</li>
              <li>Agrega artículos a tu <strong>Knowledge Hub</strong> para mejorar las respuestas del agente</li>
              <li>Realiza una <strong>llamada de prueba</strong> para verificar el flujo completo</li>
            </ul>
          </div>

          <Button onClick={onComplete} className="w-full mt-2">
            Finalizar
          </Button>
        </div>
      )}
    </div>
  );
};

export default VoiceAgentWizard;
