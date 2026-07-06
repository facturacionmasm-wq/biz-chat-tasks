import { useState, useEffect, useRef } from 'react';
import { Crown, Send, Loader2, Building2, ArrowLeft, Circle, Ticket, MessageCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

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
  author_role?: 'tenant' | 'super_admin';
  author_type?: string;
  created_at: string;
  is_internal_note?: boolean;
};

type AdminTicket = {
  id: string;
  subject: string;
  status: string;
  priority: string;
  channel: string;
  created_at: string;
  tenant_id: string;
  tenants?: { id: string; name: string } | null;
  description?: string | null;
  created_by?: string | null;
  creator?: { name: string | null; email: string | null } | null;
};

const priorityCfg: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'Urgente', cls: 'bg-red-500/10 text-red-600 border-red-200' },
  high: { label: 'Alta', cls: 'bg-orange-500/10 text-orange-600 border-orange-200' },
  normal: { label: 'Normal', cls: 'bg-blue-500/10 text-blue-600 border-blue-200' },
  low: { label: 'Baja', cls: 'bg-gray-400/10 text-gray-600 border-gray-200' },
};

const statusCfg: Record<string, { label: string; cls: string }> = {
  open: { label: 'Abierto', cls: 'bg-amber-500/10 text-amber-700' },
  assigned: { label: 'Asignado', cls: 'bg-blue-500/10 text-blue-700' },
  in_progress: { label: 'En proceso', cls: 'bg-indigo-500/10 text-indigo-700' },
  waiting_customer: { label: 'Esperando', cls: 'bg-purple-500/10 text-purple-700' },
  resolved: { label: 'Resuelto', cls: 'bg-emerald-500/10 text-emerald-700' },
  closed: { label: 'Cerrado', cls: 'bg-gray-400/10 text-gray-600' },
};

