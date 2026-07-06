import { useEffect, useRef, useState } from 'react';
import { Sparkles, Send, Loader2, UserCog } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Msg = { role: 'user' | 'assistant'; content: string; ts: number };

const STORAGE_KEY = 'support_aria_history_v1';

interface Props {
  onEscalated?: () => void;
}

const SupportAriaWidget = ({ onEscalated }: Props) => {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40))); } catch {}
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 40);
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content: text, ts: Date.now() }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('support-faq-assistant', {
        body: {
          action: 'ask',
          message: text,
          history: next.slice(-10).map(m => ({ role: m.role, content: m.content })),
        },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Error');
      setMessages(m => [...m, { role: 'assistant', content: data.reply, ts: Date.now() }]);
    } catch (e: any) {
      toast.error(e.message || 'Aria no pudo responder');
      setMessages(m => [...m, { role: 'assistant', content: 'Tuve un problema para responder. Puedes intentar de nuevo o escalar a un humano.', ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  const escalate = async () => {
    if (escalating) return;
    setEscalating(true);
    try {
      const lastUser = [...messages].reverse().find(m => m.role === 'user')?.content?.slice(0, 120) || 'Solicitud desde Aria';
      const summary = messages.slice(-8).map(m => `${m.role === 'user' ? 'Usuario' : 'Aria'}: ${m.content}`).join('\n\n');
      const { data, error } = await supabase.functions.invoke('support-faq-assistant', {
        body: {
          action: 'escalate',
          subject: lastUser,
          summary,
          transcript: messages.slice(-20).map(m => ({ role: m.role, content: m.content })),
          priority: 'normal',
        },
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'Error');
      toast.success('Escalado a soporte humano. Te contactaremos por correo y por el chat del ticket.');
      setMessages(m => [...m, { role: 'assistant', content: 'Listo, escalé esta conversación a un humano. Revisa tu lista de tickets y tu correo.', ts: Date.now() }]);
      onEscalated?.();
    } catch (e: any) {
      toast.error(e.message || 'No se pudo escalar');
    } finally {
      setEscalating(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 bg-primary/5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
          <Sparkles size={16} className="text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-sm">Aria · Asistente de soporte</h3>
          <p className="text-[11px] text-muted-foreground">Respuestas rápidas sobre la plataforma. Escala a humano cuando quieras.</p>
        </div>
        <Button size="sm" variant="outline" onClick={escalate} disabled={escalating || messages.length === 0} className="rounded-full h-8 text-xs">
          {escalating ? <Loader2 className="animate-spin mr-1" size={12} /> : <UserCog size={12} className="mr-1" />}
          Hablar con un humano
        </Button>
      </div>

      <div ref={scrollRef} className="max-h-80 min-h-40 overflow-y-auto px-4 py-3 space-y-2 bg-background">
        {messages.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-6">
            Pregúntame lo que necesites: integraciones, facturación, permisos, tickets…
          </div>
        ) : messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-2xl px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 className="animate-spin" size={12} /> Aria está escribiendo…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border p-2 bg-card flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Escribe tu pregunta a Aria…"
          className="flex-1 min-h-[44px] max-h-32 resize-none rounded-xl text-sm"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <Button size="icon" onClick={send} disabled={!input.trim() || loading} className="h-10 w-10 rounded-full shrink-0">
          {loading ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
        </Button>
      </div>
    </div>
  );
};

export default SupportAriaWidget;
