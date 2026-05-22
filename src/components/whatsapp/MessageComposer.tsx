import { memo, useState, useCallback, KeyboardEvent } from 'react';
import { Send, Paperclip, Loader2 } from 'lucide-react';

interface MessageComposerProps {
  onSend: (body: string) => Promise<void> | void;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Aislado del padre con estado local. El padre NO se entera de cada tecla,
 * así el textarea jamás pierde foco aunque la lista de conversaciones,
 * mensajes o estado de envío se actualicen en background.
 */
const MessageComposer = memo(({ onSend, disabled, placeholder = 'Escribir mensaje...' }: MessageComposerProps) => {
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);

  const handleSend = useCallback(async () => {
    const body = value.trim();
    if (!body || sending) return;
    setValue('');
    setSending(true);
    try {
      await onSend(body);
    } catch {
      setValue(body);
    } finally {
      setSending(false);
    }
  }, [value, sending, onSend]);

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
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          disabled={disabled || sending}
          className="flex-1 bg-transparent text-sm outline-none resize-none max-h-24 placeholder:text-muted-foreground text-foreground"
        />
        <button
          onClick={handleSend}
          disabled={disabled || sending || !value.trim()}
          type="button"
          className="bg-success text-success-foreground rounded-md p-1.5 hover:opacity-90 disabled:opacity-40"
        >
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        </button>
      </div>
    </div>
  );
});

MessageComposer.displayName = 'MessageComposer';

export default MessageComposer;
