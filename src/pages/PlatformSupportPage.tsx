import { useState, useEffect, useRef } from 'react';
import { Crown, Send, Loader2, HeadphonesIcon, MessageCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Msg = {
  id: string;
  body: string;
  author_role: 'tenant' | 'super_admin';
  author_id: string | null;
  created_at: string;
};

const PlatformSupportPage = () => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('platform-support', { body: { action: 'get_my_channel' } });
    if (error) toast.error('Error al cargar');
    else {
      setChannelId(data?.channel?.id ?? null);
      setMessages(data?.messages ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!channelId) return;
    const ch = supabase.channel('platform_support_' + channelId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_support_messages', filter: `channel_id=eq.${channelId}` },
        (payload) => setMessages(m => [...m, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim()) return;
    setSending(true);
    const { error } = await supabase.functions.invoke('platform-support', {
      body: { action: 'send_message', body: text },
    });
    if (error) toast.error('Error al enviar');
    else setText('');
    setSending(false);
  };

  return (
    <div className="h-full flex flex-col bg-background pb-24">
      <div className="px-4 pt-6 pb-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HeadphonesIcon size={22} className="text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold flex items-center gap-2">Soporte de la plataforma <Crown size={14} className="text-amber-500" /></h1>
            <p className="text-xs text-muted-foreground">Canal directo con el equipo Super Admin</p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="text-center py-10"><Loader2 className="animate-spin inline text-primary" /></div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <MessageCircle size={40} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm">Este es tu canal privado con el equipo Super Admin.</p>
            <p className="text-xs mt-1">Escribe tu primer mensaje: dudas, reportes o solicitudes de la plataforma.</p>
          </div>
        ) : messages.map(m => {
          const mine = m.author_role === 'tenant';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                {!mine && <div className="text-[10px] font-semibold text-amber-600 mb-0.5 flex items-center gap-1"><Crown size={10} /> Super Admin</div>}
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                <div className={`text-[10px] mt-1 opacity-70`}>{new Date(m.created_at).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 bg-card">
        <div className="flex gap-2 items-end">
          <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un mensaje al equipo de la plataforma..." className="flex-1 min-h-[52px] resize-none rounded-2xl" />
          <Button onClick={send} disabled={!text.trim() || sending} size="icon" className="h-11 w-11 shrink-0 rounded-full">
            {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PlatformSupportPage;
