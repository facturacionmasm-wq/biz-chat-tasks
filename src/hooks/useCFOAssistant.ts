import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CFOMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export function useCFOAssistant() {
  const [messages, setMessages] = useState<CFOMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const userMsg: CFOMessage = { role: 'user', content: text.trim(), createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);
    try {
      const history = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke('cfo-ai', {
        body: { messages: history },
      });
      if (error) throw error;
      const reply = (data as { reply?: string })?.reply ?? 'Sin respuesta.';
      setMessages((m) => [...m, { role: 'assistant', content: reply, createdAt: Date.now() }]);
    } catch (e: unknown) {
      const msg = (e as Error).message || 'Error CFO AI';
      toast.error(msg);
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${msg}`, createdAt: Date.now() }]);
    } finally {
      setLoading(false);
    }
  }, [messages]);

  const reset = useCallback(() => setMessages([]), []);

  return { messages, loading, send, reset };
}
