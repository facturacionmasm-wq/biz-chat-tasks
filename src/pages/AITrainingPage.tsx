import { useState, useCallback } from 'react';
import { Bot, Send, Loader2, Phone, MessageSquare, Trash2, Volume2, Mic } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useConversation } from '@elevenlabs/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

const AITrainingPage = () => {
  // --- WhatsApp AI Agent state ---
  const [waMessages, setWaMessages] = useState<ChatMessage[]>([]);
  const [waInput, setWaInput] = useState('');
  const [waLoading, setWaLoading] = useState(false);

  // --- ElevenLabs Voice Agent state ---
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<Array<{ role: string; text: string }>>([]);

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

  // --- WhatsApp AI Agent ---
  const sendWaMessage = async () => {
    if (!waInput.trim() || waLoading) return;
    const userMsg: ChatMessage = { role: 'user', content: waInput.trim(), timestamp: new Date() };
    setWaMessages(prev => [...prev, userMsg]);
    setWaInput('');
    setWaLoading(true);

    try {
      const messagesToSend = [...waMessages, userMsg].map(m => ({
        direction: m.role === 'user' ? 'in' : 'out',
        body: m.content,
      }));

      const { data, error } = await supabase.functions.invoke('ai-copilot', {
        body: {
          action: 'extract_whatsapp_intent',
          data: { messages: messagesToSend, knowledgeContext: '' },
        },
      });

      if (error) throw error;

      const reply = data?.response || 'Sin respuesta del agente.';
      setWaMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: new Date() }]);
    } catch (err: any) {
      setWaMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message || 'No se pudo obtener respuesta'}`, timestamp: new Date() },
      ]);
    } finally {
      setWaLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Bot size={22} className="text-primary" />
          Entrenamiento IA
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Prueba y entrena a tus agentes de IA haciendo preguntas de práctica. Verifica que las respuestas sean correctas y ajusta el Knowledge Hub según sea necesario.
        </p>
      </div>

      <Tabs defaultValue="whatsapp" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="whatsapp" className="gap-2">
            <MessageSquare size={14} /> Agente WhatsApp
          </TabsTrigger>
          <TabsTrigger value="voice" className="gap-2">
            <Phone size={14} /> Agente de Voz (ElevenLabs)
          </TabsTrigger>
        </TabsList>

        {/* WhatsApp AI Tab */}
        <TabsContent value="whatsapp" className="flex-1 flex flex-col min-h-0 mt-4">
          <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
            {/* Chat messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {waMessages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <MessageSquare size={40} className="text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Escribe una pregunta como si fueras un cliente por WhatsApp</p>
                  <p className="text-xs text-muted-foreground mt-1">El agente responderá usando tu Knowledge Hub</p>
                </div>
              )}
              {waMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[75%] px-3.5 py-2.5 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted text-foreground rounded-bl-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                      {msg.timestamp.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {waLoading && (
                <div className="flex justify-start">
                  <div className="bg-muted px-4 py-3 rounded-2xl rounded-bl-md">
                    <Loader2 size={16} className="animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border p-3 flex items-center gap-2">
              <button
                onClick={() => { setWaMessages([]); setWaInput(''); }}
                className="p-2 text-muted-foreground hover:text-destructive transition-colors rounded-md hover:bg-destructive/10"
                title="Limpiar conversación"
              >
                <Trash2 size={16} />
              </button>
              <input
                value={waInput}
                onChange={e => setWaInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendWaMessage()}
                placeholder="Escribe una pregunta de prueba..."
                className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary"
                disabled={waLoading}
              />
              <button
                onClick={sendWaMessage}
                disabled={waLoading || !waInput.trim()}
                className="p-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </TabsContent>

        {/* ElevenLabs Voice Tab */}
        <TabsContent value="voice" className="flex-1 flex flex-col min-h-0 mt-4">
          <div className="flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden">
            {/* Voice controls */}
            <div className={`px-5 py-4 flex items-center justify-between ${isVoiceActive ? 'bg-primary/10 border-b border-primary/20' : 'border-b border-border'}`}>
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isVoiceActive ? 'bg-primary text-primary-foreground animate-pulse' : 'bg-muted text-muted-foreground'}`}>
                  <Phone size={18} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isVoiceActive ? 'Llamada de prueba en curso' : 'Probar Voice Agent'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
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
                  <span className="flex items-center gap-1 text-xs text-primary mr-2">
                    {conversation.isSpeaking ? <Volume2 size={14} className="animate-pulse" /> : <Mic size={14} />}
                  </span>
                )}
                {!isVoiceActive ? (
                  <button
                    onClick={startVoiceCall}
                    disabled={isConnecting}
                    className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    {isConnecting ? <><Loader2 size={14} className="animate-spin" /> Conectando...</> : <><Phone size={14} /> Iniciar prueba</>}
                  </button>
                ) : (
                  <button onClick={endVoiceCall} className="flex items-center gap-2 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90">
                    <Phone size={14} /> Finalizar
                  </button>
                )}
              </div>
            </div>

            {/* Transcript */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
              {transcriptLines.length === 0 && !isVoiceActive && (
                <div className="flex flex-col items-center justify-center h-full text-center py-12">
                  <Phone size={40} className="text-muted-foreground/30 mb-3" />
                  <p className="text-sm text-muted-foreground">Inicia una llamada de prueba con el Voice Agent</p>
                  <p className="text-xs text-muted-foreground mt-1">La transcripción aparecerá aquí en tiempo real</p>
                </div>
              )}
              {transcriptLines.length === 0 && isVoiceActive && (
                <p className="text-sm text-muted-foreground text-center py-8">Esperando conversación...</p>
              )}
              {transcriptLines.map((line, i) => (
                <div
                  key={i}
                  className={`px-3 py-2 rounded-lg text-sm ${
                    line.role === 'Agente'
                      ? 'bg-primary/5 border-l-2 border-primary'
                      : 'bg-muted/50 border-l-2 border-muted-foreground/30'
                  }`}
                >
                  <span className="text-xs font-semibold text-muted-foreground">{line.role}:</span>
                  <p className="text-foreground mt-0.5">{line.text}</p>
                </div>
              ))}
            </div>

            {/* Clear button */}
            {transcriptLines.length > 0 && !isVoiceActive && (
              <div className="border-t border-border p-3 flex justify-end">
                <button
                  onClick={() => setTranscriptLines([])}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 size={14} /> Limpiar transcripción
                </button>
              </div>
            )}

            {voiceError && (
              <div className="px-5 py-3 bg-destructive/10 border-t border-destructive/20">
                <p className="text-xs text-destructive">{voiceError}</p>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AITrainingPage;
