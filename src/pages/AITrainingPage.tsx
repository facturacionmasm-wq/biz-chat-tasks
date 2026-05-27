import { useState, useCallback, useRef, useEffect } from 'react';
import { Bot, Send, Loader2, Phone, MessageSquare, Trash2, Volume2, Mic, ThumbsUp, ThumbsDown, BookOpen, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useConversation } from '@elevenlabs/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { toast } from 'sonner';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  approved?: boolean | null;
  saved?: boolean;
  correcting?: boolean;
  correction?: string;
}

interface VoiceTranscriptLine {
  role: string;
  text: string;
  approved?: boolean | null;
  saved?: boolean;
  correcting?: boolean;
  correction?: string;
}

const AITrainingPage = () => {
  // --- State for simulated bot conversation ---
  const [botState, setBotState] = useState<string>('welcome');
  const [botContext, setBotContext] = useState<Record<string, unknown>>({});
  const [simulatedRole, setSimulatedRole] = useState<'client' | 'employee' | null>(null);

  // --- WhatsApp AI Agent state ---
  const [waMessages, setWaMessages] = useState<ChatMessage[]>([]);
  const [waInput, setWaInput] = useState('');
  const [waLoading, setWaLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // --- ElevenLabs Voice Agent state ---
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<VoiceTranscriptLine[]>([]);

  const conversation = useConversation({
    onConnect: () => setVoiceError(null),
    onDisconnect: () => {},
    onMessage: (message: any) => {
      if (message.type === 'user_transcript') {
        const text = message.user_transcription_event?.user_transcript;
        if (text) setTranscriptLines(prev => [...prev, { role: 'Tú', text }]);
      }
      if (message.type === 'agent_response') {
        const text = message.agent_response_event?.agent_response;
        if (text) setTranscriptLines(prev => [...prev, { role: 'Agente', text }]);
      }
    },
    onError: (err) => {
      console.error('Voice agent error:', err);
      setVoiceError('Error de conexión con el agente de voz');
    },
  });

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [waMessages, waLoading]);

  const startVoiceCall = useCallback(async () => {
    setIsConnecting(true);
    setVoiceError(null);
    setTranscriptLines([]);
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      const { data, error } = await supabase.functions.invoke('elevenlabs-conversation-token');
      if (error || !data?.token) throw new Error('No se recibió token');
      await conversation.startSession({ conversationToken: data.token, connectionType: 'webrtc' });
    } catch (err: any) {
      setVoiceError(err.message || 'No se pudo iniciar la llamada');
    } finally {
      setIsConnecting(false);
    }
  }, [conversation]);

  const endVoiceCall = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const isVoiceActive = conversation.status === 'connected';

  // --- Send message to real whatsapp-bot function ---
  const sendWaMessage = async () => {
    if (!waInput.trim() || waLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: waInput.trim(), timestamp: new Date() };
    setWaMessages(prev => [...prev, userMsg]);
    setWaInput('');
    setWaLoading(true);

    try {
      // Get the real tenant_id so the bot can query the Knowledge Hub
      const { data: userData } = await supabase.auth.getUser();
      let realTenantId = '__sandbox__';
      if (userData?.user?.id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('tenant_id')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        if (profile?.tenant_id) realTenantId = profile.tenant_id;
      }

      const { data, error } = await supabase.functions.invoke('whatsapp-bot', {
        body: {
          conversationId: '__training_sandbox__',
          messageBody: userMsg.content,
          contactPhone: '+0000000000',
          tenantId: realTenantId,
          // Pass simulated state so the bot continues the conversation
          sandboxMode: true,
          sandboxState: botState,
          sandboxContext: botContext,
        },
      });

      if (error) throw error;

      const reply = data?.reply || 'Sin respuesta del agente.';
      const newState = data?.state || botState;
      const newContext = data?.context || botContext;

      setBotState(newState);
      setBotContext(newContext);

      if (newState === 'awaiting_role') {
        // Don't set role yet
      } else if (newContext?.role === 'client') {
        setSimulatedRole('client');
      } else if (newContext?.role === 'employee') {
        setSimulatedRole('employee');
      }

      setWaMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date(), approved: null }]);
    } catch (err: any) {
      setWaMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message || 'No se pudo obtener respuesta'}`, timestamp: new Date() },
      ]);
    } finally {
      setWaLoading(false);
    }
  };

  // --- Approve/reject response for learning ---
  const handleFeedback = async (index: number, approved: boolean) => {
    setWaMessages(prev => prev.map((m, i) => i === index ? { ...m, approved, correcting: !approved, correction: '' } : m));

    if (approved) {
      const question = waMessages.slice(0, index).reverse().find(m => m.role === 'user');
      if (question) {
        toast.success('Respuesta aprobada — puedes guardarla como conocimiento');
      }
    }
  };

  const handleCorrectionChange = (index: number, value: string) => {
    setWaMessages(prev => prev.map((m, i) => i === index ? { ...m, correction: value } : m));
  };

  const saveCorrection = async (index: number) => {
    const msg = waMessages[index];
    const question = waMessages.slice(0, index).reverse().find(m => m.role === 'user');
    if (!question || !msg?.correction?.trim()) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        toast.error('Debes iniciar sesión para guardar correcciones');
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!profile?.tenant_id) {
        toast.error('No se encontró el tenant');
        return;
      }

      await supabase.from('knowledge_items').insert({
        tenant_id: profile.tenant_id,
        title: `Corrección: ${question.content.substring(0, 100)}`,
        content: `**Pregunta del ${simulatedRole === 'employee' ? 'empleado' : 'cliente'}:**\n${question.content}\n\n**Respuesta correcta (corregida):**\n${msg.correction}`,
        category: 'Entrenamiento IA',
        tags: ['bot-training', 'correction', simulatedRole || 'general'],
        author_id: userId,
        visibility: 'internal',
        active: true,
      });

      setWaMessages(prev => prev.map((m, i) => i === index ? { ...m, correcting: false, saved: true } : m));
      toast.success('✅ Corrección guardada en Knowledge Hub — el bot usará esta respuesta en el futuro');
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err.message || 'desconocido'));
    }
  };

  // --- Save approved Q&A as knowledge ---
  const saveAsKnowledge = async (index: number) => {
    const answer = waMessages[index];
    const question = waMessages.slice(0, index).reverse().find(m => m.role === 'user');
    if (!question || !answer) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) {
        toast.error('Debes iniciar sesión para guardar en Knowledge Hub');
        return;
      }
      
      // Get tenant_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (!profile?.tenant_id) {
        toast.error('No se encontró el tenant');
        return;
      }

      await supabase.from('knowledge_items').insert({
        tenant_id: profile.tenant_id,
        title: `Pregunta: ${question.content.substring(0, 100)}`,
        content: `**Pregunta del ${simulatedRole === 'employee' ? 'empleado' : 'cliente'}:**\n${question.content}\n\n**Respuesta aprobada:**\n${answer.content}`,
        category: 'Entrenamiento IA',
        tags: ['bot-training', simulatedRole || 'general'],
        author_id: userId,
        visibility: 'internal',
        active: true,
      });

      setWaMessages(prev => prev.map((m, i) => i === index ? { ...m, saved: true } : m));
      toast.success('✅ Guardado en Knowledge Hub — el bot usará esta respuesta en el futuro');
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err.message || 'desconocido'));
    }
  };

  // --- Reset sandbox ---
  const resetSandbox = () => {
    setWaMessages([]);
    setWaInput('');
    setBotState('welcome');
    setBotContext({});
    setSimulatedRole(null);
  };

  // --- Voice transcript feedback handlers ---
  const handleVoiceFeedback = (index: number, approved: boolean) => {
    setTranscriptLines(prev => prev.map((l, i) => i === index ? { ...l, approved, correcting: !approved, correction: '' } : l));
    if (approved) toast.success('Respuesta aprobada — puedes guardarla como conocimiento');
  };

  const handleVoiceCorrectionChange = (index: number, value: string) => {
    setTranscriptLines(prev => prev.map((l, i) => i === index ? { ...l, correction: value } : l));
  };

  const saveVoiceCorrection = async (index: number) => {
    const line = transcriptLines[index];
    // Find the previous user line as the "question"
    const question = transcriptLines.slice(0, index).reverse().find(l => l.role === 'Tú');
    if (!question || !line?.correction?.trim()) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) { toast.error('Debes iniciar sesión'); return; }
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
      if (!profile?.tenant_id) { toast.error('No se encontró el tenant'); return; }

      await supabase.from('knowledge_items').insert({
        tenant_id: profile.tenant_id,
        title: `Corrección voz: ${question.text.substring(0, 100)}`,
        content: `**Pregunta del usuario (voz):**\n${question.text}\n\n**Respuesta correcta (corregida):**\n${line.correction}`,
        category: 'Entrenamiento IA',
        tags: ['bot-training', 'correction', 'voice-agent'],
        author_id: userId,
        visibility: 'internal',
        active: true,
      });

      setTranscriptLines(prev => prev.map((l, i) => i === index ? { ...l, correcting: false, saved: true } : l));
      toast.success('✅ Corrección guardada — el agente de voz la usará en la próxima llamada');
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err.message || 'desconocido'));
    }
  };

  const saveVoiceAsKnowledge = async (index: number) => {
    const answer = transcriptLines[index];
    const question = transcriptLines.slice(0, index).reverse().find(l => l.role === 'Tú');
    if (!question || !answer) return;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;
      if (!userId) { toast.error('Debes iniciar sesión'); return; }
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('user_id', userId).maybeSingle();
      if (!profile?.tenant_id) { toast.error('No se encontró el tenant'); return; }

      await supabase.from('knowledge_items').insert({
        tenant_id: profile.tenant_id,
        title: `Pregunta voz: ${question.text.substring(0, 100)}`,
        content: `**Pregunta del usuario (voz):**\n${question.text}\n\n**Respuesta aprobada:**\n${answer.text}`,
        category: 'Entrenamiento IA',
        tags: ['bot-training', 'voice-agent'],
        author_id: userId,
        visibility: 'internal',
        active: true,
      });

      setTranscriptLines(prev => prev.map((l, i) => i === index ? { ...l, saved: true } : l));
      toast.success('✅ Guardado en Knowledge Hub — el agente lo usará en futuras llamadas');
    } catch (err: any) {
      toast.error('Error al guardar: ' + (err.message || 'desconocido'));
    }
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Bot size={22} className="text-[var(--rx-brand)]" />
          Entrenamiento IA
        </h1>
        <p className="text-sm text-[var(--rx-t2)] mt-1">
          Prueba al bot Aria con el mismo motor que usa en WhatsApp. Aprueba respuestas para que aprenda y mejore.
        </p>
      </div>

      <Tabs defaultValue="whatsapp" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare size={14} /> Agente WhatsApp (Aria)
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-2">
            <Phone size={14} /> Agente de Voz
          </TabsTrigger>
        </TabsList>

        {/* WhatsApp AI Tab */}
        <TabsContent value="whatsapp" className="flex-1 flex flex-col min-h-0 mt-4">
          {/* Status bar */}
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs text-[var(--rx-t2)]">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Bot conectado al motor real
              </div>
              {simulatedRole && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${simulatedRole === 'employee' ? 'bg-primary/10 text-[var(--rx-brand)]' : 'bg-accent text-accent-foreground'}`}>
                  Modo: {simulatedRole === 'employee' ? '👨‍💼 Empleado' : '👤 Cliente'}
                </span>
              )}
              <span className="text-xs text-[var(--rx-t2)]">
                Estado: <code className="bg-[var(--rx-s2)] px-1 rounded">{botState}</code>
              </span>
            </div>
          </div>

          <div className="flex-1 flex flex-col bg-card border border-[var(--rx-b1)] rounded-xl overflow-hidden">
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {waMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Sparkles size={40} className="text-[var(--rx-t2)]/30 mb-3" />
                  <p className="text-sm text-[var(--rx-t2)] font-medium">Sandbox conectado al bot real de Aria</p>
                  <p className="text-xs text-[var(--rx-t2)] mt-1">Escribe "hola" para iniciar. Aprueba las buenas respuestas para que Aria aprenda.</p>
                </div>
              )}
              {waMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[75%]">
                    <div
                      className={`px-3.5 py-2.5 rounded-2xl text-sm ${
                        msg.role === 'user'
                          ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground rounded-br-md'
                          : 'bg-[var(--rx-s2)] text-foreground rounded-bl-md'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-[var(--rx-brand)]-foreground/60' : 'text-[var(--rx-t2)]'}`}>
                        {msg.timestamp.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>

                    {/* Feedback controls for assistant messages */}
                    {msg.role === 'assistant' && !msg.content.startsWith('Error:') && (
                      <>
                        <div className="flex items-center gap-1 mt-1 ml-1">
                          <button
                            onClick={() => handleFeedback(i, true)}
                            className={`p-1 rounded transition-colors ${msg.approved === true ? 'text-emerald-500 bg-emerald-500/10' : 'text-[var(--rx-t2)] hover:text-emerald-500 hover:bg-emerald-500/10'}`}
                            title="Buena respuesta"
                          >
                            <ThumbsUp size={13} />
                          </button>
                          <button
                            onClick={() => handleFeedback(i, false)}
                            className={`p-1 rounded transition-colors ${msg.approved === false ? 'text-[var(--rx-rose)] bg-destructive/10' : 'text-[var(--rx-t2)] hover:text-[var(--rx-rose)] hover:bg-destructive/10'}`}
                            title="Respuesta incorrecta"
                          >
                            <ThumbsDown size={13} />
                          </button>
                          {msg.approved === true && !msg.saved && (
                            <button
                              onClick={() => saveAsKnowledge(i)}
                              className="flex items-center gap-1 text-xs text-[var(--rx-brand)] hover:bg-primary/10 px-2 py-0.5 rounded ml-1 transition-colors"
                            >
                              <BookOpen size={12} /> Guardar en Knowledge Hub
                            </button>
                          )}
                          {msg.saved && (
                            <span className="text-xs text-emerald-500 ml-1">✓ Guardado</span>
                          )}
                        </div>

                        {msg.correcting && (
                          <div className="mt-2 ml-1 space-y-2">
                            <p className="text-xs text-[var(--rx-t2)]">Escribe la respuesta correcta para que Aria aprenda:</p>
                            <textarea
                              value={msg.correction || ''}
                              onChange={e => handleCorrectionChange(i, e.target.value)}
                              placeholder="Escribe aquí la respuesta correcta..."
                              className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary min-h-[60px] resize-y"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => saveCorrection(i)}
                                disabled={!msg.correction?.trim()}
                                className="flex items-center gap-1 text-xs bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                              >
                                <BookOpen size={12} /> Guardar corrección
                              </button>
                              <button
                                onClick={() => setWaMessages(prev => prev.map((m, idx) => idx === i ? { ...m, correcting: false } : m))}
                                className="text-xs text-[var(--rx-t2)] hover:text-foreground px-2 py-1.5 transition-colors"
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
              {waLoading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--rx-s2)] px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin text-[var(--rx-t2)]" />
                    <span className="text-xs text-[var(--rx-t2)]">Aria está pensando...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-[var(--rx-b1)] p-3 flex items-center gap-2">
              <button
                onClick={resetSandbox}
                className="p-2 text-[var(--rx-t2)] hover:text-[var(--rx-rose)] transition-colors rounded-md hover:bg-destructive/10"
                title="Reiniciar conversación"
              >
                <Trash2 size={16} />
              </button>
              <input
                value={waInput}
                onChange={e => setWaInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendWaMessage()}
                placeholder="Escribe como si fueras un cliente o empleado..."
                className="flex-1 bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary"
                disabled={waLoading}
              />
              <button
                onClick={sendWaMessage}
                disabled={waLoading || !waInput.trim()}
                className="p-2 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </TabsContent>

        {/* ElevenLabs Voice Tab */}
        <TabsContent value="voice" className="flex-1 flex flex-col min-h-0 mt-4">
          <div className="flex-1 flex flex-col bg-card border border-[var(--rx-b1)] rounded-xl overflow-hidden">
            {/* Voice controls */}
            <div className={`px-5 py-4 flex items-center justify-between ${isVoiceActive ? 'bg-primary/10 border-b border-primary/20' : 'border-b border-[var(--rx-b1)]'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isVoiceActive ? 'bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground animate-pulse' : 'bg-[var(--rx-s2)] text-[var(--rx-t2)]'}`}>
                  <Phone size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isVoiceActive ? 'Llamada de prueba en curso' : 'Probar Voice Agent'}
                  </h3>
                  <p className="text-xs text-[var(--rx-t2)]">
                    {isVoiceActive
                      ? conversation.isSpeaking
                        ? 'El agente está hablando...'
                        : 'Escuchando...'
                      : 'Inicia una llamada para probar las respuestas del agente de voz'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isVoiceActive && (
                  <span className="flex items-center gap-1 text-xs text-[var(--rx-brand)] mr-2">
                    {conversation.isSpeaking ? <Volume2 size={14} className="animate-pulse" /> : <Mic size={14} />}
                  </span>
                )}
                {!isVoiceActive ? (
                  <button
                    onClick={startVoiceCall}
                    disabled={isConnecting}
                    className="flex items-center gap-2 bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {isConnecting ? <><Loader2 size={14} className="animate-spin" /> Conectando...</> : <><Phone size={14} /> Iniciar prueba</>}
                  </button>
                ) : (
                  <button onClick={endVoiceCall} className="flex items-center gap-2 bg-destructive text-[var(--rx-rose)]-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90">
                    <Phone size={14} /> Finalizar
                  </button>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
              {transcriptLines.length === 0 && !isVoiceActive && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Phone size={40} className="text-[var(--rx-t2)]/30 mb-3" />
                  <p className="text-sm text-[var(--rx-t2)]">Inicia una llamada de prueba con el Voice Agent</p>
                  <p className="text-xs text-[var(--rx-t2)] mt-1">La transcripción aparecerá aquí en tiempo real</p>
                </div>
              )}
              {transcriptLines.length === 0 && isVoiceActive && (
                <p className="text-sm text-[var(--rx-t2)] text-center py-8">Esperando conversación...</p>
              )}
              {transcriptLines.map((line, i) => (
                <div key={i}>
                  <div
                    className={`px-3 py-2 rounded-lg text-sm ${
                      line.role === 'Agente'
                        ? 'bg-primary/5 border-l-2 border-primary'
                        : 'bg-[var(--rx-s2)]/50 border-l-2 border-muted-foreground/30'
                    }`}
                  >
                    <span className="text-xs font-semibold text-[var(--rx-t2)]">{line.role}:</span>
                    <p className="text-foreground mt-0.5">{line.text}</p>
                  </div>

                  {/* Feedback controls for agent responses */}
                  {line.role === 'Agente' && (
                    <>
                      <div className="flex items-center gap-1 mt-1 ml-1">
                        <button
                          onClick={() => handleVoiceFeedback(i, true)}
                          className={`p-1 rounded transition-colors ${line.approved === true ? 'text-emerald-500 bg-emerald-500/10' : 'text-[var(--rx-t2)] hover:text-emerald-500 hover:bg-emerald-500/10'}`}
                          title="Buena respuesta"
                        >
                          <ThumbsUp size={13} />
                        </button>
                        <button
                          onClick={() => handleVoiceFeedback(i, false)}
                          className={`p-1 rounded transition-colors ${line.approved === false ? 'text-[var(--rx-rose)] bg-destructive/10' : 'text-[var(--rx-t2)] hover:text-[var(--rx-rose)] hover:bg-destructive/10'}`}
                          title="Respuesta incorrecta"
                        >
                          <ThumbsDown size={13} />
                        </button>
                        {line.approved === true && !line.saved && (
                          <button
                            onClick={() => saveVoiceAsKnowledge(i)}
                            className="flex items-center gap-1 text-xs text-[var(--rx-brand)] hover:bg-primary/10 px-2 py-0.5 rounded ml-1 transition-colors"
                          >
                            <BookOpen size={12} /> Guardar en Knowledge Hub
                          </button>
                        )}
                        {line.saved && (
                          <span className="text-xs text-emerald-500 ml-1">✓ Guardado</span>
                        )}
                      </div>

                      {line.correcting && (
                        <div className="mt-2 ml-1 space-y-2">
                          <p className="text-xs text-[var(--rx-t2)]">Escribe la respuesta correcta para que el agente de voz aprenda:</p>
                          <textarea
                            value={line.correction || ''}
                            onChange={e => handleVoiceCorrectionChange(i, e.target.value)}
                            placeholder="Escribe aquí la respuesta correcta..."
                            className="w-full bg-[var(--rx-s2)] rounded-lg px-3 py-2 text-sm outline-none border border-[var(--rx-b1)] focus:border-primary min-h-[60px] resize-y"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveVoiceCorrection(i)}
                              disabled={!line.correction?.trim()}
                              className="flex items-center gap-1 text-xs bg-[var(--rx-brand)] text-[var(--rx-brand)]-foreground px-3 py-1.5 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                            >
                              <BookOpen size={12} /> Guardar corrección
                            </button>
                            <button
                              onClick={() => setTranscriptLines(prev => prev.map((l, idx) => idx === i ? { ...l, correcting: false } : l))}
                              className="text-xs text-[var(--rx-t2)] hover:text-foreground px-2 py-1.5 transition-colors"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Clear button */}
            {transcriptLines.length > 0 && !isVoiceActive && (
              <div className="border-t border-[var(--rx-b1)] p-3 flex justify-end">
                <button
                  onClick={() => setTranscriptLines([])}
                  className="flex items-center gap-2 text-sm text-[var(--rx-t2)] hover:text-[var(--rx-rose)] transition-colors"
                >
                  <Trash2 size={14} /> Limpiar transcripción
                </button>
              </div>
            )}

            {voiceError && (
              <div className="px-5 py-3 bg-destructive/10 border-t border-destructive/20">
                <p className="text-xs text-[var(--rx-rose)]">{voiceError}</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AITrainingPage;
