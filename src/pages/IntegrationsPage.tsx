import { Plug, MessageSquare, CalendarDays, Brain, Shield, ExternalLink, CheckCircle2, Circle } from 'lucide-react';

const integrations = [
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

const IntegrationsPage = () => {
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
            <button className={`text-xs font-medium px-4 py-2 rounded-lg flex items-center gap-1.5 transition-colors ${
              int.connected ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' : 'bg-primary text-primary-foreground hover:opacity-90'
            }`}>
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
    </div>
  );
};

export default IntegrationsPage;
