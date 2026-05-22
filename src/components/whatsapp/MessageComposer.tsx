import { memo, useState, useCallback, KeyboardEvent, useEffect, useRef } from 'react';
import { Send, Paperclip, Loader2 } from 'lucide-react';

interface MessageComposerProps {
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
  conversationId?: string | null;
}

/**
 * Aislado del padre con estado local. El padre NO se entera de cada tecla,
 * así el textarea jamás pierde foco aunque la lista de conversaciones,
 * mensajes o estado de envío se actualicen en background.
 */
const MessageComposer = memo(({ onSend, disabled, placeholder = 'Escribir mensaje...', conversationId }: MessageComposerProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.value = '';
    setSending(false);
  }, [conversationId]);

  const handleSend = useCallback(async () => {
    const textarea = textareaRef.current;
    const body = textarea?.value.trim() || '';
    if (!body || sending) return;
    if (textarea) textarea.value = '';
    setSending(true);
    try {
      await onSend(body);
    } catch {
      if (textarea) {
        textarea.value = body;
        textarea.focus();
      }
    } finally {
      setSending(false);
    }
  }, [sending, onSend]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="shrink-0 border-t border-border p-3 bg-card">
      <div className="flex items-end gap-2 bg-secondary rounded-lg px-3 py-2">
        <button className="text-muted-foreground hover:text-foreground pb-0.5 hidden sm:block" type="button">
          <Paperclip size={16} />
        </button>
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 bg-transparent text-sm outline-none resize-none max-h-24 placeholder:text-muted-foreground text-foreground"
        />
        <button
          onClick={handleSend}
          disabled={disabled || sending}
          type="button"
          className="bg-success text-success-foreground rounded-md p-1.5 hover:opacity-90 disabled:opacity-40"
          aria-label="Enviar mensaje"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
});

MessageComposer.displayName = 'MessageComposer';

export default MessageComposer;
