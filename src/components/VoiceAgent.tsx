import { useState, useCallback, useEffect } from 'react';
import { useConversation } from '@elevenlabs/react';
import { supabase } from '@/integrations/supabase/client';
import { Phone, PhoneOff, Mic, MicOff, Loader2, Volume2 } from 'lucide-react';

interface VoiceAgentProps {
  onCallEnd?: (transcript: string) => void;
}

const VoiceAgent = ({ onCallEnd }: VoiceAgentProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<Array<{ role: string; text: string }>>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);

  const conversation = useConversation({
    onConnect: () => {
      setCallStartTime(Date.now());
      setError(null);
    },
    onDisconnect: () => {
      if (transcriptLines.length > 0 && onCallEnd) {
        const fullTranscript = transcriptLines
          .map(l => `${l.role}: ${l.text}`)
          .join('\n');
        onCallEnd(fullTranscript);
      }
      setCallStartTime(null);
      setCallDuration(0);
    },
    onMessage: (message: any) => {
      if (message.type === 'user_transcript') {
        const text = message.user_transcription_event?.user_transcript;
        if (text) {
          setTranscriptLines(prev => [...prev, { role: 'Usuario', text }]);
        }
      }
      if (message.type === 'agent_response') {
        const text = message.agent_response_event?.agent_response;
        if (text) {
          setTranscriptLines(prev => [...prev, { role: 'Agente', text }]);
        }
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
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const { data, error: fnError } = await supabase.functions.invoke(
        'elevenlabs-conversation-token'
      );

      if (fnError || !data?.token) {
        throw new Error(fnError?.message || 'No se recibió token');
      }

      await conversation.startSession({
        conversationToken: data.token,
        connectionType: 'webrtc',
      });
    } catch (err: any) {
      console.error('Failed to start call:', err);
      setError(err.message || 'No se pudo iniciar la llamada');
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
