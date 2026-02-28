import { useState } from 'react';
import { MessageSquare, Search, Tag, User, Clock, Send, Paperclip, StickyNote, Phone, CalendarPlus, ChevronDown, Circle, CheckCircle2, AlertCircle, Plus } from 'lucide-react';
import { mockWAConversations, mockWAMessages, type WhatsAppConversation, type WhatsAppMessage } from '@/data/mockCallsData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const statusColors: Record<string, string> = {
  open: 'bg-success/10 text-success',
  pending: 'bg-warning/10 text-warning',
  closed: 'bg-muted text-muted-foreground',
};

const WhatsAppInboxPage = () => {
  const [selectedConvId, setSelectedConvId] = useState<string | null>('wa-conv-1');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [messageInput, setMessageInput] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [showNewConv, setShowNewConv] = useState(false);
  const [newConvName, setNewConvName] = useState('');
  const [newConvPhone, setNewConvPhone] = useState('');
  const [newConvMessage, setNewConvMessage] = useState('');
  const [conversations, setConversations] = useState<WhatsAppConversation[]>(mockWAConversations);
  const [messages, setMessages] = useState<WhatsAppMessage[]>(mockWAMessages);

  const handleCreateConversation = () => {
    if (!newConvName.trim() || !newConvPhone.trim()) return;
    const newId = `wa-conv-${Date.now()}`;
    const newConv: WhatsAppConversation = {
      id: newId,
      contactPhone: newConvPhone.trim(),
      contactName: newConvName.trim(),
      assignedTo: 'Yo',
      status: 'open',
      tags: [],
      notes: '',
      lastMessageAt: new Date(),
      unreadCount: 0,
    };
    if (newConvMessage.trim()) {
      const newMsg: WhatsAppMessage = {
        id: `wa-msg-${Date.now()}`,
        conversationId: newId,
        direction: 'out',
        body: newConvMessage.trim(),
        mediaUrl: null,
        status: 'sent',
        createdAt: new Date(),
      };
      setMessages(prev => [...prev, newMsg]);
    }
    setConversations(prev => [newConv, ...prev]);
    setSelectedConvId(newId);
    setShowNewConv(false);
    setNewConvName('');
    setNewConvPhone('');
    setNewConvMessage('');
  };

  const filtered = conversations.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!searchQuery || c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) || c.contactPhone.includes(searchQuery))
  );

  const selectedConv = conversations.find(c => c.id === selectedConvId);
  const convMessages = messages.filter(m => m.conversationId === selectedConvId);

  return (
    <div className="flex h-full">
      {/* Conversation list */}
      <div className="w-80 shrink-0 border-r border-border bg-card flex flex-col h-full">
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
            <button onClick={() => setStatusFilter(null)} className={`text-[10px] px-2 py-1 rounded-md ${!statusFilter ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Todos</button>
            <button onClick={() => setStatusFilter('open')} className={`text-[10px] px-2 py-1 rounded-md ${statusFilter === 'open' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Abiertos</button>
            <button onClick={() => setStatusFilter('pending')} className={`text-[10px] px-2 py-1 rounded-md ${statusFilter === 'pending' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Pendientes</button>
            <button onClick={() => setStatusFilter('closed')} className={`text-[10px] px-2 py-1 rounded-md ${statusFilter === 'closed' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Cerrados</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {filtered.map(conv => (
            <button
              key={conv.id}
              onClick={() => setSelectedConvId(conv.id)}
              className={`w-full text-left p-3 border-b border-border transition-colors ${
                selectedConvId === conv.id ? 'bg-primary/5' : 'hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-xs font-bold text-success">
                    {conv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{conv.contactName}</p>
                    <p className="text-[10px] text-muted-foreground">{conv.contactPhone}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-muted-foreground">{format(conv.lastMessageAt, 'HH:mm')}</p>
                  {conv.unreadCount > 0 && (
                    <span className="inline-flex items-center justify-center w-4 h-4 bg-success text-primary-foreground text-[10px] font-bold rounded-full mt-0.5">
                      {conv.unreadCount}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-10">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusColors[conv.status]}`}>{conv.status === 'open' ? 'Abierto' : conv.status === 'pending' ? 'Pendiente' : 'Cerrado'}</span>
                {conv.tags.slice(0, 2).map(t => (
                  <span key={t} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{t}</span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat area */}
      {selectedConv ? (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="shrink-0 h-14 border-b border-border flex items-center justify-between px-5 bg-card">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-success/10 flex items-center justify-center text-xs font-bold text-success">
                {selectedConv.contactName.split(' ').map(n => n[0]).join('').slice(0, 2)}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{selectedConv.contactName}</h3>
                <p className="text-[10px] text-muted-foreground">{selectedConv.contactPhone} · {selectedConv.assignedTo}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedConv.status !== 'closed' && (
                <button
                  onClick={() => setConversations(prev => prev.map(c => c.id === selectedConvId ? { ...c, status: 'closed' as const } : c))}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                  title="Cerrar conversación"
                >
                  <AlertCircle size={14} />
                  Cerrar
                </button>
              )}
              {selectedConv.status === 'closed' && (
                <button
                  onClick={() => setConversations(prev => prev.map(c => c.id === selectedConvId ? { ...c, status: 'open' as const } : c))}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium text-success hover:bg-success/10 transition-colors"
                  title="Reabrir conversación"
                >
                  <Circle size={14} />
                  Reabrir
                </button>
              )}
              <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Llamar">
                <Phone size={16} />
              </button>
              <button className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Agendar">
                <CalendarPlus size={16} />
              </button>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className={`p-2 rounded-md transition-colors ${showNotes ? 'text-primary bg-primary/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
                title="Notas"
              >
                <StickyNote size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 flex min-h-0">
            {/* Messages */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-3">
                {convMessages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.direction === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[70%] rounded-xl px-3 py-2 ${
                      msg.direction === 'out'
                        ? 'bg-success/10 text-foreground rounded-br-sm'
                        : 'bg-muted text-foreground rounded-bl-sm'
                    }`}>
                      <p className="text-sm">{msg.body}</p>
                      <div className="flex items-center justify-end gap-1 mt-1">
                        <span className="text-[10px] text-muted-foreground">{format(msg.createdAt, 'HH:mm')}</span>
                        {msg.direction === 'out' && (
                          msg.status === 'read' ? <CheckCircle2 size={10} className="text-primary" /> :
                          msg.status === 'delivered' ? <CheckCircle2 size={10} className="text-muted-foreground" /> :
                          <Circle size={10} className="text-muted-foreground" />
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Input */}
              <div className="shrink-0 border-t border-border p-3 bg-card">
                <div className="flex items-end gap-2 bg-secondary rounded-lg px-3 py-2">
                  <button className="text-muted-foreground hover:text-foreground pb-0.5"><Paperclip size={16} /></button>
                  <textarea
                    value={messageInput}
                    onChange={e => setMessageInput(e.target.value)}
                    placeholder="Escribir mensaje..."
                    rows={1}
                    className="flex-1 bg-transparent text-sm outline-none resize-none max-h-24 placeholder:text-muted-foreground"
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); setMessageInput(''); } }}
                  />
                  <button className="bg-success text-success-foreground rounded-md p-1.5 hover:opacity-90">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Notes panel */}
            {showNotes && (
              <div className="w-64 shrink-0 border-l border-border bg-card p-4 overflow-y-auto">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Notas internas</h4>
                <textarea
                  defaultValue={selectedConv.notes}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary min-h-[100px] resize-y mb-3"
                  placeholder="Agregar notas..."
                />
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 mt-4">Info del contacto</h4>
                <div className="space-y-2 text-xs">
                  <div>
                    <p className="text-muted-foreground">Teléfono</p>
                    <p className="text-foreground font-medium">{selectedConv.contactPhone}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Asignado a</p>
                    <p className="text-foreground font-medium">{selectedConv.assignedTo}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Estado</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusColors[selectedConv.status]}`}>
                      {selectedConv.status}
                    </span>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Etiquetas</p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedConv.tags.map(t => (
                        <span key={t} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <MessageSquare size={40} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">Selecciona una conversación</p>
          </div>
        </div>
      )}

      {/* New conversation dialog */}
      <Dialog open={showNewConv} onOpenChange={setShowNewConv}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nueva conversación</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Nombre del contacto</label>
              <input
                value={newConvName}
                onChange={e => setNewConvName(e.target.value)}
                placeholder="Ej: Juan Pérez"
                className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Número de WhatsApp</label>
              <input
                value={newConvPhone}
                onChange={e => setNewConvPhone(e.target.value)}
                placeholder="Ej: +52 55 1234 5678"
                className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Primer mensaje (opcional)</label>
              <textarea
                value={newConvMessage}
                onChange={e => setNewConvMessage(e.target.value)}
                placeholder="Escribe un mensaje..."
                rows={3}
                className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none border border-border focus:border-primary resize-none text-foreground placeholder:text-muted-foreground"
              />
            </div>
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
