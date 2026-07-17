import { useState, useRef, useEffect } from 'react';
import { useCFOAssistant } from '@/hooks/useCFOAssistant';
import { Bot, Send, Loader2 } from 'lucide-react';

const SUGGESTIONS = [
  '¿Cuál es mi saldo consolidado?',
  '¿Cómo va el flujo de caja este mes?',
  '¿Qué cuentas están por vencer?',
  '¿Cuál es mi Health Score y por qué?',
];

export default function CFOAssistantPage() {
  const { messages, loading, send } = useCFOAssistant();
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const submit = () => {
    if (!input.trim() || loading) return;
    send(input);
    setInput('');
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--rx-brand)]/15 flex items-center justify-center flex-shrink-0">
          <Bot size={20} className="text-[var(--rx-brand)]" />
        </div>
        <div>
          <div className="text-sm font-semibold">CFO AI</div>
          <div className="text-xs text-muted-foreground">Responde con datos financieros agregados solo del tenant activo.</div>
        </div>
      </div>

      <div className="rounded-2xl bg-card border border-border p-4 shadow-soft min-h-[380px] flex flex-col">
        <div className="flex-1 space-y-3">
          {messages.length === 0 && (
            <div className="text-xs text-muted-foreground">
              <p className="mb-2">Sugerencias:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="px-3 py-1.5 rounded-xl bg-[var(--rx-s2)] hover:bg-[var(--rx-s2)]/70 text-xs"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)]'
                  : 'bg-[var(--rx-s2)] text-foreground'
              }`}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 size={12} className="animate-spin" /> CFO AI escribiendo…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder="Pregunta al CFO AI…"
            className="flex-1 px-3 py-2 rounded-xl bg-[var(--rx-s2)] text-sm outline-none border border-border focus:border-[var(--rx-brand)]"
          />
          <button
            onClick={submit}
            disabled={loading || !input.trim()}
            className="p-2 rounded-xl bg-[var(--rx-brand)] text-[var(--rx-brand-foreground,white)] disabled:opacity-60"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
