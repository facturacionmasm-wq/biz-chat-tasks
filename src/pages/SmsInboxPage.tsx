import { useEffect, useState } from 'react';
import { Inbox, Phone, CheckCircle2, Trash2, Clock, RefreshCw, Loader2, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type SmsMessage = {
  id: string;
  tenant_id: string;
  message_sid: string;
  from_e164: string;
  to_e164: string;
  body: string | null;
  num_media: number;
  read_at: string | null;
  deleted_at: string | null;
  received_at: string;
  created_at: string;
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

const SmsInboxPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchMessages = async () => {
    setLoading(true);
    // Resilience: 15s abort ceiling to prevent infinite spinners.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const { data, error } = await supabase
        .from('sms_inbound_messages')
        .select('*')
        .is('deleted_at', null)
        .order('received_at', { ascending: false })
        .limit(200)
        .abortSignal(controller.signal);
      if (error) {
        toast.error('Error al cargar SMS');
        console.error(error);
      } else {
        setMessages((data || []) as SmsMessage[]);
      }
    } catch (e) {
      console.error('[sms-inbox] fetch aborted or failed:', e);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    fetchMessages();
    const channel = supabase
      .channel('sms-inbound-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sms_inbound_messages' }, () => {
        fetchMessages();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const markRead = async (m: SmsMessage) => {
    setBusyId(m.id);
    const { error } = await supabase
      .from('sms_inbound_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('id', m.id);
    setBusyId(null);
    if (error) {
      toast.error('No se pudo marcar como leído');
    } else {
      toast.success('Marcado como leído');
      setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read_at: new Date().toISOString() } : x));
    }
  };

  const softDelete = async (m: SmsMessage) => {
    if (!confirm('¿Eliminar este SMS?')) return;
    setBusyId(m.id);
    const { error } = await supabase
      .from('sms_inbound_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', m.id);
    setBusyId(null);
    if (error) {
      toast.error('No se pudo eliminar');
    } else {
      toast.success('SMS eliminado');
      setMessages(prev => prev.filter(x => x.id !== m.id));
    }
  };

  const filtered = messages.filter(m => tab === 'unread' ? !m.read_at : true);

  const counts = {
    unread: messages.filter(m => !m.read_at).length,
    all: messages.length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 rounded-lg">
            <Inbox className="text-[var(--rx-brand)]" size={22} />
          </div>
          <div>
            <h1 className="rx-page-title">Bandeja SMS</h1>
            <p className="text-sm text-[var(--rx-t2)]">
              SMS entrantes al número Twilio de tu empresa. WhatsApp continúa en su propia bandeja.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'unread' | 'all')}>
        <TabsList>
          <TabsTrigger value="unread">No leídos ({counts.unread})</TabsTrigger>
          <TabsTrigger value="all">Todos ({counts.all})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="animate-spin text-[var(--rx-t2)]" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[var(--rx-t2)]">
          <Inbox className="mx-auto mb-3 opacity-40" size={40} />
          <p>No hay SMS.</p>
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
                    <MessageSquare size={18} className="text-[var(--rx-brand)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a
                        href={`tel:${m.from_e164}`}
                        className="font-medium text-[var(--rx-brand)] inline-flex items-center gap-1 hover:underline"
                      >
                        <Phone size={12} /> {m.from_e164}
                      </a>
                      {m.read_at ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-200">
                          Leído
                        </Badge>
                      ) : (
                        <Badge className="bg-amber-500/10 text-amber-600 border-amber-200">
                          Nuevo
                        </Badge>
                      )}
                      {m.num_media > 0 && (
                        <Badge variant="outline">{m.num_media} adjunto{m.num_media > 1 ? 's' : ''}</Badge>
                      )}
                    </div>
                    <div className="mt-1 text-xs text-[var(--rx-t2)] flex items-center gap-3 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={12} /> {fmt(m.received_at)}
                      </span>
                      <span className="text-[var(--rx-t2)]">Para: {m.to_e164}</span>
                    </div>
                    <p className="mt-3 text-sm whitespace-pre-wrap break-words">
                      {m.body || <span className="text-[var(--rx-t2)] italic">(sin cuerpo)</span>}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!m.read_at && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === m.id}
                      onClick={() => markRead(m)}
                    >
                      <CheckCircle2 size={14} className="mr-1" /> Marcar leído
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

export default SmsInboxPage;
