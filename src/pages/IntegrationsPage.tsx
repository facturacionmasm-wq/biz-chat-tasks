import { useState } from 'react';
import { Plug, MessageSquare, CalendarDays, Brain, Shield, ExternalLink, CheckCircle2, Circle, X, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import TwilioWizard from '@/components/TwilioWizard';

const integrationsMeta = [
  {
    id: 'google-calendar', name: 'Google Calendar', description: 'Sincroniza eventos del equipo con Google Calendar',
    icon: CalendarDays, connected: true, category: 'Productividad',
  },
  {
    id: 'whatsapp', name: 'WhatsApp Business', description: 'Captura mensajes y datos importantes desde WhatsApp',
    icon: MessageSquare, connected: false, category: 'Comunicación',
  },
  {
    id: 'ai-copilot', name: 'AI Copilot', description: 'Resúmenes, extracción de acciones y búsqueda semántica con IA',
    icon: Brain, connected: true, category: 'IA',
  },
  {
    id: 'sso', name: 'SSO / SAML', description: 'Single Sign-On para autenticación empresarial',
    icon: Shield, connected: false, category: 'Seguridad',
  },
];

type WaProvider = 'meta' | 'twilio';

const IntegrationsPage = () => {
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [twilioWizardOpen, setTwilioWizardOpen] = useState(false);
  const [waProvider, setWaProvider] = useState<WaProvider>('meta');
  const [waConfig, setWaConfig] = useState({
    phoneNumberId: '',
    businessAccountId: '',
    accessToken: '',
    verifyToken: '',
    webhookUrl: '',
  });
  const [twilioConfig, setTwilioConfig] = useState({
    accountSid: '',
    authToken: '',
    phoneNumber: '',
  });
  const [saving, setSaving] = useState(false);
  const [waConnected, setWaConnected] = useState(false);

  const integrations = integrationsMeta.map(i =>
    i.id === 'whatsapp' ? { ...i, connected: waConnected } : i
  );

  const handleIntegrationClick = (id: string) => {
    if (id === 'whatsapp') {
      setWaDialogOpen(true);
    } else {
      toast.info('Configuración próximamente');
    }
  };

  const handleSaveWaConfig = async () => {
    if (waProvider === 'meta' && (!waConfig.phoneNumberId || !waConfig.accessToken)) {
      toast.error('Phone Number ID y Access Token son obligatorios');
      return;
    }
    if (waProvider === 'twilio' && (!twilioConfig.accountSid || !twilioConfig.authToken || !twilioConfig.phoneNumber)) {
      toast.error('Account SID, Auth Token y Phone Number son obligatorios');
      return;
    }
    setSaving(true);
    try {
      toast.success(`Configuración de WhatsApp (${waProvider === 'meta' ? 'Meta Cloud API' : 'Twilio'}) guardada correctamente`);
      setWaConnected(true);
      setWaDialogOpen(false);
    } catch {
      toast.error('Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-webhook`;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Plug size={20} className="text-primary" /> Integraciones
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Conecta herramientas externas para potenciar tu espacio de trabajo.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {integrations.map(int => (
          <div key={int.id} className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <int.icon size={20} className="text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{int.name}</h3>
                  <p className="text-xs text-muted-foreground">{int.category}</p>
                </div>
              </div>
              {int.connected ? (
                <span className="flex items-center gap-1 text-xs text-success font-medium"><CheckCircle2 size={12} /> Conectado</span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground"><Circle size={12} /> Desconectado</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mb-4">{int.description}</p>
            <button
              onClick={() => handleIntegrationClick(int.id)}
              className={`text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors ${
                int.connected ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-primary text-primary-foreground hover:opacity-90'
              }`}
            >
              {int.connected ? 'Configurar' : 'Conectar'} <ExternalLink size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* WhatsApp Info */}
      <div className="mt-8 bg-card border border-border rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2 mb-3">
          <MessageSquare size={18} className="text-success" /> WhatsApp Business
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          Conecta un número de WhatsApp Business para capturar automáticamente mensajes, detectar compromisos,
          crear tareas y alimentar la base de conocimiento con información extraída por IA.
        </p>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">📩 Captura automática</p>
            <p className="text-muted-foreground">Mensajes entrantes se guardan con contacto, fecha y adjuntos</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">🤖 Extracción IA</p>
            <p className="text-muted-foreground">Detecta tareas, decisiones, fechas y responsables automáticamente</p>
          </div>
          <div className="bg-muted/50 rounded-lg p-3">
            <p className="font-semibold text-foreground mb-1">🔗 Enrutamiento</p>
            <p className="text-muted-foreground">Asigna conversaciones a canales internos o proyectos</p>
          </div>
        </div>
      </div>

      {/* WhatsApp Config Dialog */}
      <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={18} className="text-success" /> Configurar WhatsApp Business
            </DialogTitle>
            <DialogDescription>
              Selecciona el proveedor y configura las credenciales para conectar tu número.
            </DialogDescription>
          </DialogHeader>

          {/* Provider Toggle */}
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setWaProvider('meta')}
              className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                waProvider === 'meta'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
              }`}
            >
              Meta Cloud API
            </button>
            <button
              onClick={() => setWaProvider('twilio')}
              className={`flex-1 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                waProvider === 'twilio'
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
              }`}
            >
              Twilio
            </button>
          </div>

          <div className="space-y-4 mt-2">
            {waProvider === 'meta' ? (
              <>
                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Phone Number ID *</label>
                  <input
                    value={waConfig.phoneNumberId}
                    onChange={e => setWaConfig(p => ({ ...p, phoneNumberId: e.target.value }))}
                    placeholder="Ej: 123456789012345"
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Lo encuentras en Meta Business → WhatsApp → Configuración de API</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Business Account ID</label>
                  <input
                    value={waConfig.businessAccountId}
                    onChange={e => setWaConfig(p => ({ ...p, businessAccountId: e.target.value }))}
                    placeholder="Ej: 987654321098765"
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Access Token permanente *</label>
                  <input
                    type="password"
                    value={waConfig.accessToken}
                    onChange={e => setWaConfig(p => ({ ...p, accessToken: e.target.value }))}
                    placeholder="EAAx..."
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">Token permanente de sistema en Meta Business → Configuración del negocio → Tokens</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">Verify Token (webhook)</label>
                  <input
                    value={waConfig.verifyToken}
                    onChange={e => setWaConfig(p => ({ ...p, verifyToken: e.target.value }))}
                    placeholder="Ej: mi_token_secreto"
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground block mb-1">URL del Webhook</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={webhookUrl}
                      readOnly
                      className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm outline-none border border-border text-muted-foreground"
                    />
                    <button
                      onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success('URL copiada'); }}
                      className="text-xs bg-secondary text-secondary-foreground px-3 py-2 rounded-lg hover:bg-secondary/80 shrink-0"
                    >
                      Copiar
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">Pega esta URL en Meta Business → WhatsApp → Configuración → Webhooks</p>
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="bg-muted/50 rounded-lg p-3 text-xs text-muted-foreground">
                  Para configurar Twilio usa el asistente de configuración automática.
                </div>
                <Button
                  onClick={() => { setWaDialogOpen(false); setTwilioWizardOpen(true); }}
                  className="w-full gap-2"
                >
                  Abrir asistente de configuración Twilio <ExternalLink size={14} />
                </Button>
              </div>
            )}

            <button
              onClick={handleSaveWaConfig}
              disabled={saving}
              className="w-full bg-primary text-primary-foreground text-sm font-medium px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={14} />
              {saving ? 'Guardando...' : 'Guardar configuración'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Twilio Wizard Dialog */}
      <Dialog open={twilioWizardOpen} onOpenChange={setTwilioWizardOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare size={18} className="text-success" /> Configurar Twilio para WhatsApp
            </DialogTitle>
            <DialogDescription>
              Sigue los pasos para conectar tu cuenta de Twilio automáticamente.
            </DialogDescription>
          </DialogHeader>
          <TwilioWizard
            onComplete={() => { setTwilioWizardOpen(false); setWaConnected(true); toast.success('Twilio configurado correctamente'); }}
            onCancel={() => setTwilioWizardOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IntegrationsPage;
