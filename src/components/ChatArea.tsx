import { useState } from 'react';
import { Send, Paperclip, Smile, Hash, Users, X } from 'lucide-react';
import { Message, Channel, TeamMember } from '@/types/app';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ChatAreaProps {
  channel: Channel;
  messages: Message[];
  onSendMessage: (content: string) => void;
  teamMembers?: TeamMember[];
  channelMembers?: string[];
  onAddMember?: (memberId: string) => void;
  onRemoveMember?: (memberId: string) => void;
}

const ChatArea = ({ channel, messages, onSendMessage, teamMembers = [], channelMembers = [], onAddMember, onRemoveMember }: ChatAreaProps) => {
  const [input, setInput] = useState('');
  const [showMembers, setShowMembers] = useState(false);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const members = teamMembers.filter(m => channelMembers.includes(m.id));
  const nonMembers = teamMembers.filter(m => !channelMembers.includes(m.id));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-border flex items-center justify-between px-5 bg-card">
        <div className="flex items-center">
          <Hash size={18} className="text-muted-foreground mr-2" />
          <h2 className="font-semibold text-foreground">{channel.name}</h2>
        </div>
        {channel.type === 'channel' && (
          <button
            onClick={() => setShowMembers(!showMembers)}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors ${
              showMembers ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
            }`}
          >
            <Users size={14} />
            <span>{channelMembers.length}</span>
          </button>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Messages */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-1">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
                <Hash size={32} className="mb-2 opacity-30" />
                <p className="text-sm font-medium">Canal #{channel.name}</p>
                <p className="text-xs mt-1">Envía el primer mensaje para iniciar la conversación.</p>
              </div>
            )}
            {messages.map((msg, i) => {
              const showAvatar = i === 0 || messages[i - 1].userId !== msg.userId;
              return (
                <div key={msg.id} className={`animate-fade-in ${showAvatar ? 'mt-4' : 'mt-0.5'}`}>
                  {showAvatar && (
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        msg.isOwn ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
                      }`}>
                        {msg.userName.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className="font-semibold text-sm text-foreground">{msg.userName}</span>
                      <span className="text-xs text-muted-foreground">
                        {format(msg.timestamp, 'HH:mm', { locale: es })}
                      </span>
                    </div>
                  )}
                  <div className="pl-10">
                    <p className={`text-sm leading-relaxed rounded-lg inline-block px-3 py-1.5 ${
                      msg.isOwn ? 'bg-chat-own text-foreground' : 'bg-chat-other text-foreground'
                    }`}>
                      {msg.content}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border p-4 bg-card">
            <div className="flex items-end gap-2 bg-secondary rounded-lg px-3 py-2">
              <button className="text-muted-foreground hover:text-foreground transition-colors pb-0.5">
                <Paperclip size={18} />
              </button>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={`Mensaje en #${channel.name}...`}
                rows={1}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none max-h-32"
              />
              <button className="text-muted-foreground hover:text-foreground transition-colors pb-0.5">
                <Smile size={18} />
              </button>
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="bg-primary text-primary-foreground rounded-md p-1.5 hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Members panel */}
        {showMembers && channel.type === 'channel' && (
          <div className="w-56 shrink-0 border-l border-border bg-card overflow-y-auto animate-in slide-in-from-right-4">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground uppercase tracking-wider">Miembros ({members.length})</span>
              <button onClick={() => setShowMembers(false)} className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>

            {/* Current members */}
            <div className="p-2 space-y-0.5">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md group hover:bg-secondary">
                  <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {m.name.split(' ').map(n => n[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{m.name}</p>
                    <p className="text-[10px] text-muted-foreground">{m.role}</p>
                  </div>
                  {onRemoveMember && (
                    <button
                      onClick={() => onRemoveMember(m.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
                      title="Quitar del canal"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {/* Add members */}
            {nonMembers.length > 0 && onAddMember && (
              <>
                <div className="px-3 pt-3 pb-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Agregar</span>
                </div>
                <div className="p-2 space-y-0.5">
                  {nonMembers.map(m => (
                    <button
                      key={m.id}
                      onClick={() => onAddMember(m.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-success/5 hover:text-success transition-colors"
                    >
                      <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold text-muted-foreground">
                        {m.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <span className="text-xs text-muted-foreground truncate">{m.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">+ Agregar</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatArea;
