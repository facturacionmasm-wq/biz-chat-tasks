import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot, X, Send, Plus, History, Trash2, Square,
  Loader2, ChevronDown, Sparkles, MessageSquare
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useAIAssistant, type AssistantMessage, type Conversation } from '@/hooks/useAIAssistant';
import { useIsMobile } from '@/hooks/use-mobile';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  idle: { label: 'Conectado', color: 'bg-success' },
  loading: { label: 'Procesando...', color: 'bg-warning' },
};

const QUICK_ACTIONS = [
  { label: '📖 Manual de Usuario', prompt: 'Genera un manual de usuario interactivo de todos los módulos de la plataforma.' },
  { label: '🔧 Manual Técnico', prompt: 'Genera un manual técnico detallado de la arquitectura, base de datos e integraciones del sistema.' },
  { label: '❓ ¿Qué puedo hacer aquí?', prompt: '¿Qué funcionalidades tengo disponibles en esta página?' },
  { label: '🚀 Guía de inicio', prompt: 'Dame una guía paso a paso para comenzar a usar la plataforma como nuevo usuario.' },
];

const AIAssistantWidget = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  const {
    messages,
    isLoading,
    conversations,
    activeConversationId,
    sendMessage,
    stopGeneration,
    loadConversations,
    loadConversation,
    startNewConversation,
    deleteConversation,
  } = useAIAssistant();

  const status = isLoading ? 'loading' : 'idle';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, loadConversations]);

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
  }, [input, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center group hover:scale-105"
        aria-label="Abrir asistente virtual"
      >
        <Sparkles size={24} className="group-hover:rotate-12 transition-transform" />
        <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-success border-2 border-card" />
      </button>
    );
  }

  return (
    <div className={`fixed z-50 ${isMobile ? 'inset-0' : 'bottom-6 right-6 w-[420px] h-[600px]'} flex flex-col bg-card border border-border rounded-2xl shadow-lg overflow-hidden animate-slide-in`}>
      {/* Header */}
      <div className="shrink-0 bg-primary px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-primary-foreground/20 flex items-center justify-center">
            <Bot size={20} className="text-primary-foreground" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-primary-foreground">Aria — Asistente IA</h3>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${STATUS_LABELS[status].color}`} />
              <span className="text-[10px] text-primary-foreground/80">{STATUS_LABELS[status].label}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="p-1.5 rounded-md text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
            title="Historial"
          >
            <History size={16} />
          </button>
          <button
            onClick={startNewConversation}
            className="p-1.5 rounded-md text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
            title="Nueva conversación"
          >
            <Plus size={16} />
          </button>
          <button
            onClick={() => { setIsOpen(false); setShowHistory(false); }}
            className="p-1.5 rounded-md text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* History sidebar overlay */}
      {showHistory && (
        <div className="absolute inset-0 top-[60px] z-10 bg-card border-t border-border flex flex-col">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h4 className="text-sm font-semibold text-foreground">Historial</h4>
            <button onClick={() => setShowHistory(false)} className="text-muted-foreground hover:text-foreground">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
            {conversations.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-8">Sin conversaciones anteriores</p>
            )}
            {conversations.map(conv => (
              <div
                key={conv.id}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer text-sm transition-colors ${
                  activeConversationId === conv.id ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary'
                }`}
              >
                <MessageSquare size={14} className="shrink-0 text-muted-foreground" />
                <span
                  className="truncate flex-1"
                  onClick={() => { loadConversation(conv.id); setShowHistory(false); }}
                >
                  {conv.title}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  className="shrink-0 text-muted-foreground hover:text-destructive p-1"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="w-16 h-16 rounded-full bg-accent flex items-center justify-center">
              <Sparkles size={28} className="text-accent-foreground" />
            </div>
            <div className="text-center">
              <h4 className="text-sm font-semibold text-foreground mb-1">¡Hola! Soy Aria 👋</h4>
              <p className="text-xs text-muted-foreground max-w-[280px]">
                Tu asistente virtual inteligente. Puedo ayudarte con cualquier tarea, generar manuales, resolver dudas y más.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
              {QUICK_ACTIONS.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleQuickAction(action.prompt)}
                  className="text-left px-3 py-2.5 rounded-lg border border-border bg-secondary/50 hover:bg-secondary text-xs text-foreground transition-colors"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && messages[messages.length - 1]?.role !== 'assistant' && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-xs">Aria está pensando...</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu pregunta..."
            rows={1}
            className="flex-1 resize-none bg-secondary rounded-lg px-3 py-2.5 text-sm outline-none border border-border focus:border-primary text-foreground placeholder:text-muted-foreground max-h-24 scrollbar-thin"
            style={{ minHeight: '40px' }}
          />
          {isLoading ? (
            <button
              onClick={stopGeneration}
              className="shrink-0 w-10 h-10 rounded-lg bg-destructive text-destructive-foreground flex items-center justify-center hover:opacity-90 transition-colors"
              title="Detener"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0 w-10 h-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-colors"
            >
              <Send size={16} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
          Aria puede cometer errores. Verifica información importante.
        </p>
      </div>
    </div>
  );
};

const MessageBubble = ({ message }: { message: AssistantMessage }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-br-md'
          : 'bg-secondary text-foreground rounded-bl-md'
      }`}>
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_h1]:font-bold [&_h2]:font-semibold [&_h3]:font-medium [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_a]:text-primary [&_a]:underline">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default AIAssistantWidget;
