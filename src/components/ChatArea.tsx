import { useState } from 'react';
import { Send, Paperclip, Smile, Hash } from 'lucide-react';
import { Message, Channel } from '@/types/app';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ChatAreaProps {
  channel: Channel;
  messages: Message[];
  onSendMessage: (content: string) => void;
}

const ChatArea = ({ channel, messages, onSendMessage }: ChatAreaProps) => {
  const [input, setInput] = useState('');

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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-border flex items-center px-5 bg-card">
        <Hash size={18} className="text-muted-foreground mr-2" />
        <h2 className="font-semibold text-foreground">{channel.name}</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4 space-y-1">
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
              <div className={`pl-10 ${showAvatar ? '' : ''}`}>
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
  );
};

export default ChatArea;