const SuperAdminSupportPage = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'channels' | 'tickets'>('tickets');

  // ============ Channels state ============
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // ============ Tickets state ============
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketFilter, setTicketFilter] = useState<'active' | 'all' | 'closed'>('active');
  const [selectedTicket, setSelectedTicket] = useState<AdminTicket | null>(null);
  const [ticketMessages, setTicketMessages] = useState<Msg[]>([]);
  const [ticketReply, setTicketReply] = useState('');
  const [ticketInternal, setTicketInternal] = useState(false);
  const [ticketSending, setTicketSending] = useState(false);

  const loadChannels = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('platform-support', { body: { action: 'list_channels' } });
    if (error) toast.error('Error');
    else setChannels(data?.channels ?? []);
    setLoading(false);
  };

  const loadTickets = async () => {
    setTicketsLoading(true);
    const { data, error } = await supabase.functions.invoke('support-ticket-manager', { body: { action: 'admin_list' } });
    if (error) toast.error('Error al cargar tickets');
    else setTickets(data?.tickets ?? []);
    setTicketsLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadChannels();
    loadTickets();
  }, [user]);

  useEffect(() => {
    const ch = supabase.channel('sa_support_all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_support_channels' }, () => loadChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'platform_support_messages' }, () => {
        if (selected) openChannel(selected);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => loadTickets())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_messages' }, () => {
        if (selectedTicket) openTicket(selectedTicket);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selectedTicket?.id]);

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
    else { setText(''); openChannel(selected); }
    setSending(false);
  };

  const openTicket = async (t: AdminTicket) => {
    setSelectedTicket(t);
    const { data } = await supabase.functions.invoke('support-ticket-manager', { body: { action: 'admin_get', ticket_id: t.id } });
    setTicketMessages(data?.messages ?? []);
    if (data?.ticket) setSelectedTicket(data.ticket);
  };

  const sendTicketReply = async () => {
    if (!ticketReply.trim() || !selectedTicket) return;
    setTicketSending(true);
    const { error } = await supabase.functions.invoke('support-ticket-manager', {
      body: { action: 'admin_add_message', ticket_id: selectedTicket.id, body: ticketReply, is_internal_note: ticketInternal },
    });
    if (error) toast.error('Error al enviar');
    else { setTicketReply(''); openTicket(selectedTicket); loadTickets(); }
    setTicketSending(false);
  };

  const updateTicketStatus = async (status: string) => {
    if (!selectedTicket) return;
    const { data, error } = await supabase.functions.invoke('support-ticket-manager', {
      body: { action: 'admin_update', ticket_id: selectedTicket.id, status },
    });
    if (error) toast.error('Error');
    else { setSelectedTicket(data.ticket); loadTickets(); }
  };

  const filteredTickets = tickets.filter(t => {
    if (ticketFilter === 'active') return !['resolved', 'closed'].includes(t.status);
    if (ticketFilter === 'closed') return ['resolved', 'closed'].includes(t.status);
    return true;
  });

  // ========== Channel conversation view ==========
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

  // ========== Ticket conversation view ==========
  if (selectedTicket) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card/50">
          <Button size="icon" variant="ghost" onClick={() => setSelectedTicket(null)}><ArrowLeft size={18} /></Button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-sm truncate">{selectedTicket.subject}</h2>
            <p className="text-xs text-muted-foreground truncate">
              {selectedTicket.tenants?.name || 'Tenant'} · {selectedTicket.channel}
            </p>
          </div>
          <Badge className={priorityCfg[selectedTicket.priority]?.cls + ' border'}>{priorityCfg[selectedTicket.priority]?.label}</Badge>
        </div>
        <div className="px-4 py-2 border-b border-border bg-card/30 flex flex-wrap gap-2 items-center">
          <Select value={selectedTicket.status} onValueChange={updateTicketStatus}>
            <SelectTrigger className="w-44 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(statusCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
          {!['resolved', 'closed'].includes(selectedTicket.status) && (
            <>
              <Button size="sm" variant="outline" onClick={() => updateTicketStatus('resolved')} className="h-8 text-xs">
                <CheckCircle2 size={12} className="mr-1" /> Marcar resuelto
              </Button>
              <Button size="sm" variant="outline" onClick={() => updateTicketStatus('closed')} className="h-8 text-xs">
                Cerrar ticket
              </Button>
            </>
          )}
        </div>
        {selectedTicket.description && (
          <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border bg-muted/20 whitespace-pre-wrap">{selectedTicket.description}</div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
          {ticketMessages.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">Sin mensajes aún.</div>
          ) : ticketMessages.map(m => {
            const mine = m.author_type === 'super_admin';
            const isNote = m.is_internal_note;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${isNote ? 'bg-amber-50 border border-amber-200' : mine ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                  {isNote && <div className="text-[10px] font-semibold text-amber-700 uppercase mb-1">Nota interna</div>}
                  <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                  <div className="text-[10px] mt-1 opacity-70">{new Date(m.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-border p-3 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setTicketInternal(!ticketInternal)} className={`text-xs px-2 py-1 rounded-lg transition-colors ${ticketInternal ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-muted text-muted-foreground'}`}>
              {ticketInternal ? '📝 Nota interna' : '💬 Responder al tenant'}
            </button>
          </div>
          <div className="flex gap-2 items-end">
            <Textarea value={ticketReply} onChange={e => setTicketReply(e.target.value)} placeholder={ticketInternal ? 'Nota privada del equipo…' : 'Responder al tenant…'} className="flex-1 min-h-[52px] resize-none rounded-2xl" />
            <Button onClick={sendTicketReply} disabled={!ticketReply.trim() || ticketSending} size="icon" className="h-11 w-11 rounded-full">
              {ticketSending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ========== List view (tabs) ==========
  return (
    <div className="min-h-full bg-background pb-24">
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Crown size={22} className="text-amber-500" /> Soporte a Tenants</h1>
        <p className="text-sm text-muted-foreground mt-1">Tickets y canales de soporte a la plataforma.</p>
      </div>

      <div className="px-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList className="rounded-full">
            <TabsTrigger value="tickets" className="rounded-full"><Ticket size={14} className="mr-1" /> Tickets</TabsTrigger>
            <TabsTrigger value="channels" className="rounded-full"><MessageCircle size={14} className="mr-1" /> Chats directos</TabsTrigger>
          </TabsList>

          <TabsContent value="tickets" className="space-y-3 mt-4">
            <div className="flex gap-2 flex-wrap">
              <Select value={ticketFilter} onValueChange={(v) => setTicketFilter(v as any)}>
                <SelectTrigger className="w-52 h-9 rounded-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activos (sin cerrados)</SelectItem>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="closed">Resueltos/Cerrados</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground self-center ml-auto">{filteredTickets.length} tickets</div>
            </div>

            {ticketsLoading ? (
              <div className="text-center py-10"><Loader2 className="animate-spin inline text-primary" /></div>
            ) : filteredTickets.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-sm">No hay tickets en esta vista.</div>
            ) : filteredTickets.map(t => (
              <button key={t.id} onClick={() => openTicket(t)} className="w-full text-left bg-card border border-border rounded-2xl p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><AlertTriangle size={16} className="text-primary" /></div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm truncate">{t.subject}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {t.tenants?.name || 'Tenant'} · {t.channel} · {new Date(t.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge className={priorityCfg[t.priority]?.cls + ' border'}>{priorityCfg[t.priority]?.label}</Badge>
                    <Badge className={statusCfg[t.status]?.cls}>{statusCfg[t.status]?.label}</Badge>
                  </div>
                </div>
              </button>
            ))}
          </TabsContent>

          <TabsContent value="channels" className="space-y-2 mt-4">
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SuperAdminSupportPage;
