import { useEffect, useState } from 'react';
import { Voicemail, Phone, User, CheckCircle2, Trash2, Clock, RefreshCw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type AbsenceMessage = {
  id: string;
  tenant_id: string;
  call_record_id: string | null;
  call_sid: string | null;
  target_user_id: string | null;
  target_name: string | null;
  target_phone: string | null;
  caller_phone: string | null;
  caller_name: string | null;
  contact_id: string | null;
  message: string;
  callback_requested: boolean;
  handled_at: string | null;
  handled_by: string | null;
  expires_at: string;
  created_at: string;
  deleted_at: string | null;
};

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('es-MX', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

const hoursUntil = (iso: string) => {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return 'expirado';
  const h = Math.floor(diff / 36e5);
  const m = Math.floor((diff % 36e5) / 6e4);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const AbsenceMessagesPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AbsenceMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'handled' | 'all'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchMessages = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('absence_messages')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error('Error al cargar mensajes');
      console.error(error);
    } else {
      setMessages((data || []) as AbsenceMessage[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    fetchMessages();
    const channel = supabase
      .channel('absence-messages-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'absence_messages' }, () => {
        fetchMessages();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const markHandled = async (m: AbsenceMessage) => {
    setBusyId(m.id);
    const { error } = await supabase
      .from('absence_messages')
      .update({ handled_at: new Date().toISOString(), handled_by: user?.id ?? null })
      .eq('id', m.id);
    setBusyId(null);
    if (error) {
      toast.error('No se pudo marcar como atendido');
    } else {
      toast.success('Marcado como atendido');
      fetchMessages();
    }
  };

  const softDelete = async (m: AbsenceMessage) => {
    if (!confirm('¿Eliminar este mensaje?')) return;
    setBusyId(m.id);
    // Soft-delete via UPDATE (RLS permits tenant members to UPDATE their rows;
    // DELETE is service_role-only). The hourly pg_cron purge removes stale rows.
    const { error } = await supabase
      .from('absence_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', m.id);
    setBusyId(null);
    if (error) {
      toast.error('No se pudo eliminar');
    } else {
      toast.success('Mensaje eliminado');
      setMessages(prev => prev.filter(x => x.id !== m.id));
    }
  };

  const filtered = messages.filter(m => {
    if (tab === 'pending') return !m.handled_at;
    if (tab === 'handled') return !!m.handled_at;
    return true;
  });

  const counts = {
    pending: messages.filter(m => !m.handled_at).length,
    handled: messages.filter(m => !!m.handled_at).length,
    all: messages.length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Voicemail className="text-[var(--rx-brand)]" size={22} />
          </div>
          <div>
            <h1 className="rx-page-title">Mensajes por Ausencia</h1>
            <p className="text-sm text-[var(--rx-t2)]">
              Mensajes dejados por clientes cuando el personal no contestó una transferencia. Se eliminan automáticamente a las 24 horas.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="pending">Pendientes ({counts.pending})</TabsTrigger>
          <TabsTrigger value="handled">Atendidos ({counts.handled})</TabsTrigger>
          <TabsTrigger value="all">Todos ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-[var(--rx-t2)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[var(--rx-t2)]">
          <Voicemail className="mx-auto mb-3 opacity-40" size={40} />
          <p>No hay mensajes por ausencia.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-[var(--rx-b1)] bg-[var(--rx-s1)] p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="p-2 rounded-lg bg-primary/10 shrink-0">
                    <Voicemail size={18} className="text-[var(--rx-brand)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">
                        {m.caller_name || m.caller_phone || 'Cliente desconocido'}
                      </span>
                      {m.caller_phone && (
                        <a
                          href={`tel:${m.caller_phone}`}
                          className="text-xs text-[var(--rx-brand)] inline-flex items-center gap-1 hover:underline"
                        >
                          <Phone size={12} /> {m.caller_phone}
                        </a>
                      )}
                      {m.handled_at ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                          Atendido
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-200">
                          Pendiente
                        </Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--rx-t2)] flex items-center gap-3 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <User size={12} /> Para: {m.target_name || 'Personal'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> {fmt(m.created_at)}
                      </span>
                      {!m.handled_at && (
                        <span className="inline-flex items-center gap-1 text-[var(--rx-t2)]">
                          Expira en {hoursUntil(m.expires_at)}
                        </span>
                      )}
                    </div>
                    <p className="mt-3 text-sm whitespace-pre-wrap break-words">
                      {m.message}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!m.handled_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === m.id}
                      onClick={() => markHandled(m)}
                    >
                      <CheckCircle2 size={14} className="mr-1" /> Marcar atendido
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === m.id}
                    onClick={() => softDelete(m)}
                    className="text-[var(--rx-rose)] hover:bg-destructive/10"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AbsenceMessagesPage;
