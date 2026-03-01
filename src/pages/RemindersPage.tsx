import { useState, useEffect } from 'react';
import { Bell, Clock, CheckCircle, XCircle, RefreshCw, Send, Loader2, Phone, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

type Reminder = {
  id: string;
  message: string;
  remind_at: string;
  status: string;
  created_at: string;
  sent_at: string | null;
  source: string | null;
  retry_count?: number;
  max_retries?: number;
  error_message?: string | null;
  timezone?: string;
};

const statusConfig: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Pendiente', color: 'bg-amber-500/10 text-amber-600 border-amber-200', icon: Clock },
  sent: { label: 'Enviado', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-200', icon: CheckCircle },
  failed: { label: 'Fallido', color: 'bg-destructive/10 text-destructive border-destructive/20', icon: XCircle },
  no_phone: { label: 'Sin teléfono', color: 'bg-muted text-muted-foreground border-border', icon: Phone },
};

const RemindersPage = () => {
  const { user } = useAuth();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState<string | null>(null);
  const [tab, setTab] = useState('all');

  const fetchReminders = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .order('remind_at', { ascending: false })
      .limit(100);

    if (error) {
      toast.error('Error al cargar recordatorios');
    } else {
      setReminders((data || []) as Reminder[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReminders();

    // Realtime subscription
    const channel = supabase
      .channel('reminders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => {
        fetchReminders();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user]);

  const handleResend = async (reminder: Reminder) => {
    setResending(reminder.id);
    try {
      // Reset to pending so the cron picks it up
      const { error } = await supabase
        .from('reminders')
        .update({ 
          status: 'pending', 
          retry_count: 0, 
          error_message: null, 
          remind_at: new Date().toISOString(), // Set to now for immediate send
        })
        .eq('id', reminder.id);

      if (error) throw error;
      toast.success('Recordatorio reprogramado para envío inmediato');
      fetchReminders();
    } catch {
      toast.error('Error al reprogramar');
    }
    setResending(null);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('reminders').delete().eq('id', id);
    if (error) {
      toast.error('Error al eliminar');
    } else {
      toast.success('Recordatorio eliminado');
      setReminders(prev => prev.filter(r => r.id !== id));
    }
  };

  const filtered = tab === 'all' ? reminders : reminders.filter(r => r.status === tab);

  const counts = {
    all: reminders.length,
    pending: reminders.filter(r => r.status === 'pending').length,
    sent: reminders.filter(r => r.status === 'sent').length,
    failed: reminders.filter(r => r.status === 'failed' || r.status === 'no_phone').length,
  };

  const formatDate = (iso: string, tz?: string) => {
    try {
      return new Date(iso).toLocaleString('es-MX', {
        weekday: 'short', day: 'numeric', month: 'short',
        hour: '2-digit', minute: '2-digit',
        timeZone: tz || 'America/Mexico_City',
      });
    } catch {
      return new Date(iso).toLocaleString('es-MX');
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Bell className="text-primary" size={22} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Recordatorios</h1>
            <p className="text-sm text-muted-foreground">Gestiona los recordatorios programados vía WhatsApp</p>
          </div>
        </div>
        <button
          onClick={fetchReminders}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', count: counts.all, color: 'text-foreground' },
          { label: 'Pendientes', count: counts.pending, color: 'text-amber-600' },
          { label: 'Enviados', count: counts.sent, color: 'text-emerald-600' },
          { label: 'Fallidos', count: counts.failed, color: 'text-destructive' },
        ].map(s => (
          <div key={s.label} className="bg-card border border-border rounded-xl p-4">
            <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
          </div>
        ))}
      </div>

      {/* Tabs + List */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="all">Todos ({counts.all})</TabsTrigger>
          <TabsTrigger value="pending">Pendientes ({counts.pending})</TabsTrigger>
          <TabsTrigger value="sent">Enviados ({counts.sent})</TabsTrigger>
          <TabsTrigger value="failed">Fallidos ({counts.failed})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="animate-spin text-primary" size={24} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Bell size={40} className="mx-auto mb-3 opacity-30" />
              <p>No hay recordatorios {tab !== 'all' ? `con estado "${tab}"` : ''}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(r => {
                const cfg = statusConfig[r.status] || statusConfig.pending;
                const StatusIcon = cfg.icon;
                return (
                  <div key={r.id} className="bg-card border border-border rounded-xl p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start gap-3">
                      <StatusIcon size={18} className={cfg.color.split(' ')[1]} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground">{r.message}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <Badge variant="outline" className={cfg.color}>{cfg.label}</Badge>
                          <span className="text-xs text-muted-foreground">
                            📅 {formatDate(r.remind_at, r.timezone)}
                          </span>
                          {r.source && (
                            <span className="text-xs text-muted-foreground">
                              vía {r.source}
                            </span>
                          )}
                          {r.sent_at && (
                            <span className="text-xs text-emerald-600">
                              ✓ Enviado: {formatDate(r.sent_at, r.timezone)}
                            </span>
                          )}
                        </div>
                        {r.error_message && (
                          <div className="mt-2 flex items-start gap-1.5 text-xs text-destructive bg-destructive/5 rounded-md p-2">
                            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                            <span>{r.error_message}</span>
                            {(r.retry_count ?? 0) > 0 && (
                              <span className="ml-auto text-muted-foreground">
                                Intento {r.retry_count}/{r.max_retries || 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {(r.status === 'failed' || r.status === 'no_phone') && (
                          <button
                            onClick={() => handleResend(r)}
                            disabled={resending === r.id}
                            className="p-1.5 rounded-md text-primary hover:bg-primary/10 transition-colors"
                            title="Reenviar"
                          >
                            {resending === r.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(r.id)}
                          className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default RemindersPage;
