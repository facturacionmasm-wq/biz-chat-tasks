import { useState, useEffect, useRef } from 'react';
import { MessageSquare, Search, Send, Paperclip, StickyNote, Phone, CalendarPlus, Circle, CheckCircle2, AlertCircle, Plus, Loader2, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useWhatsAppData, type DBConversation, type DBMessage } from '@/hooks/useWhatsAppData';
import { useIsMobile } from '@/hooks/use-mobile';
import { usePaymentGate } from '@/hooks/usePaymentGate';
import PaymentGateCard from '@/components/PaymentGateCard';

const statusColors: Record<string, string> = {
  open: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  closed: 'bg-muted text-muted-foreground',
};

const statusLabels: Record<string, string> = {
  open: 'Abierto',
  pending: 'Pendiente',
  closed: 'Cerrado',
};

const WhatsAppInboxPage = () => {
  const { conversations, messages, loading, fetchMessages, DEMO_TENANT } = useWhatsAppData();
  const { canUseService, loading: paymentLoading, redirecting, purchasePackage } = usePaymentGate();
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvName, setNewConvName] = useState('');
  const [newConvPhone, setNewConvPhone] = useState('');
  const [newConvMessage, setNewConvMessage] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!selectedConvId && conversations.length > 0 && !isMobile) {
      setSelectedConvId(conversations[0].id);
    }
  }, [conversations, selectedConvId, isMobile]);

  useEffect(() => {
    if (selectedConvId) fetchMessages(selectedConvId);
  }, [selectedConvId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const convMessages = messages.filter(m => m.conversation_id === selectedConvId);

  const handleSendMessage = async () => {
    if (!messageInput.trim() || !selectedConvId) return;
    const body = messageInput.trim();
    setMessageInput('');
    setSending(true);
    try {
      const selectedConv = conversations.find(c => c.id === selectedConvId);
      const { data, error } = await supabase.functions.invoke('twilio-send', {
        body: { to: selectedConv?.contact_phone, body, conversationId: selectedConvId, tenantId: selectedConv?.tenant_id || DEMO_TENANT },
      });
      if (error) throw error;
      if (data && !data.ok) throw new Error(data.error || 'Error al enviar');
      await fetchMessages(selectedConvId);
    } catch (err: any) {
      toast.error(err.message || 'Error al enviar mensaje');
      setMessageInput(body);
    } finally {
      setSending(false);
    }
  };

  const handleCreateConversation = async () => {
    if (!newConvName.trim() || !newConvPhone.trim()) return;
    try {
      const { data: newConv, error } = await supabase.from('whatsapp_conversations').insert({
        tenant_id: DEMO_TENANT, contact_phone: newConvPhone.trim(), contact_name: newConvName.trim(), status: 'open', last_message_at: new Date().toISOString(),
      }).select('id').single();
      if (error) throw error;
      if (newConv && newConvMessage.trim()) {
        await supabase.from('whatsapp_messages').insert({ tenant_id: DEMO_TENANT, conversation_id: newConv.id, direction: 'out', body: newConvMessage.trim(), status: 'sent' });
      }
      if (newConv) setSelectedConvId(newConv.id);
      setShowNewConv(false); setNewConvName(''); setNewConvPhone(''); setNewConvMessage('');
      toast.success('Conversación creada');
    } catch { toast.error('Error al crear conversación'); }
  };

  const handleCloseConversation = async () => { if (!selectedConvId) return; await supabase.from('whatsapp_conversations').update({ status: 'closed' }).eq('id', selectedConvId); };
  const handleReopenConversation = async () => { if (!selectedConvId) return; await supabase.from('whatsapp_conversations').update({ status: 'open' }).eq('id', selectedConvId); };

  const filtered = conversations.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!searchQuery || (c.contact_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || c.contact_phone.includes(searchQuery))
  );

  const selectedConv = conversations.find(c => c.id === selectedConvId);

  if (paymentLoading || loading) {
    return (<div className="flex h-full items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>);
  }

  if (!canUseService('whatsapp')) {
    return (
      <PaymentGateCard
        serviceName="WhatsApp Business Bot"
        serviceType="whatsapp"
        onPurchasePackage={purchasePackage}
        redirecting={redirecting}
      />
    );
  }

  const showChatView = selectedConvId && selectedConv;
  const showListView = !isMobile || !showChatView;

  const ConversationList = () => (
    <div className={`${isMobile ? 'w-full' : 'w-80'} shrink-0 border-r border-border bg-card flex flex-col h-full`}>
      <div className="p-3 border-b border-border space-y-2">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 bg-secondary rounded-md px-3 py-1.5 text-sm">
            <Search size={14} className="text-muted-foreground" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Buscar contacto..." className="flex-1 bg-transparent outline-none placeholder:text-muted-foreground text-foreground" />
          </div>
          <button onClick={() => setShowNewConv(true)} className="shrink-0 p-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors" title="Nueva conversación">
            <Plus size={16} />
          </button>
        </div>
        <div className="flex items-center gap-1 mt-2">
          {[null, 'open', 'pending', 'closed'].map(s => (
            <button key={s || 'all'} onClick={() => setStatusFilter(s)} className={`text-[10px] px-2 py-1 rounded-md ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>
              {s ? statusLabels[s] : 'Todos'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {conversations.length === 0 ? 'No hay conversaciones aún.' : 'Sin resultados'}
          </div>
        )}
        {filtered.map(conv => (
          <button key={conv.id} onClick={() => setSelectedConvId(conv.id)}
            className={`w-full text-left p-3 border-b border-border transition-colors ${selectedConvId === conv.id ? 'bg-primary/5' : 'hover:bg-secondary/50'}`}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-xs font-bold text-success">
                  {(conv.contact_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{conv.contact_name || conv.contact_phone}</p>
                  <p className="text-[10px] text-muted-foreground">{conv.contact_phone}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {conv.last_message_at && <p className="text-[10px] text-muted-foreground">{format(new Date(conv.last_message_at), 'HH:mm')}</p>}
              </div>
            </div>
            <div className="flex items-center gap-1 ml-10">
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[conv.status] || ''}`}>{statusLabels[conv.status] || conv.status}</span>
              {(conv.tags || []).slice(0, 2).map(t => (<span key={t} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{t}</span>))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );

  const ChatView = () => (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="shrink-0 h-14 border-b border-border flex items-center justify-between px-3 sm:px-5 bg-card">
        <div className="flex items-center gap-3">
          {isMobile && (
            <button onClick={() => setSelectedConvId(null)} className="p-1 text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
          )}
          <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-xs font-bold text-success">
            {(selectedConv?.contact_name || '?').split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{selectedConv?.contact_name || selectedConv?.contact_phone}</h3>
            <p className="text-[10px] text-muted-foreground">{selectedConv?.contact_phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          {selectedConv?.status !== 'closed' ? (
            <button onClick={handleCloseConversation} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10"><AlertCircle size={14} /> <span className="hidden sm:inline">Cerrar</span></button>
          ) : (
            <button onClick={handleReopenConversation} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium text-success hover:bg-success/10"><Circle size={14} /> <span className="hidden sm:inline">Reabrir</span></button>
          )}
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary hidden sm:block"><Phone size={16} /></button>
          <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary hidden sm:block"><CalendarPlus size={16} /></button>
          <button onClick={() => setShowNotes(!showNotes)} className={`p-2 rounded-md transition-colors hidden sm:block ${showNotes ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
            <StickyNote size={16} />
          </button>
        </div>
      </div>
      <div className="flex-1 flex min-h-0">
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 sm:px-5 py-4 space-y-3">
            {convMessages.length === 0 && <div className="text-center text-xs text-muted-foreground py-8">No hay mensajes aún</div>}
            {convMessages.map(msg => (
              <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-3 py-2 ${msg.direction === 'out' ? 'bg-success/10 text-foreground rounded-br-sm' : 'bg-muted text-foreground rounded-bl-sm'}`}>
                  <p className="text-sm">{msg.body}</p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    <span className="text-[10px] text-muted-foreground">{format(new Date(msg.created_at), 'HH:mm')}</span>
                    {msg.direction === 'out' && (
                      msg.status === 'read' ? <CheckCircle2 size={10} className="text-primary" /> :
                      msg.status === 'delivered' ? <CheckCircle2 size={10} className="text-muted-foreground" /> :
                      <Circle size={10} className="text-muted-foreground" />
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="shrink-0 border-t border-border p-3 bg-card">
            <div className="flex items-end gap-2 bg-secondary rounded-lg px-3 py-2">
              <button className="text-muted-foreground hover:text-foreground pb-0.5 hidden sm:block"><Paperclip size={16} /></button>
              <textarea value={messageInput} onChange={e => setMessageInput(e.target.value)} placeholder="Escribir mensaje..." rows={1}
                className="flex-1 bg-transparent text-sm outline-none resize-none max-h-24 placeholder:text-muted-foreground text-foreground"
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
              <button onClick={handleSendMessage} disabled={sending || !messageInput.trim()} className="bg-success text-success-foreground rounded-md p-1.5 hover:opacity-90 disabled:opacity-40">
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              </button>
            </div>
          </div>
        </div>
        {showNotes && !isMobile && (
          <div className="w-64 shrink-0 border-l border-border bg-card p-4 overflow-y-auto">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Notas internas</h4>
            <textarea defaultValue={selectedConv?.notes || ''} className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary min-h-[100px] resize-y mb-3" placeholder="Agregar notas..." />
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4">Info del contacto</h4>
            <div className="space-y-2 text-xs">
              <div><p className="text-muted-foreground">Teléfono</p><p className="text-foreground font-medium">{selectedConv?.contact_phone}</p></div>
              <div><p className="text-muted-foreground">Estado</p><span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[selectedConv?.status || ''] || ''}`}>{statusLabels[selectedConv?.status || ''] || selectedConv?.status}</span></div>
              <div><p className="text-muted-foreground">Etiquetas</p><div className="flex flex-wrap gap-1 mt-1">{(selectedConv?.tags || []).map(t => (<span key={t} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{t}</span>))}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      {showListView && <ConversationList />}
      {showChatView ? <ChatView /> : (!isMobile && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageSquare size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">{conversations.length === 0 ? 'Envía un mensaje a tu número de WhatsApp para comenzar' : 'Selecciona una conversación'}</p>
          </div>
        </div>
      ))}

      <Dialog open={showNewConv} onOpenChange={setShowNewConv}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva conversación</DialogTitle>
            <DialogDescription>Crea una nueva conversación de WhatsApp</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre del contacto</label><input value={newConvName} onChange={e => setNewConvName(e.target.value)} placeholder="Ej: Juan Pérez" className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Número de WhatsApp</label><input value={newConvPhone} onChange={e => setNewConvPhone(e.target.value)} placeholder="Ej: +52 55 1234 5678" className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground" /></div>
            <div><label className="text-xs font-medium text-muted-foreground mb-1 block">Primer mensaje (opcional)</label><textarea value={newConvMessage} onChange={e => setNewConvMessage(e.target.value)} placeholder="Escribe un mensaje..." rows={3} className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary resize-none text-foreground placeholder:text-muted-foreground" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewConv(false)}>Cancelar</Button>
            <Button onClick={handleCreateConversation} disabled={!newConvName.trim() || !newConvPhone.trim()}>Iniciar conversación</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppInboxPage;
