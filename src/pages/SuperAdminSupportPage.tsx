import { useState, useEffect, useRef } from 'react';
import { Crown, Send, Loader2, HeadphonesIcon, Building2, ArrowLeft, Circle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

type Channel = {
  id: string;
  tenant_id: string;
  status: string;
  priority: string;
  last_tenant_message_at: string | null;
  last_admin_message_at: string | null;
  unread_for_admin: number;
  tenants?: { id: string; name: string } | null;
};

type Msg = {
  id: string;
  body: string;
  author_role: 'tenant' | 'super_admin';
  created_at: string;
};

const SuperAdminSupportPage = () => {
  const { user } = useAuth();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadChannels = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('platform-support', { body: { action: 'list_channels' } });
    if (error) toast.error('Error');
    else setChannels(data?.channels ?? []);
    setLoading(false);
  };

  useEffect(() => { if (user) loadChannels(); }, [user]);

  useEffect(() => {
    const ch = supabase.channel('sa_support_channels')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_support_channels' }, () => loadChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_support_messages' }, () => {
        if (selected) openChannel(selected);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  const openChannel = async (c: Channel) => {
    setSelected(c);
    const { data } = await supabase.functions.invoke('platform-support', { body: { action: 'get_channel_messages', channel_id: c.id } });
    setMessages(data?.messages ?? []);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  };

  const send = async () => {
    if (!text.trim() || !selected) return;
    setSending(true);
    const { error } = await supabase.functions.invoke('platform-support', {
      body: { action: 'send_message', channel_id: selected.id, body: text },
    });
    if (error) toast.error('Error al enviar');
    else {
      setText('');
      openChannel(selected);
    }
    setSending(false);
  };

  if (selected) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card/50">
          <Button size="icon" variant="ghost" onClick={() => setSelected(null)}><ArrowLeft size={18} /></Button>
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center"><Building2 size={16} className="text-primary" /></div>
          <div>
            <h2 className="font-bold text-sm">{selected.tenants?.name || 'Tenant'}</h2>
            <p className="text-xs text-muted-foreground">Canal de soporte a la plataforma</p>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {messages.map(m => {
            const mine = m.author_role === 'super_admin';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                  <div className="text-[10px] mt-1 opacity-70">{new Date(m.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border p-3 bg-card">
          <div className="flex gap-2 items-end">
            <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Responder al tenant..." className="flex-1 min-h-[52px] resize-none rounded-2xl" />
            <Button onClick={send} disabled={!text.trim() || sending} size="icon" className="h-11 w-11 rounded-full">
              {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background pb-24">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Crown size={22} className="text-amber-500" /> Soporte a Tenants</h1>
        <p className="text-sm text-muted-foreground mt-1">Canales privados con cada tenant de la plataforma.</p>
      </div>
      <div className="px-4 space-y-2">
        {loading ? <div className="text-center py-10"><Loader2 className="animate-spin inline text-primary" /></div> :
          channels.length === 0 ? <div className="text-center py-10 text-muted-foreground text-sm">Sin canales activos.</div> :
          channels.map(c => (
            <button key={c.id} onClick={() => openChannel(c)} className="w-full text-left bg-card border border-border rounded-2xl p-4 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Building2 size={18} className="text-primary" /></div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-sm truncate">{c.tenants?.name || 'Tenant'}</h3>
                    {c.unread_for_admin > 0 && <Badge className="bg-red-500 text-white h-5 min-w-5 px-1.5 rounded-full text-[10px]">{c.unread_for_admin}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.last_tenant_message_at ? `Último mensaje: ${new Date(c.last_tenant_message_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Sin mensajes'}
                  </p>
                </div>
                <Circle size={8} className={c.status === 'open' ? 'text-emerald-500 fill-emerald-500' : 'text-gray-300 fill-gray-300'} />
              </div>
            </button>
          ))
        }
      </div>
    </div>
  );
};

export default SuperAdminSupportPage;
