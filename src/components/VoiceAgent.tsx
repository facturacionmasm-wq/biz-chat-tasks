import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { supabase } from '@/integrations/supabase/client';
import { Phone, PhoneOff, Mic, Loader2, Volume2 } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceAgentProps {
  onCallEnd?: (callRecordId: string) => void;
}

const VoiceAgent = ({ onCallEnd }: VoiceAgentProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<Array<{ role: string; text: string }>>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);

  // Refs to avoid stale closures in callbacks
  const transcriptLinesRef = useRef<Array<{ role: string; text: string }>>([]);
  const callRecordIdRef = useRef<string | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const onCallEndRef = useRef(onCallEnd);
  
  useEffect(() => { onCallEndRef.current = onCallEnd; }, [onCallEnd]);

  const addTranscriptLine = useCallback((role: string, text: string) => {
    const newLine = { role, text };
    transcriptLinesRef.current = [...transcriptLinesRef.current, newLine];
    setTranscriptLines(prev => [...prev, newLine]);

    // Update transcript in DB in real-time (debounced via the append)
    if (callRecordIdRef.current) {
      const fullTranscript = transcriptLinesRef.current
        .map(l => `${l.role}: ${l.text}`)
        .join('\n');
      supabase
        .from('call_records')
        .update({ transcript: fullTranscript })
        .eq('id', callRecordIdRef.current)
        .then(({ error }) => {
          if (error) console.error('Error updating transcript:', error);
        });
    }
  }, []);

  const finalizeCall = useCallback(async () => {
    const recordId = callRecordIdRef.current;
    if (!recordId) return;

    const lines = transcriptLinesRef.current;
    const startTime = callStartTimeRef.current;
    const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const fullTranscript = lines.map(l => `${l.role}: ${l.text}`).join('\n');

    try {
      // 1. Update call record with final data
      await supabase
        .from('call_records')
        .update({
          status: 'completed',
          ended_at: new Date().toISOString(),
          duration,
          transcript: fullTranscript,
        })
        .eq('id', recordId);

      // 2. Generate AI summary if there's a transcript
      if (fullTranscript.trim()) {
        toast.info('Generando resumen con IA...');
        const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-copilot', {
          body: { action: 'summarize_call', data: { transcript: fullTranscript, extractedData: {} } },
        });

        if (!aiError && aiData?.summary) {
          // Extract JSON data from summary
          let extractedData = {};
          const jsonMatch = aiData.summary.match(/```json\n?([\s\S]*?)\n?```/);
          if (jsonMatch) {
            try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
          }

          await supabase
            .from('call_records')
            .update({
              summary_system: aiData.summary.replace(/```json[\s\S]*?```/, '').trim(),
              extracted_data: extractedData,
            })
            .eq('id', recordId);

          toast.success('Resumen generado y guardado');
        }
      }

      onCallEndRef.current?.(recordId);
    } catch (err) {
      console.error('Error finalizing call:', err);
      toast.error('Error al finalizar la llamada');
    }
  }, []);

  const conversation = useConversation({
    onConnect: () => {
      setError(null);
    },
    onDisconnect: () => {
      finalizeCall();
      setCallStartTime(null);
      setCallDuration(0);
    },
    onMessage: (message: any) => {
      if (message.type === 'user_transcript') {
        const text = message.user_transcription_event?.user_transcript;
        if (text) addTranscriptLine('Usuario', text);
      }
      if (message.type === 'agent_response') {
        const text = message.agent_response_event?.agent_response;
        if (text) addTranscriptLine('Agente', text);
      }
    },
    onError: (err) => {
      console.error('Voice agent error:', err);
      setError('Error de conexión con el agente de voz');
    },
  });

  // Timer
  useEffect(() => {
    if (!callStartTime) return;
    const interval = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callStartTime]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const startCall = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setTranscriptLines([]);
    transcriptLinesRef.current = [];
    callRecordIdRef.current = null;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { data, error: fnError } = await supabase.functions.invoke(
        'elevenlabs-conversation-token'
      );

      if (fnError || !data?.token) {
        throw new Error(fnError?.message || 'No se recibió token');
      }

      // Get tenant ID
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', {
        _user_id: user.id,
      });

      if (!tenantId) throw new Error('No se encontró tenant');

      // Create call record in DB immediately
      const now = new Date().toISOString();
      const { data: callRow, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: tenantId,
          channel: 'voice_agent',
          status: 'in_progress',
          started_at: now,
          from_number: 'Voice Agent',
          to_number: user.email || 'Usuario',
          created_by: user.id,
          agent_user_id: user.id,
        })
        .select('id')
        .single();

      if (insertError || !callRow) {
        throw new Error(insertError?.message || 'Error al crear registro de llamada');
      }

      callRecordIdRef.current = callRow.id;
      const startTime = Date.now();
      callStartTimeRef.current = startTime;
      setCallStartTime(startTime);

      toast.success('Llamada registrada en base de datos');

      await conversation.startSession({
        conversationToken: data.token,
        connectionType: 'webrtc',
      });
    } catch (err: any) {
      console.error('Failed to start call:', err);
      setError(err.message || 'No se pudo iniciar la llamada');

      // Mark as failed if record was created
      if (callRecordIdRef.current) {
        await supabase
          .from('call_records')
          .update({ status: 'failed', ended_at: new Date().toISOString() })
          .eq('id', callRecordIdRef.current);
      }
    } finally {
      setIsConnecting(false);
    }
  }, [conversation]);

  const endCall = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const isActive = conversation.status === 'connected';

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className={`px-5 py-4 flex items-center justify-between ${isActive ? 'bg-primary/10 border-b border-primary/20' : 'border-b border-border'}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isActive ? 'bg-primary text-primary-foreground animate-pulse' : 'bg-muted text-muted-foreground'}`}>
            <Phone size={18} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {isActive ? 'Llamada en curso' : 'Voice Agent ElevenLabs'}
            </h3>
            <p className="text-xs text-muted-foreground">
              {isActive ? formatTime(callDuration) : 'WebRTC · Transcripción en tiempo real'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isActive && (
            <div className="flex items-center gap-2 mr-2">
              {conversation.isSpeaking ? (
                <span className="flex items-center gap-1 text-xs text-primary">
                  <Volume2 size={14} className="animate-pulse" /> Hablando
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Mic size={14} /> Escuchando
                </span>
              )}
            </div>
          )}

          {!isActive ? (
            <button
              onClick={startCall}
              disabled={isConnecting}
              className="flex items-center gap-2 bg-primary text-primary-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isConnecting ? (
                <><Loader2 size={14} className="animate-spin" /> Conectando...</>
              ) : (
                <><Phone size={14} /> Iniciar llamada</>
              )}
            </button>
          ) : (
            <button
              onClick={endCall}
              className="flex items-center gap-2 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
            >
              <PhoneOff size={14} /> Finalizar
            </button>
          )}
        </div>
      </div>

      {/* Transcript */}
      {(isActive || transcriptLines.length > 0) && (
        <div className="p-4 max-h-80 overflow-y-auto scrollbar-thin space-y-2">
          {transcriptLines.length === 0 && isActive && (
            <p className="text-sm text-muted-foreground text-center py-4">
              Esperando conversación...
            </p>
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
      )}

      {/* Error */}
      {error && (
        <div className="px-5 py-3 bg-destructive/10 border-t border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
};

export default VoiceAgent;
