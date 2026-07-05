import { useState, useEffect, useMemo } from 'react';
import { LifeBuoy, Plus, AlertTriangle, Clock, CheckCircle2, XCircle, Crown, Loader2, Send, MessageSquare, Phone, User, ArrowLeft, Filter, Mail, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanFeatures } from '@/hooks/usePlanFeatures';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

type Ticket = {
  id: string;
  subject: string;
  description: string | null;
  priority: 'urgent' | 'high' | 'normal' | 'low';
  status: 'open' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  channel: string;
  created_at: string;
  first_response_at: string | null;
  sla_first_response_at: string | null;
  sla_resolution_at: string | null;
  ai_summary: string | null;
  contacts?: { id: string; name: string; phone: string; is_vip?: boolean; vip_tier?: string | null } | null;
};

type TicketMessage = {
  id: string;
  body: string;
  is_internal_note: boolean;
  author_type: string;
  author_id: string | null;
  created_at: string;
};

const priorityCfg: Record<string, { label: string; cls: string; dot: string }> = {
  urgent: { label: 'Urgente', cls: 'bg-red-500/10 text-red-600 border-red-200', dot: 'bg-red-500' },
  high: { label: 'Alta', cls: 'bg-orange-500/10 text-orange-600 border-orange-200', dot: 'bg-orange-500' },
  normal: { label: 'Normal', cls: 'bg-blue-500/10 text-blue-600 border-blue-200', dot: 'bg-blue-500' },
  low: { label: 'Baja', cls: 'bg-gray-400/10 text-gray-600 border-gray-200', dot: 'bg-gray-400' },
};

const statusCfg: Record<string, { label: string; cls: string; icon: any }> = {
  open: { label: 'Abierto', cls: 'bg-amber-500/10 text-amber-700', icon: AlertTriangle },
  assigned: { label: 'Asignado', cls: 'bg-blue-500/10 text-blue-700', icon: User },
  in_progress: { label: 'En proceso', cls: 'bg-indigo-500/10 text-indigo-700', icon: Clock },
  waiting_customer: { label: 'Esperando cliente', cls: 'bg-purple-500/10 text-purple-700', icon: Clock },
  resolved: { label: 'Resuelto', cls: 'bg-emerald-500/10 text-emerald-700', icon: CheckCircle2 },
  closed: { label: 'Cerrado', cls: 'bg-gray-400/10 text-gray-600', icon: XCircle },
};

const channelIcon: Record<string, any> = {
  whatsapp: MessageSquare, voice: Phone, internal_chat: MessageSquare, manual: LifeBuoy,
};

