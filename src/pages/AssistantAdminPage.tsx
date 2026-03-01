import { useState, useEffect } from 'react';
import { Bot, Settings2, MessageSquare, BarChart3, Save, Loader2, Trash2, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';

const AssistantAdminPage = () => {
  const { user, userRole } = useAuth();
  const [activeTab, setActiveTab] = useState<'settings' | 'conversations' | 'metrics'>('settings');
  const [loading, setLoading] = useState(true);

  // Settings state
  const [autonomyLevel, setAutonomyLevel] = useState('guided');
  const [autoExecute, setAutoExecute] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [customInstructions, setCustomInstructions] = useState('');
  const [saving, setSaving] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Conversations state
  const [conversations, setConversations] = useState<any[]>([]);
  const [expandedConv, setExpandedConv] = useState<string | null>(null);
  const [convMessages, setConvMessages] = useState<any[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  // Metrics
  const [metrics, setMetrics] = useState({ totalConvs: 0, totalMessages: 0, activeUsers: 0 });

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      try {
        const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', user.id).maybeSingle();
        if (!profile) return;
        setTenantId(profile.tenant_id);

        const { data: settings } = await supabase
          .from('assistant_settings' as any)
          .select('*')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        if (settings) {
          setAutonomyLevel((settings as any).autonomy_level || 'guided');
          setAutoExecute((settings as any).auto_execute || false);
          setEnabled((settings as any).enabled ?? true);
          setCustomInstructions((settings as any).custom_instructions || '');
        }

        // Load conversations
        const { data: convs } = await supabase
          .from('assistant_conversations' as any)
          .select('id, user_id, title, created_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(50);
        setConversations(convs || []);

        // Metrics
        const totalConvs = (convs || []).length;
        const { count: msgCount } = await supabase
          .from('assistant_messages' as any)
          .select('id', { count: 'exact', head: true });
        const activeUsers = new Set((convs || []).map((c: any) => c.user_id)).size;
        setMetrics({ totalConvs, totalMessages: msgCount || 0, activeUsers });
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const handleSaveSettings = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      const payload = {
        tenant_id: tenantId,
        autonomy_level: autonomyLevel,
        auto_execute: autoExecute,
        enabled,
        custom_instructions: customInstructions,
      };
      const { error } = await supabase.from('assistant_settings' as any).upsert(payload, { onConflict: 'tenant_id' });
      if (error) throw error;
      toast.success('Configuración del asistente guardada');
    } catch (err: any) {
      toast.error(err.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const handleExpandConversation = async (convId: string) => {
    if (expandedConv === convId) {
      setExpandedConv(null);
      return;
    }
    setLoadingMessages(true);
    setExpandedConv(convId);
    try {
      const { data } = await supabase
        .from('assistant_messages' as any)
        .select('id, role, content, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });
      setConvMessages(data || []);
    } finally {
      setLoadingMessages(false);
    }
  };

  const isAdmin = userRole === 'super_admin' || userRole === 'owner' || userRole === 'admin';

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">No tienes permisos para acceder a esta sección.</p>
      </div>
    );
  }

  const inputClass = "w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground";

  const tabs = [
    { id: 'settings', label: 'Configuración', icon: Settings2 },
    { id: 'conversations', label: 'Conversaciones', icon: MessageSquare },
    { id: 'metrics', label: 'Métricas', icon: BarChart3 },
  ] as const;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bot size={22} className="text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground">Administración del Asistente IA</h1>
          <p className="text-xs text-muted-foreground">Configura, monitorea y entrena a Aria</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Settings Tab */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-2xl">
              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">General</h3>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Asistente habilitado</p>
                    <p className="text-xs text-muted-foreground">Muestra el widget de Aria para todos los usuarios</p>
                  </div>
                  <button
                    onClick={() => setEnabled(!enabled)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${enabled ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-transform ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Nivel de autonomía</label>
                  <select
                    value={autonomyLevel}
                    onChange={e => setAutonomyLevel(e.target.value)}
                    className={inputClass}
                  >
                    <option value="guided">Guiado — Solo sugiere, nunca ejecuta</option>
                    <option value="assisted">Asistido — Sugiere y pide confirmación</option>
                    <option value="autonomous">Autónomo — Puede ejecutar con confirmación rápida</option>
                  </select>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">Ejecución automática de tareas</p>
                    <p className="text-xs text-muted-foreground">Permite al asistente ejecutar acciones tras confirmación</p>
                  </div>
                  <button
                    onClick={() => setAutoExecute(!autoExecute)}
                    className={`w-11 h-6 rounded-full transition-colors relative ${autoExecute ? 'bg-primary' : 'bg-muted'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-card shadow-sm transition-transform ${autoExecute ? 'left-[22px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Instrucciones personalizadas</h3>
                <p className="text-xs text-muted-foreground">Agrega contexto específico de tu empresa para que Aria dé respuestas más relevantes.</p>
                <textarea
                  value={customInstructions}
                  onChange={e => setCustomInstructions(e.target.value)}
                  className={`${inputClass} min-h-[120px]`}
                  placeholder="Ej: Somos una clínica dental en CDMX. Nuestros servicios principales son limpieza, ortodoncia y blanqueamiento. Horario: L-V 9am-7pm, S 9am-2pm."
                  maxLength={2000}
                />
                <p className="text-[10px] text-muted-foreground text-right">{customInstructions.length}/2000</p>
              </div>

              <button
                onClick={handleSaveSettings}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                Guardar configuración
              </button>
            </div>
          )}

          {/* Conversations Tab */}
          {activeTab === 'conversations' && (
            <div className="space-y-2">
              {conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">No hay conversaciones aún.</p>
              ) : (
                conversations.map(conv => (
                  <div key={conv.id} className="bg-card border border-border rounded-xl overflow-hidden">
                    <button
                      onClick={() => handleExpandConversation(conv.id)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-secondary/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <MessageSquare size={16} className="text-muted-foreground shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{conv.title}</p>
                          <p className="text-[10px] text-muted-foreground">
                            {new Date(conv.created_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      {expandedConv === conv.id ? <ChevronUp size={16} className="text-muted-foreground" /> : <ChevronDown size={16} className="text-muted-foreground" />}
                    </button>
                    {expandedConv === conv.id && (
                      <div className="border-t border-border px-4 py-3 space-y-3 max-h-80 overflow-y-auto scrollbar-thin bg-secondary/30">
                        {loadingMessages ? (
                          <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
                        ) : convMessages.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center">Sin mensajes</p>
                        ) : (
                          convMessages.map(msg => (
                            <div key={msg.id} className={`text-xs ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                              <span className={`inline-block px-3 py-2 rounded-xl max-w-[90%] ${
                                msg.role === 'user' ? 'bg-primary/10 text-foreground' : 'bg-card text-foreground border border-border'
                              }`}>
                                {msg.role === 'user' ? msg.content : (
                                  <div className="prose prose-xs max-w-none [&_p]:my-0.5">
                                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                                  </div>
                                )}
                              </span>
                              <p className="text-[9px] text-muted-foreground mt-0.5">
                                {msg.role === 'user' ? '👤 Usuario' : '🤖 Aria'} · {new Date(msg.created_at).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Metrics Tab */}
          {activeTab === 'metrics' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-card border border-border rounded-xl p-5 text-center">
                <p className="text-3xl font-bold text-primary">{metrics.totalConvs}</p>
                <p className="text-xs text-muted-foreground mt-1">Conversaciones totales</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-5 text-center">
                <p className="text-3xl font-bold text-primary">{metrics.totalMessages}</p>
                <p className="text-xs text-muted-foreground mt-1">Mensajes totales</p>
              </div>
              <div className="bg-card border border-border rounded-xl p-5 text-center">
                <p className="text-3xl font-bold text-primary">{metrics.activeUsers}</p>
                <p className="text-xs text-muted-foreground mt-1">Usuarios activos</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AssistantAdminPage;
