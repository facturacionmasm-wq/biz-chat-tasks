import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import { supabase } from '@/integrations/supabase/client';
import { Phone, PhoneOff, Mic, Loader2, Volume2, PhoneForwarded, Users } from 'lucide-react';
import { toast } from 'sonner';

interface VoiceAgentProps {
  onCallEnd?: (callRecordId: string) => void;
}

const VoiceAgent = ({ onCallEnd }: VoiceAgentProps) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<Array<{ role: string; text: string; timestamp: number }>>([]);
  const [callDuration, setCallDuration] = useState(0);
  const [callStartTime, setCallStartTime] = useState<number | null>(null);
  const [showTransferPanel, setShowTransferPanel] = useState(false);
  const [employees, setEmployees] = useState<Array<{ user_id: string; name: string; phone: string | null }>>([]);
  const [transferring, setTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState<string | null>(null);

  const transcriptLinesRef = useRef<Array<{ role: string; text: string; timestamp: number }>>([]);
  const callRecordIdRef = useRef<string | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const onCallEndRef = useRef(onCallEnd);
  const updateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { onCallEndRef.current = onCallEnd; }, [onCallEnd]);

  const persistEvent = useCallback(async (eventType: string, eventData: Record<string, any> = {}) => {
    const recordId = callRecordIdRef.current;
    if (!recordId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) return;
      await supabase.from('call_events').insert({
        call_record_id: recordId,
        tenant_id: tenantId,
        event_type: eventType,
        event_data: { ...eventData, timestamp: new Date().toISOString() },
      });
    } catch (err) {
      console.error('Error persisting event:', err);
    }
  }, []);

  const addTranscriptLine = useCallback((role: string, text: string) => {
    const timestamp = callStartTimeRef.current ? Math.floor((Date.now() - callStartTimeRef.current) / 1000) : 0;
    const newLine = { role, text, timestamp };
    transcriptLinesRef.current = [...transcriptLinesRef.current, newLine];
    setTranscriptLines(prev => [...prev, newLine]);

    // Debounced transcript update to DB (every 2 seconds max)
    if (updateDebounceRef.current) clearTimeout(updateDebounceRef.current);
    updateDebounceRef.current = setTimeout(() => {
      if (callRecordIdRef.current) {
        const fullTranscript = transcriptLinesRef.current
          .map(l => `[${formatTimestamp(l.timestamp)}] ${l.role}: ${l.text}`)
          .join('\n');
        supabase
          .from('call_records')
          .update({ transcript: fullTranscript })
          .eq('id', callRecordIdRef.current)
          .then(({ error }) => {
            if (error) console.error('Error updating transcript:', error);
          });
      }
    }, 2000);
  }, []);

  const finalizeCall = useCallback(async () => {
    const recordId = callRecordIdRef.current;
    if (!recordId) return;

    const lines = transcriptLinesRef.current;
    const startTime = callStartTimeRef.current;
    const duration = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0;
    const fullTranscript = lines.map(l => `[${formatTimestamp(l.timestamp)}] ${l.role}: ${l.text}`).join('\n');

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

      // 2. Persist completed event
      await persistEvent('completed', { duration, transcript_length: fullTranscript.length });

      // 3. Generate AI summary if there's a transcript
      if (fullTranscript.trim()) {
        toast.info('Generando resumen con IA...');
        const { data: aiData, error: aiError } = await supabase.functions.invoke('ai-copilot', {
          body: { action: 'summarize_call', data: { transcript: fullTranscript, extractedData: {} } },
        });

        if (!aiError && aiData?.summary) {
          let extractedData: Record<string, any> = {};
          const jsonMatch = aiData.summary.match(/```json\n?([\s\S]*?)\n?```/);
          if (jsonMatch) {
            try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
          }

          const tags = extractedData.suggestedTags || [];

          await supabase
            .from('call_records')
            .update({
              summary_system: aiData.summary.replace(/```json[\s\S]*?```/, '').trim(),
              extracted_data: extractedData,
              tags,
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
  }, [persistEvent]);

  const conversation = useConversation({
    clientTools: {
      check_availability: async (params: { date: string; employee_name?: string }) => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return 'No autenticado';
          const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
          if (!tenantId) return 'No se encontró tenant';

          const { data, error } = await supabase.functions.invoke('voice-scheduling', {
            body: { action: 'check_availability', data: { tenant_id: tenantId, date: params.date } },
          });
          if (error) return `Error: ${error.message}`;
          addTranscriptLine('Sistema', `[Consulta disponibilidad: ${params.date}]`);
          return data.message + (data.slots?.length > 0 ? `. Horarios: ${data.slots.slice(0, 5).map((s: any) => new Date(s.start).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })).join(', ')}` : '');
        } catch (err: any) {
          return `Error al consultar disponibilidad: ${err.message}`;
        }
      },
      book_appointment: async (params: { contact_name: string; contact_phone?: string; date: string; time: string; service_type?: string }) => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return 'No autenticado';
          const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
          if (!tenantId) return 'No se encontró tenant';

          const startAt = `${params.date}T${params.time}:00`;
          const { data, error } = await supabase.functions.invoke('voice-scheduling', {
            body: {
              action: 'book_appointment',
              data: {
                tenant_id: tenantId,
                contact_name: params.contact_name,
                contact_phone: params.contact_phone || null,
                start_at: startAt,
                service_type: params.service_type || 'general',
                source: 'call',
                call_record_id: callRecordIdRef.current,
              },
            },
          });
          if (error) return `Error: ${error.message}`;
          addTranscriptLine('Sistema', `[Cita agendada: ${params.contact_name} - ${params.date} ${params.time}]`);
          return data.message || 'Cita agendada exitosamente';
        } catch (err: any) {
          return `Error al agendar: ${err.message}`;
        }
      },
      cancel_appointment: async (params: { appointment_id: string }) => {
        try {
          const { data, error } = await supabase.functions.invoke('voice-scheduling', {
            body: { action: 'cancel_appointment', data: { appointment_id: params.appointment_id } },
          });
          if (error) return `Error: ${error.message}`;
          addTranscriptLine('Sistema', `[Cita cancelada: ${params.appointment_id}]`);
          return data.message || 'Cita cancelada';
        } catch (err: any) {
          return `Error al cancelar: ${err.message}`;
        }
      },
      reschedule_appointment: async (params: { appointment_id: string; new_date: string; new_time: string }) => {
        try {
          const newStartAt = `${params.new_date}T${params.new_time}:00`;
          const { data, error } = await supabase.functions.invoke('voice-scheduling', {
            body: {
              action: 'reschedule_appointment',
              data: { appointment_id: params.appointment_id, new_start_at: newStartAt },
            },
          });
          if (error) return `Error: ${error.message}`;
          addTranscriptLine('Sistema', `[Cita reprogramada: ${params.new_date} ${params.new_time}]`);
          return data.message || 'Cita reprogramada';
        } catch (err: any) {
          return `Error al reprogramar: ${err.message}`;
        }
      },
      transfer_call: async (params: { employee_name: string; caller_phone: string }) => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return 'No autenticado';
          const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
          if (!tenantId) return 'No se encontró tenant';

          // Find employee by name
          const { data: profiles } = await supabase
            .from('profiles')
            .select('user_id, name, phone')
            .eq('tenant_id', tenantId)
            .eq('status', 'active');

          const match = (profiles || []).find(p =>
            p.name.toLowerCase().includes(params.employee_name.toLowerCase())
          );
          if (!match) return `No se encontró empleado con nombre "${params.employee_name}"`;
          if (!match.phone) return `${match.name} no tiene teléfono configurado`;

          addTranscriptLine('Sistema', `[Transfiriendo a ${match.name}...]`);

          const fullTranscript = transcriptLinesRef.current
            .map(l => `[${formatTimestamp(l.timestamp)}] ${l.role}: ${l.text}`)
            .join('\n');

          const { data, error } = await supabase.functions.invoke('call-transfer', {
            body: {
              target_user_id: match.user_id,
              caller_phone: params.caller_phone,
              transcript: fullTranscript,
              call_record_id: callRecordIdRef.current,
            },
          });

          if (error) return `Error: ${error.message}`;
          if (data?.error) return `Error: ${data.error}`;

          addTranscriptLine('Sistema', `[Llamada transferida a ${match.name}]`);
          return `Llamada transferida exitosamente a ${match.name}. El empleado recibirá un resumen de la conversación antes de conectarse.`;
        } catch (err: any) {
          return `Error al transferir: ${err.message}`;
        }
      },
    },
    onConnect: () => {
      setError(null);
      persistEvent('in_progress', { source: 'elevenlabs_webrtc' });
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
      persistEvent('failed', { error: String(err) });
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

  const formatTimestamp = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const startCall = useCallback(async () => {
    setIsConnecting(true);
    setError(null);
    setTranscriptLines([]);
    transcriptLinesRef.current = [];
    callRecordIdRef.current = null;

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Get user + tenant first
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) throw new Error('No se encontró tenant');

      // Create call record BEFORE getting token to ensure it exists
      const now = new Date().toISOString();
      const { data: callRow, error: insertError } = await supabase
        .from('call_records')
        .insert({
          tenant_id: tenantId,
          channel: 'voice_agent',
          status: 'initiated',
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

      // Persist initiated event
      await persistEvent('initiated', { user_email: user.email });

      // Get ElevenLabs token
      const { data, error: fnError } = await supabase.functions.invoke('elevenlabs-conversation-token');

      if (fnError || !data?.token) {
        throw new Error(fnError?.message || 'No se recibió token de ElevenLabs');
      }

      // Update status to ringing
      await supabase.from('call_records').update({ status: 'ringing' }).eq('id', callRow.id);
      await persistEvent('ringing');

      // Start the session
      await conversation.startSession({
        conversationToken: data.token,
        connectionType: 'webrtc',
      });

      toast.success('Llamada conectada');
    } catch (err: any) {
      console.error('Failed to start call:', err);
      setError(err.message || 'No se pudo iniciar la llamada');

      if (callRecordIdRef.current) {
        await supabase
          .from('call_records')
          .update({ status: 'failed', ended_at: new Date().toISOString() })
          .eq('id', callRecordIdRef.current);
        await persistEvent('failed', { error: err.message });
      }
    } finally {
      setIsConnecting(false);
    }
  }, [conversation, persistEvent]);

  const endCall = useCallback(async () => {
    await conversation.endSession();
  }, [conversation]);

  const loadEmployees = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: tenantId } = await supabase.rpc('get_user_tenant_id', { _user_id: user.id });
      if (!tenantId) return;
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, name, phone, whatsapp_number')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .neq('user_id', user.id);
      setEmployees((profiles || []).map(p => ({
        user_id: p.user_id,
        name: p.name,
        phone: p.phone || p.whatsapp_number,
      })));
    } catch (err) {
      console.error('Error loading employees:', err);
    }
  }, []);

  const handleTransfer = useCallback(async (targetUserId: string, callerPhone: string) => {
    setTransferring(true);
    setTransferStatus('Generando resumen con IA...');
    try {
      const fullTranscript = transcriptLinesRef.current
        .map(l => `[${formatTimestamp(l.timestamp)}] ${l.role}: ${l.text}`)
        .join('\n');

      setTransferStatus('Iniciando transferencia...');
      const { data, error } = await supabase.functions.invoke('call-transfer', {
        body: {
          target_user_id: targetUserId,
          caller_phone: callerPhone,
          transcript: fullTranscript,
          call_record_id: callRecordIdRef.current,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setTransferStatus(`✓ Transferido a ${data.target_name}`);
      addTranscriptLine('Sistema', `[Llamada transferida a ${data.target_name}]`);
      toast.success(`Transferencia iniciada a ${data.target_name}`);

      // End the ElevenLabs session after transfer
      setTimeout(() => {
        conversation.endSession();
        setShowTransferPanel(false);
        setTransferStatus(null);
      }, 2000);
    } catch (err: any) {
      setTransferStatus(null);
      toast.error(err.message || 'Error al transferir llamada');
    } finally {
      setTransferring(false);
    }
  }, [conversation, addTranscriptLine]);

  const isActive = conversation.status === 'connected';

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
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
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowTransferPanel(!showTransferPanel); if (!showTransferPanel) loadEmployees(); }}
                disabled={transferring}
                className="flex items-center gap-1.5 bg-accent text-accent-foreground text-sm px-3 py-2 rounded-lg hover:opacity-90 transition-opacity"
                title="Transferir llamada"
              >
                <PhoneForwarded size={14} /> Transferir
              </button>
              <button
                onClick={endCall}
                className="flex items-center gap-2 bg-destructive text-destructive-foreground text-sm px-4 py-2 rounded-lg hover:opacity-90 transition-opacity"
              >
                <PhoneOff size={14} /> Finalizar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Transfer Panel */}
      {showTransferPanel && isActive && (
        <div className="border-b border-border bg-accent/10 px-5 py-3 space-y-2 animate-fade-in">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Users size={14} className="text-primary" />
            Transferir a empleado
          </div>
          {transferStatus && (
            <p className="text-xs text-primary font-medium">{transferStatus}</p>
          )}
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {employees.length === 0 && (
              <p className="text-xs text-muted-foreground">No hay empleados disponibles</p>
            )}
            {employees.map(emp => (
              <div
                key={emp.user_id}
                className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">
                    {emp.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-foreground">{emp.name}</p>
                    <p className="text-[10px] text-muted-foreground">{emp.phone || 'Sin teléfono'}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    const callerPhone = prompt('Número del cliente para conectar (ej: +525512345678):');
                    if (callerPhone) handleTransfer(emp.user_id, callerPhone);
                  }}
                  disabled={!emp.phone || transferring}
                  className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-40 flex items-center gap-1"
                >
                  {transferring ? <Loader2 size={12} className="animate-spin" /> : <PhoneForwarded size={12} />}
                  Transferir
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(isActive || transcriptLines.length > 0) && (
        <div className="p-4 max-h-80 overflow-y-auto scrollbar-thin space-y-2">
          {transcriptLines.length === 0 && isActive && (
            <p className="text-sm text-muted-foreground text-center py-4">Esperando conversación...</p>
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

      {error && (
        <div className="px-5 py-3 bg-destructive/10 border-t border-destructive/20">
          <p className="text-xs text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
};

export default VoiceAgent;