function formatRelative(iso: string | null) {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 60) return `${mins}m ${diff < 0 ? 'atrás' : 'restante'}`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ${diff < 0 ? 'atrás' : 'restante'}`;
  const days = Math.round(hrs / 24);
  return `${days}d ${diff < 0 ? 'atrás' : 'restante'}`;
}

const SupportPage = () => {
  const { user } = useAuth();
  const { supportLevel, planName } = usePlanFeatures();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sending, setSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [newTicket, setNewTicket] = useState({ subject: '', description: '', priority: 'normal' });

  // ===== Email to support form =====
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailForm, setEmailForm] = useState({
    subject: '',
    message: '',
    priority: 'normal',
    contact_email: user?.email ?? '',
  });

  useEffect(() => {
    if (user?.email && !emailForm.contact_email) {
      setEmailForm(f => ({ ...f, contact_email: user.email ?? '' }));
    }
  }, [user?.email]);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke('support-ticket-manager', { body: { action: 'list' } });
    if (error) toast.error('Error al cargar tickets');
    else setTickets(data?.tickets ?? []);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel('support_tickets_watch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_tickets' }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const openTicket = async (t: Ticket) => {
    setSelected(t);
    setMsgLoading(true);
    const { data } = await supabase.functions.invoke('support-ticket-manager', { body: { action: 'get', ticket_id: t.id } });
    setMessages(data?.messages ?? []);
    if (data?.ticket) setSelected(data.ticket);
    setMsgLoading(false);
  };

  const sendReply = async () => {
    if (!reply.trim() || !selected) return;
    setSending(true);
    const { data, error } = await supabase.functions.invoke('support-ticket-manager', {
      body: { action: 'add_message', ticket_id: selected.id, body: reply, is_internal_note: isInternal },
    });
    if (error) toast.error('Error al enviar');
    else {
      setMessages(m => [...m, data.message]);
      setReply('');
      load();
    }
    setSending(false);
  };

  const updateTicket = async (patch: Partial<Ticket>) => {
    if (!selected) return;
    const { data, error } = await supabase.functions.invoke('support-ticket-manager', {
      body: { action: 'update', ticket_id: selected.id, ...patch },
    });
    if (error) toast.error('Error al actualizar');
    else {
      setSelected(data.ticket);
      load();
    }
  };

  const createTicket = async () => {
    if (!newTicket.subject.trim()) return;
    const { error } = await supabase.functions.invoke('support-ticket-manager', {
      body: { action: 'create', ...newTicket, channel: 'manual' },
    });
    if (error) toast.error('Error al crear');
    else {
      toast.success('Ticket creado');
      setCreateOpen(false);
      setNewTicket({ subject: '', description: '', priority: 'normal' });
      load();
    }
  };

  const sendSupportEmail = async () => {
    if (!emailForm.subject.trim() || !emailForm.message.trim()) {
      toast.error('Asunto y mensaje son obligatorios');
      return;
    }
    setEmailSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-support-email', {
        body: {
          subject: emailForm.subject,
          message: emailForm.message,
          priority: emailForm.priority,
          contact_email: emailForm.contact_email,
        },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Error');
      toast.success(`Ticket #${data.ticket_number || data.ticket_id?.slice(0, 8)} creado — te contactaremos por correo`);
      setEmailOpen(false);
      setEmailForm({ subject: '', message: '', priority: 'normal', contact_email: user?.email ?? '' });
      load();
    } catch (err: any) {
      toast.error(err.message || 'No se pudo enviar el correo');
    } finally {
      setEmailSending(false);
    }
  };

  const filtered = useMemo(() => {
    const pOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    return tickets
      .filter(t => filterPriority === 'all' || t.priority === filterPriority)
      .filter(t => filterStatus === 'all' || t.status === filterStatus)
      .sort((a, b) => (pOrder[a.priority] ?? 9) - (pOrder[b.priority] ?? 9) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [tickets, filterPriority, filterStatus]);

  const openCount = tickets.filter(t => !['resolved', 'closed'].includes(t.status)).length;
  const urgentCount = tickets.filter(t => t.priority === 'urgent' && !['resolved', 'closed'].includes(t.status)).length;

  if (selected) {
    const StIcon = statusCfg[selected.status]?.icon ?? AlertTriangle;
    return (
      <div className="h-full flex flex-col bg-background pb-24">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 bg-card/50">
          <Button size="icon" variant="ghost" onClick={() => setSelected(null)}><ArrowLeft size={18} /></Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base truncate">{selected.subject}</h1>
              {selected.contacts?.is_vip && (
                <Badge className="bg-amber-100 text-amber-700 border border-amber-300"><Crown size={10} className="mr-1" />VIP</Badge>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span>{selected.contacts?.name || 'Sin contacto'}</span>
              {selected.contacts?.phone && <span>· {selected.contacts.phone}</span>}
              <span>· {selected.channel}</span>
            </div>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-border bg-card/30 flex flex-wrap gap-2 items-center">
          <Select value={selected.priority} onValueChange={(v) => updateTicket({ priority: v as any })}>
            <SelectTrigger className="w-32 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(priorityCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={selected.status} onValueChange={(v) => updateTicket({ status: v as any })}>
            <SelectTrigger className="w-40 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(statusCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <div className="text-xs text-muted-foreground ml-auto">
            SLA respuesta: <span className={selected.first_response_at ? 'text-emerald-600' : 'text-amber-600 font-medium'}>{formatRelative(selected.sla_first_response_at)}</span>
          </div>
        </div>

        {selected.description && (
          <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border bg-muted/20">{selected.description}</div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {msgLoading ? <div className="text-center text-muted-foreground py-8"><Loader2 className="animate-spin inline mr-2" size={16} /> Cargando...</div> :
            messages.length === 0 ? <div className="text-center text-sm text-muted-foreground py-8">Sin mensajes aún. Escribe la primera respuesta.</div> :
            messages.map(m => (
              <div key={m.id} className={`rounded-2xl px-4 py-3 max-w-[85%] ${m.is_internal_note ? 'bg-amber-50 border border-amber-200 self-start' : 'bg-primary/10 self-end ml-auto'}`}>
                {m.is_internal_note && <div className="text-[10px] font-semibold text-amber-700 uppercase mb-1">Nota interna</div>}
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                <div className="text-[10px] text-muted-foreground mt-1">{new Date(m.created_at).toLocaleString('es-MX')}</div>
              </div>
            ))
          }
        </div>

        <div className="border-t border-border p-3 bg-card">
          <div className="flex items-center gap-2 mb-2">
            <button onClick={() => setIsInternal(!isInternal)} className={`text-xs px-2 py-1 rounded-lg transition-colors ${isInternal ? 'bg-amber-100 text-amber-700 border border-amber-300' : 'bg-muted text-muted-foreground'}`}>
              {isInternal ? '📝 Nota interna' : '💬 Respuesta al cliente'}
            </button>
          </div>
          <div className="flex gap-2 items-end">
            <Textarea value={reply} onChange={e => setReply(e.target.value)} placeholder={isInternal ? 'Nota privada para el equipo...' : 'Escribe la respuesta...'} className="flex-1 min-h-[60px] resize-none" />
            <Button onClick={sendReply} disabled={!reply.trim() || sending} size="icon" className="h-10 w-10 shrink-0">
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
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><LifeBuoy size={24} className="text-primary" /> Soporte a Clientes</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{openCount} abiertos · {urgentCount} urgentes</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} className="rounded-full"><Plus size={16} className="mr-1" /> Nuevo ticket</Button>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-40 h-9 rounded-full"><Filter size={12} className="mr-1" /><SelectValue placeholder="Prioridad" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las prioridades</SelectItem>
              {Object.entries(priorityCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-40 h-9 rounded-full"><SelectValue placeholder="Estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los estados</SelectItem>
              {Object.entries(statusCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="px-4 space-y-3">
        {loading ? (
          <div className="text-center py-12"><Loader2 className="animate-spin inline text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <LifeBuoy size={48} className="mx-auto opacity-30 mb-3" />
            <p className="text-sm">No hay tickets todavía.</p>
          </div>
        ) : filtered.map(t => {
          const p = priorityCfg[t.priority];
          const s = statusCfg[t.status];
          const CIcon = channelIcon[t.channel] ?? LifeBuoy;
          return (
            <button key={t.id} onClick={() => openTicket(t)} className="w-full text-left bg-card border border-border rounded-2xl p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${p.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-sm truncate">{t.subject}</h3>
                    {t.contacts?.is_vip && <Crown size={12} className="text-amber-500 shrink-0" />}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
                    <CIcon size={12} />
                    <span>{t.contacts?.name || 'Sin contacto'}</span>
                    <span>·</span>
                    <span>{new Date(t.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge className={p.cls + ' border'}>{p.label}</Badge>
                  <Badge className={s.cls}>{s.label}</Badge>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo ticket de soporte</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Asunto" value={newTicket.subject} onChange={e => setNewTicket({ ...newTicket, subject: e.target.value })} />
            <Textarea placeholder="Descripción del problema" value={newTicket.description} onChange={e => setNewTicket({ ...newTicket, description: e.target.value })} />
            <Select value={newTicket.priority} onValueChange={v => setNewTicket({ ...newTicket, priority: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(priorityCfg).map(([k, v]) => (<SelectItem key={k} value={k}>{v.label}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={createTicket} disabled={!newTicket.subject.trim()}>Crear</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default SupportPage;
