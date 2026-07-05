import { useState, useEffect, useRef } from 'react';
import { Crown, Send, Loader2, HeadphonesIcon, MessageCircle, Lock, Sparkles, DollarSign } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePlanFeatures } from '@/hooks/usePlanFeatures';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useNavigate } from 'react-router-dom';

type Msg = {
  id: string;
  body: string;
  author_role: 'tenant' | 'super_admin';
  author_id: string | null;
  created_at: string;
};

type Consult = {
  id: string;
  status: string;
  paid_at: string | null;
  consumed_at: string | null;
  created_at: string;
};

const PlatformSupportPage = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { hasFeature, loading: planLoading, planName, supportLevel } = usePlanFeatures();
  const directSupport = hasFeature('direct_support');

  const [messages, setMessages] = useState<Msg[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [consults, setConsults] = useState<Consult[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeConsult = consults.find(c => c.status === 'paid' && !c.consumed_at);
  const canChat = directSupport || Boolean(activeConsult);

  const loadConsults = async () => {
    const { data } = await supabase
      .from('support_consult_purchases')
      .select('id, status, paid_at, consumed_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    setConsults((data || []) as any);
  };

  const load = async () => {
    setLoading(true);
    try {
      await loadConsults();
      const { data, error } = await supabase.functions.invoke('platform-support', { body: { action: 'get_my_channel' } });
      if (error) console.warn('platform-support error', error);
      else {
        setChannelId(data?.channel?.id ?? null);
        setMessages(data?.messages ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (user) load(); }, [user]);

  useEffect(() => {
    if (!channelId) return;
    const ch = supabase.channel('platform_support_' + channelId)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'platform_support_messages', filter: `channel_id=eq.${channelId}` },
        (payload) => setMessages(m => [...m, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [channelId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || !canChat) return;
    setSending(true);
    const { error } = await supabase.functions.invoke('platform-support', {
      body: { action: 'send_message', body: text, consult_id: activeConsult?.id ?? null },
    });
    if (error) toast.error('Error al enviar');
    else {
      setText('');
      // Reload consults so the one-shot consult flips to consumed
      loadConsults();
    }
    setSending(false);
  };

  const purchaseConsult = async () => {
    setPurchasing(true);
    try {
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user!.id });
      if (!tenantId) throw new Error('Tenant no encontrado');
      const { data, error } = await supabase.functions.invoke('stripe-billing', {
        body: {
          action: 'one_time_support_consult',
          tenant_id: tenantId,
          email: user!.email,
          name: user!.user_metadata?.name || user!.email,
        },
      });
      if (error) throw error;
      if (data?.checkout_url) window.location.href = data.checkout_url;
      else throw new Error('No se recibió URL de checkout');
    } catch (err: any) {
      toast.error(err.message || 'Error al iniciar la compra');
      setPurchasing(false);
    }
  };

  // ===== Gating UI when direct_support is disabled =====
  if (!planLoading && !directSupport && !activeConsult) {
    return (
      <div className="min-h-full bg-background pb-24">
        <div className="px-4 pt-6 pb-3 border-b border-border bg-card/50">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
              <HeadphonesIcon size={22} className="text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold">Soporte de la plataforma</h1>
              <p className="text-xs text-muted-foreground">Plan actual: {planName || '—'} · nivel {supportLevel || 'standard'}</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          <div className="max-w-xl mx-auto bg-card border border-border rounded-3xl p-6 text-center shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
              <Lock size={24} className="text-amber-600" />
            </div>
            <h2 className="text-xl font-bold mb-2">Canal directo no incluido en tu plan</h2>
            <p className="text-sm text-muted-foreground mb-5">
              El chat directo con el equipo Super Admin está incluido en los planes <b>Pro</b> y <b>Enterprise</b>.
              También puedes pagar una consulta prioritaria puntual.
            </p>

            <div className="bg-muted/30 rounded-2xl p-5 mb-4 text-left">
              <div className="flex items-center justify-between mb-1">
                <div className="font-semibold">Consulta prioritaria</div>
                <div className="text-2xl font-bold">$20 <span className="text-xs font-normal text-muted-foreground">USD</span></div>
              </div>
              <p className="text-xs text-muted-foreground">Pago único. Desbloquea una consulta directa con el equipo Super Admin.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Button onClick={purchaseConsult} disabled={purchasing} className="rounded-full">
                {purchasing ? <Loader2 className="animate-spin mr-2" size={16} /> : <DollarSign size={16} className="mr-2" />}
                Pagar $20 y consultar
              </Button>
              <Button variant="outline" onClick={() => navigate('/settings?tab=billing')} className="rounded-full">
                <Sparkles size={16} className="mr-2" /> Actualizar a Pro
              </Button>
            </div>

            {consults.length > 0 && (
              <div className="mt-6 pt-4 border-t border-border text-left">
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Consultas anteriores</div>
                <div className="space-y-1.5">
                  {consults.slice(0, 5).map(c => (
                    <div key={c.id} className="text-xs flex justify-between items-center">
                      <span>{new Date(c.created_at).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      <span className={`px-2 py-0.5 rounded-full ${
                        c.status === 'consumed' ? 'bg-emerald-100 text-emerald-700' :
                        c.status === 'paid' ? 'bg-blue-100 text-blue-700' :
                        c.status === 'pending' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'
                      }`}>{c.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background pb-24">
      <div className="px-4 pt-6 pb-3 border-b border-border bg-card/50">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-primary/10 flex items-center justify-center">
            <HeadphonesIcon size={22} className="text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="text-lg font-bold flex items-center gap-2">
              Soporte de la plataforma <Crown size={14} className="text-amber-500" />
            </h1>
            <p className="text-xs text-muted-foreground">
              {directSupport
                ? `Nivel ${supportLevel === 'dedicated' ? 'dedicado' : 'prioritario'} · canal directo con Super Admin`
                : 'Consulta prioritaria activa (una sola sesión)'}
            </p>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {loading ? (
          <div className="text-center py-10"><Loader2 className="animate-spin inline text-primary" /></div>
        ) : messages.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">
            <MessageCircle size={40} className="mx-auto opacity-30 mb-2" />
            <p className="text-sm">Este es tu canal privado con el equipo Super Admin.</p>
            <p className="text-xs mt-1">Escribe tu primer mensaje: dudas, reportes o solicitudes de la plataforma.</p>
          </div>
        ) : messages.map(m => {
          const mine = m.author_role === 'tenant';
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${mine ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
                {!mine && <div className="text-[10px] font-semibold text-amber-600 mb-0.5 flex items-center gap-1"><Crown size={10} /> Super Admin</div>}
                <div className="text-sm whitespace-pre-wrap">{m.body}</div>
                <div className={`text-[10px] mt-1 opacity-70`}>{new Date(m.created_at).toLocaleString('es-MX', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-border p-3 bg-card">
        <div className="flex gap-2 items-end">
          <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un mensaje al equipo de la plataforma..." className="flex-1 min-h-[52px] resize-none rounded-2xl" />
          <Button onClick={send} disabled={!text.trim() || sending || !canChat} size="icon" className="h-11 w-11 shrink-0 rounded-full">
            {sending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PlatformSupportPage;
