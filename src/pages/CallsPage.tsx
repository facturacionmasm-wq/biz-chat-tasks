import { useState, useCallback, useEffect, useRef } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOff, Clock, User, Tag, Play, Pause, CalendarPlus, MessageSquare, ChevronRight, Search, ArrowLeft, CheckCircle2, Edit3, Save, RefreshCw, Activity, Download, Volume2, AlertTriangle, TrendingUp, Hash, Briefcase, Loader2, BarChart3, Shield } from 'lucide-react';
import { type CallRecord, type CallEvent, type TranscriptEntry } from '@/data/mockCallsData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import VoiceAgent from '@/components/VoiceAgent';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import CallAnalytics from '@/components/calls/CallAnalytics';
import CallObservability from '@/components/calls/CallObservability';
import ManualCallDialog from '@/components/calls/ManualCallDialog';
import { usePaymentGate } from '@/hooks/usePaymentGate';
import PaymentGateCard from '@/components/PaymentGateCard';

const parseTranscriptStructured = (transcript: string): TranscriptEntry[] => {
  if (!transcript) return [];
  return transcript.split('\n').filter(Boolean).map(line => {
    const tsMatch = line.match(/^\[(\d{2}):(\d{2})\]\s*/);
    let timestamp = 0;
    let rest = line;
    if (tsMatch) {
      timestamp = parseInt(tsMatch[1]) * 60 + parseInt(tsMatch[2]);
      rest = line.slice(tsMatch[0].length);
    }
    const roleMatch = rest.match(/^([\w\s]+?):\s*/);
    const role = roleMatch ? roleMatch[1] : 'Sistema';
    const text = roleMatch ? rest.slice(roleMatch[0].length) : rest;
    return { role, text, timestamp };
  });
};

const dbRowToCallRecord = (row: any): CallRecord => ({
  id: row.id,
  externalCallId: row.external_call_id || '',
  fromNumber: row.from_number || '',
  toNumber: row.to_number || '',
  startedAt: new Date(row.started_at || row.created_at),
  endedAt: new Date(row.ended_at || row.created_at),
  duration: row.duration || 0,
  status: row.status as CallRecord['status'],
  channel: row.channel || 'voice_agent',
  tags: row.tags || [],
  agentName: 'Voice Agent',
  transcript: row.transcript || '',
  transcriptStructured: parseTranscriptStructured(row.transcript || ''),
  summarySystem: row.summary_system || '',
  summaryHuman: row.summary_human || null,
  extractedData: (row.extracted_data as CallRecord['extractedData']) || {},
  audioUrl: row.audio_url || null,
});

const dbRowToCallEvent = (row: any): CallEvent => ({
  id: row.id,
  callRecordId: row.call_record_id,
  tenantId: row.tenant_id,
  eventType: row.event_type,
  eventData: row.event_data || {},
  twilioCallSid: row.twilio_call_sid,
  createdAt: new Date(row.created_at),
});

const statusConfig: Record<string, { icon: any; label: string; className: string }> = {
  completed: { icon: Phone, label: 'Completada', className: 'text-success bg-success/10' },
  in_progress: { icon: Phone, label: 'En curso', className: 'text-primary bg-primary/10 animate-pulse' },
  initiated: { icon: Phone, label: 'Iniciada', className: 'text-primary bg-primary/10' },
  ringing: { icon: PhoneIncoming, label: 'Sonando', className: 'text-warning bg-warning/10 animate-pulse' },
  missed: { icon: PhoneMissed, label: 'Perdida', className: 'text-destructive bg-destructive/10' },
  no_answer: { icon: PhoneMissed, label: 'Sin respuesta', className: 'text-destructive bg-destructive/10' },
  busy: { icon: PhoneOff, label: 'Ocupado', className: 'text-warning bg-warning/10' },
  failed: { icon: PhoneOff, label: 'Fallida', className: 'text-destructive bg-destructive/10' },
  canceled: { icon: PhoneOff, label: 'Cancelada', className: 'text-muted-foreground bg-muted' },
  voicemail: { icon: Phone, label: 'Buzón', className: 'text-muted-foreground bg-muted' },
  pending: { icon: Clock, label: 'Pendiente', className: 'text-muted-foreground bg-muted' },
};

const formatDuration = (seconds: number) => {
  if (seconds === 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// Audio Player Component
const AudioPlayer = ({ url }: { url: string }) => {
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audioEl] = useState(() => new Audio(url));

  useEffect(() => {
    const onTime = () => setProgress(audioEl.currentTime / (audioEl.duration || 1) * 100);
    const onEnd = () => { setPlaying(false); setProgress(0); };
    audioEl.addEventListener('timeupdate', onTime);
    audioEl.addEventListener('ended', onEnd);
    return () => {
      audioEl.removeEventListener('timeupdate', onTime);
      audioEl.removeEventListener('ended', onEnd);
      audioEl.pause();
    };
  }, [audioEl]);

  const toggle = () => {
    if (playing) { audioEl.pause(); } else { audioEl.play(); }
    setPlaying(!playing);
  };

  return (
    <div className="flex items-center gap-3 bg-muted/50 rounded-lg px-3 py-2">
      <button onClick={toggle} className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex-1 h-1.5 bg-border rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
      </div>
      <a href={url} download className="text-muted-foreground hover:text-foreground">
        <Download size={14} />
      </a>
    </div>
  );
};

// Event Timeline Component
const EventTimeline = ({ events }: { events: CallEvent[] }) => {
  if (events.length === 0) return (
    <p className="text-xs text-muted-foreground text-center py-4">Sin eventos registrados</p>
  );

  return (
    <div className="space-y-0">
      {events.map((event, i) => {
        const cfg = statusConfig[event.eventType] || statusConfig.pending;
        const Icon = cfg.icon;
        return (
          <div key={event.id} className="flex items-start gap-3 py-2">
            <div className="flex flex-col items-center">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${cfg.className}`}>
                <Icon size={10} />
              </div>
              {i < events.length - 1 && <div className="w-px h-full min-h-[16px] bg-border" />}
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-foreground">{cfg.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  {format(event.createdAt, 'HH:mm:ss', { locale: es })}
                </span>
              </div>
              {event.twilioCallSid && (
                <p className="text-[10px] text-muted-foreground font-mono truncate">{event.twilioCallSid}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

const CallsPage = () => {
  const { hasPaymentMethod, loading: paymentLoading, redirecting, redirectToSetup } = usePaymentGate();
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState(false);
  const [humanSummary, setHumanSummary] = useState('');
  const [dbCalls, setDbCalls] = useState<CallRecord[]>([]);
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [callAppointments, setCallAppointments] = useState<any[]>([]);
  const [callJobs, setCallJobs] = useState<any[]>([]);
  const [allJobs, setAllJobs] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'calls' | 'analytics' | 'observability'>('calls');
  const isMobile = useIsMobile();
  const lastToastRef = useRef<string | null>(null);

  const loadDbCalls = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('call_records')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && data) {
        setDbCalls(data.map(dbRowToCallRecord));
      }
    } catch (err) {
      console.error('Error loading calls:', err);
    }
  }, []);

  const loadCallEvents = useCallback(async (callId: string) => {
    const { data, error } = await supabase
      .from('call_events')
      .select('*')
      .eq('call_record_id', callId)
      .order('created_at', { ascending: true });
    if (!error && data) {
      setCallEvents(data.map(dbRowToCallEvent));
    }
  }, []);

  useEffect(() => { loadDbCalls(); }, [loadDbCalls]);

  // Realtime: call_records changes
  useEffect(() => {
    const channel = supabase
      .channel('call_records_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'call_records' }, (payload) => {
        loadDbCalls();
        if (selectedCall && payload.new && (payload.new as any).id === selectedCall.id) {
          setSelectedCall(dbRowToCallRecord(payload.new));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadDbCalls, selectedCall]);

  // Realtime: call_jobs pipeline notifications
  useEffect(() => {
    const channel = supabase
      .channel('call_jobs_realtime')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'call_jobs' }, (payload) => {
        const job = payload.new as any;
        const toastKey = `${job.id}-${job.status}`;
        if (lastToastRef.current === toastKey) return;
        lastToastRef.current = toastKey;

        const labels: Record<string, string> = {
          fetch_recording: 'Grabación',
          transcribe_call: 'Transcripción',
          summarize_call: 'Resumen IA',
          extract_appointment: 'Extracción de cita',
        };
        const label = labels[job.job_type] || job.job_type;

        if (job.status === 'success') {
          toast.success(`✅ ${label} completado`, { duration: 3000 });
        } else if (job.status === 'error') {
          toast.error(`❌ ${label} falló: ${job.last_error?.substring(0, 60) || 'Error'}`, { duration: 5000 });
        }

        // Refresh allJobs for analytics
        loadAllJobs();

        // Refresh selected call jobs if viewing
        if (selectedCall && job.call_id === selectedCall.id) {
          supabase.from('call_jobs').select('id, job_type, status, attempts, last_error, updated_at')
            .eq('call_id', selectedCall.id)
            .order('created_at', { ascending: true })
            .then(({ data }) => setCallJobs(data || []));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedCall]);

  // Load all jobs for analytics
  const loadAllJobs = useCallback(async () => {
    const { data } = await supabase.from('call_jobs')
      .select('id, job_type, status, attempts, last_error, updated_at')
      .order('created_at', { ascending: false })
      .limit(500);
    setAllJobs(data || []);
  }, []);

  useEffect(() => { loadAllJobs(); }, [loadAllJobs]);

  // Load appointments and jobs for selected call
  useEffect(() => {
    if (!selectedCall) return;
    loadCallEvents(selectedCall.id);

    // Load associated appointments
    supabase.from('appointments').select('id, contact_name, start_at, end_at, status, service_type')
      .eq('call_record_id', selectedCall.id)
      .then(({ data }) => setCallAppointments(data || []));

    // Load jobs for this call
    supabase.from('call_jobs').select('id, job_type, status, attempts, last_error, updated_at')
      .eq('call_id', selectedCall.id)
      .order('created_at', { ascending: true })
      .then(({ data }) => setCallJobs(data || []));

    const channel = supabase
      .channel(`call_events_${selectedCall.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'call_events',
        filter: `call_record_id=eq.${selectedCall.id}`,
      }, (payload) => {
        if (payload.new) {
          setCallEvents(prev => [...prev, dbRowToCallEvent(payload.new)]);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedCall?.id, loadCallEvents]);

  const handleCallEnd = useCallback(async (_callRecordId: string) => {
    await loadDbCalls();
    toast.success('Llamada finalizada y guardada');
  }, [loadDbCalls]);

  const filtered = dbCalls.filter(c =>
    (!statusFilter || c.status === statusFilter) &&
    (!searchQuery || c.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
     c.fromNumber.includes(searchQuery) || c.toNumber.includes(searchQuery) ||
     (c.extractedData.contactName || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
     c.transcript.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const activeCalls = dbCalls.filter(c => ['in_progress', 'ringing', 'initiated'].includes(c.status));

  const stats = {
    total: dbCalls.length,
    completed: dbCalls.filter(c => c.status === 'completed').length,
    missed: dbCalls.filter(c => ['missed', 'no_answer'].includes(c.status)).length,
    avgDuration: dbCalls.filter(c => c.duration > 0).length > 0
      ? Math.round(dbCalls.filter(c => c.duration > 0).reduce((s, c) => s + c.duration, 0) / dbCalls.filter(c => c.duration > 0).length)
      : 0,
  };

  const handleSaveSummary = async () => {
    if (!selectedCall) return;
    const { error } = await supabase
      .from('call_records')
      .update({ summary_human: humanSummary })
      .eq('id', selectedCall.id);
    if (error) {
      toast.error('Error al guardar resumen');
    } else {
      toast.success('Resumen guardado');
      setSelectedCall({ ...selectedCall, summaryHuman: humanSummary });
      setEditingSummary(false);
      loadDbCalls();
    }
  };

  const retryFailedJob = async (jobId: string) => {
    const { error } = await supabase
      .from('call_jobs')
      .update({ status: 'queued', last_error: null, run_after: new Date().toISOString() })
      .eq('id', jobId);
    if (error) {
      toast.error('Error al reintentar job');
    } else {
      toast.success('Job re-encolado');
      // Trigger worker
      supabase.functions.invoke('call-job-worker', { body: { trigger: 'manual_retry' } }).catch(() => {});
      // Refresh jobs
      if (selectedCall) {
        supabase.from('call_jobs').select('id, job_type, status, attempts, last_error, updated_at')
          .eq('call_id', selectedCall.id)
          .order('created_at', { ascending: true })
          .then(({ data }) => setCallJobs(data || []));
      }
    }
  };

  const regenerateSummary = async () => {
    if (!selectedCall?.transcript) return;
    toast.info('Regenerando resumen con IA...');
    const { data, error } = await supabase.functions.invoke('ai-copilot', {
      body: { action: 'summarize_call', data: { transcript: selectedCall.transcript, extractedData: selectedCall.extractedData } },
    });
    if (!error && data?.summary) {
      let extractedData: Record<string, any> = {};
      const jsonMatch = data.summary.match(/```json\n?([\s\S]*?)\n?```/);
      if (jsonMatch) {
        try { extractedData = JSON.parse(jsonMatch[1]); } catch {}
      }
      const cleanSummary = data.summary.replace(/```json[\s\S]*?```/, '').trim();
      const tags = extractedData.suggestedTags || [];
      await supabase.from('call_records').update({
        summary_system: cleanSummary,
        extracted_data: extractedData,
        tags,
      }).eq('id', selectedCall.id);
      setSelectedCall({ ...selectedCall, summarySystem: cleanSummary, extractedData: extractedData as any, tags });
      toast.success('Resumen regenerado');
      loadDbCalls();
    } else {
      toast.error('Error al regenerar resumen');
    }
  };

  // ===== CALL DETAIL VIEW =====
  if (selectedCall) {
    const sc = statusConfig[selectedCall.status] || statusConfig.pending;
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="shrink-0 border-b border-border p-4 sm:p-5 bg-card">
          <button onClick={() => { setSelectedCall(null); setEditingSummary(false); setCallEvents([]); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
            <ArrowLeft size={14} /> Volver
          </button>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h2 className="text-lg sm:text-xl font-bold text-foreground">{selectedCall.extractedData.contactName || selectedCall.fromNumber || 'Llamada'}</h2>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.className}`}>{sc.label}</span>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><PhoneIncoming size={12} /> {selectedCall.fromNumber}</span>
                <span className="flex items-center gap-1"><Clock size={12} /> {formatDuration(selectedCall.duration)}</span>
                <span className="flex items-center gap-1"><User size={12} /> {selectedCall.agentName}</span>
                <span>{format(selectedCall.startedAt, "d MMM yyyy 'a las' HH:mm", { locale: es })}</span>
                {selectedCall.externalCallId && (
                  <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{selectedCall.externalCallId.substring(0, 16)}...</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs sm:text-sm px-3 py-2 rounded-lg hover:opacity-90">
                <CalendarPlus size={14} /> Agendar
              </button>
              <button className="flex items-center gap-1.5 bg-success text-success-foreground text-xs sm:text-sm px-3 py-2 rounded-lg hover:opacity-90">
                <MessageSquare size={14} /> WhatsApp
              </button>
            </div>
          </div>
          {selectedCall.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {selectedCall.tags.map(tag => (
                <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Tag size={10} /> {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 sm:p-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 max-w-7xl mx-auto">
            {/* Left column: Summary + Audio + Transcript */}
            <div className="lg:col-span-2 space-y-4 sm:space-y-5">
              {/* Audio Player */}
              {selectedCall.audioUrl && (
                <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Volume2 size={16} /> Grabación
                  </h3>
                  <AudioPlayer url={selectedCall.audioUrl} />
                </div>
              )}

              {/* AI Summary */}
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-foreground">📝 Resumen IA</h3>
                  <div className="flex items-center gap-2">
                    {selectedCall.summaryHuman && (
                      <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 size={10} /> Editado
                      </span>
                    )}
                    {selectedCall.transcript && (
                      <button onClick={regenerateSummary} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                        <RefreshCw size={10} /> Regenerar
                      </button>
                    )}
                    <button
                      onClick={() => { setEditingSummary(!editingSummary); setHumanSummary(selectedCall.summaryHuman || selectedCall.summarySystem); }}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <Edit3 size={10} /> {editingSummary ? 'Cancelar' : 'Editar'}
                    </button>
                  </div>
                </div>
                {editingSummary ? (
                  <div>
                    <textarea value={humanSummary} onChange={e => setHumanSummary(e.target.value)} className="w-full bg-secondary rounded-lg px-3 py-2 text-sm outline-none border border-border focus:border-primary min-h-[200px] resize-y" />
                    <button onClick={handleSaveSummary} className="mt-2 flex items-center gap-1 bg-primary text-primary-foreground text-sm px-3 py-1.5 rounded-lg">
                      <Save size={12} /> Aprobar resumen
                    </button>
                  </div>
                ) : (
                  <div className="prose prose-sm text-foreground whitespace-pre-line text-sm leading-relaxed">
                    {selectedCall.summaryHuman || selectedCall.summarySystem || (
                      <div className="text-center py-6 text-muted-foreground">
                        <MessageSquare size={24} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm font-medium">Sin resumen disponible</p>
                        <p className="text-xs mt-1">El resumen se generará automáticamente al finalizar la llamada y completar la transcripción.</p>
                        {selectedCall.transcript && (
                          <button onClick={regenerateSummary} className="mt-3 inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs px-3 py-1.5 rounded-lg hover:opacity-90">
                            <RefreshCw size={12} /> Generar resumen ahora
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Transcript with search */}
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-foreground">💬 Transcripción</h3>
                  {selectedCall.transcript && (
                    <div className="flex items-center gap-2 bg-muted rounded-lg px-2 py-1">
                      <Search size={12} className="text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Buscar en transcripción..."
                        value={transcriptSearch}
                        onChange={e => setTranscriptSearch(e.target.value)}
                        className="bg-transparent text-xs outline-none w-40 text-foreground placeholder:text-muted-foreground"
                      />
                      {transcriptSearch && (
                        <span className="text-[10px] text-muted-foreground">
                          {selectedCall.transcriptStructured.filter(e => e.text.toLowerCase().includes(transcriptSearch.toLowerCase())).length} resultados
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {selectedCall.transcript ? (
                  <div className="space-y-2 text-sm max-h-96 overflow-y-auto scrollbar-thin">
                    {selectedCall.transcriptStructured.map((entry, i) => {
                      const isAgent = entry.role === 'Agente' || entry.role === 'Agent';
                      const isUser = entry.role === 'Usuario' || entry.role === 'User' || entry.role === 'Cliente';
                      const matchesSearch = transcriptSearch && entry.text.toLowerCase().includes(transcriptSearch.toLowerCase());
                      const isHidden = transcriptSearch && !matchesSearch;

                      if (isHidden) return null;

                      const highlightText = (text: string) => {
                        if (!transcriptSearch) return text;
                        const regex = new RegExp(`(${transcriptSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                        const parts = text.split(regex);
                        return parts.map((part, j) =>
                          regex.test(part) ? <mark key={j} className="bg-warning/30 text-foreground rounded px-0.5">{part}</mark> : part
                        );
                      };

                      const formatTs = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

                      return (
                        <div key={i} className={`px-3 py-2 rounded-lg flex gap-2 ${
                          matchesSearch ? 'ring-1 ring-warning/50' : ''
                        } ${
                          isAgent ? 'bg-primary/5 border-l-2 border-primary' :
                          isUser ? 'bg-muted/50 border-l-2 border-muted-foreground/30' :
                          'bg-muted/30'
                        }`}>
                          <span className="text-[10px] text-muted-foreground font-mono shrink-0 pt-0.5">{formatTs(entry.timestamp)}</span>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-muted-foreground">{entry.role}:</span>
                            <p className="text-foreground mt-0.5">{highlightText(entry.text)}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Phone size={28} className="mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">Sin transcripción disponible</p>
                    <p className="text-xs mt-1">La transcripción aparecerá aquí automáticamente una vez que la llamada finalice y se procese el audio.</p>
                    {selectedCall.status === 'completed' && (
                      <div className="mt-3 flex items-center justify-center gap-1.5 text-xs text-warning">
                        <Loader2 size={12} className="animate-spin" />
                        <span>Procesando transcripción...</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right column: Extracted Data + Risks + Event Timeline */}
            <div className="space-y-4">
              {/* Sentiment Indicator */}
              {selectedCall.extractedData.sentiment && (
                <div className={`rounded-xl p-4 shadow-sm border ${
                  selectedCall.extractedData.sentiment === 'positivo' ? 'bg-success/10 border-success/20' :
                  selectedCall.extractedData.sentiment === 'negativo' ? 'bg-destructive/10 border-destructive/20' :
                  'bg-muted border-border'
                }`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TrendingUp size={16} className={
                        selectedCall.extractedData.sentiment === 'positivo' ? 'text-success' :
                        selectedCall.extractedData.sentiment === 'negativo' ? 'text-destructive' :
                        'text-muted-foreground'
                      } />
                      <span className="text-sm font-semibold text-foreground capitalize">{selectedCall.extractedData.sentiment}</span>
                    </div>
                    {selectedCall.extractedData.sentimentScore !== undefined && (
                      <span className={`text-lg font-bold ${
                        selectedCall.extractedData.sentimentScore >= 7 ? 'text-success' :
                        selectedCall.extractedData.sentimentScore <= 3 ? 'text-destructive' :
                        'text-foreground'
                      }`}>{selectedCall.extractedData.sentimentScore}/10</span>
                    )}
                  </div>
                </div>
              )}

              {/* Risks & Alerts */}
              {((selectedCall.extractedData.risks && selectedCall.extractedData.risks.length > 0) ||
                (selectedCall.extractedData.alerts && selectedCall.extractedData.alerts.length > 0)) && (
                <div className="bg-destructive/5 border border-destructive/20 rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-destructive mb-3 flex items-center gap-2">
                    <AlertTriangle size={16} /> Riesgos y alertas
                  </h3>
                  <ul className="space-y-2">
                    {(selectedCall.extractedData.risks || []).map((r, i) => (
                      <li key={`risk-${i}`} className="text-sm text-foreground flex items-start gap-2">
                        <AlertTriangle size={12} className="text-destructive shrink-0 mt-0.5" />{r}
                      </li>
                    ))}
                    {(selectedCall.extractedData.alerts || []).map((a, i) => (
                      <li key={`alert-${i}`} className="text-sm text-foreground flex items-start gap-2">
                        <AlertTriangle size={12} className="text-warning shrink-0 mt-0.5" />{a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Key Topics */}
              {selectedCall.extractedData.keyTopics && selectedCall.extractedData.keyTopics.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Hash size={16} /> Temas principales
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCall.extractedData.keyTopics.map((topic, i) => (
                      <span key={i} className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full">{topic}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Extracted Data */}
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                <h3 className="font-semibold text-foreground mb-3">📊 Datos extraídos</h3>
                <div className="space-y-3 text-sm">
                  {selectedCall.extractedData.contactName && (<div><p className="text-xs text-muted-foreground">Contacto</p><p className="font-medium text-foreground">{selectedCall.extractedData.contactName}</p></div>)}
                  {selectedCall.extractedData.reason && (<div><p className="text-xs text-muted-foreground">Motivo</p><p className="font-medium text-foreground">{selectedCall.extractedData.reason}</p></div>)}
                  {selectedCall.extractedData.intent && (<div><p className="text-xs text-muted-foreground">Intención</p><p className="font-medium text-foreground capitalize">{selectedCall.extractedData.intent}</p></div>)}
                  {selectedCall.extractedData.budget && (<div><p className="text-xs text-muted-foreground">Presupuesto</p><p className="font-medium text-foreground">{selectedCall.extractedData.budget}</p></div>)}
                  {selectedCall.extractedData.urgency && (<div><p className="text-xs text-muted-foreground">Urgencia</p><p className="font-medium text-foreground capitalize">{selectedCall.extractedData.urgency}</p></div>)}
                  {selectedCall.extractedData.followUp && (<div><p className="text-xs text-muted-foreground">Seguimiento</p><p className="font-medium text-primary">{format(new Date(selectedCall.extractedData.followUp), "d MMM yyyy", { locale: es })}</p></div>)}
                  {Object.keys(selectedCall.extractedData).filter(k => !['suggestedTags', 'sentiment', 'sentimentScore', 'keyTopics', 'risks', 'alerts'].includes(k)).length === 0 && (<p className="text-muted-foreground text-xs">Sin datos extraídos</p>)}
                </div>
              </div>

              {/* Agreements */}
              {selectedCall.extractedData.agreements && selectedCall.extractedData.agreements.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3">✅ Acuerdos</h3>
                  <ul className="space-y-2">
                    {selectedCall.extractedData.agreements.map((a, i) => (
                      <li key={i} className="text-sm text-foreground flex items-start gap-2"><CheckCircle2 size={14} className="text-success shrink-0 mt-0.5" />{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Appointments linked to this call */}
              {callAppointments.length > 0 && (
                <div className="bg-success/5 border border-success/20 rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <CalendarPlus size={16} className="text-success" /> Citas asociadas
                  </h3>
                  <div className="space-y-2">
                    {callAppointments.map((apt: any) => (
                      <div key={apt.id} className="flex items-center justify-between bg-card rounded-lg px-3 py-2 border border-border">
                        <div>
                          <p className="text-sm font-medium text-foreground">{apt.contact_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(apt.start_at), "d MMM yyyy HH:mm", { locale: es })} · {apt.service_type || 'General'}
                          </p>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${apt.status === 'scheduled' ? 'bg-primary/10 text-primary' : apt.status === 'completed' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                          {apt.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Pipeline Jobs */}
              {callJobs.length > 0 && (
                <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                  <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                    <Briefcase size={16} /> Pipeline de procesamiento
                  </h3>
                  <div className="space-y-1.5">
                    {callJobs.map((job: any) => (
                      <div key={job.id} className="flex items-center gap-2 text-xs">
                        {job.status === 'success' && <CheckCircle2 size={12} className="text-success" />}
                        {job.status === 'queued' && <Clock size={12} className="text-muted-foreground" />}
                        {job.status === 'running' && <Loader2 size={12} className="text-primary animate-spin" />}
                        {job.status === 'error' && <AlertTriangle size={12} className="text-destructive" />}
                        <span className="text-foreground font-medium">{job.job_type.replace(/_/g, ' ')}</span>
                        {job.status === 'error' && (
                          <button
                            onClick={() => retryFailedJob(job.id)}
                            className="text-[10px] bg-destructive/10 text-destructive hover:bg-destructive/20 px-1.5 py-0.5 rounded flex items-center gap-1 transition-colors"
                            title={job.last_error || 'Reintentar'}
                          >
                            <RefreshCw size={10} /> Reintentar
                          </button>
                        )}
                        <span className={`ml-auto px-1.5 py-0.5 rounded ${
                          job.status === 'success' ? 'bg-success/10 text-success' :
                          job.status === 'error' ? 'bg-destructive/10 text-destructive' :
                          job.status === 'running' ? 'bg-primary/10 text-primary' :
                          'bg-muted text-muted-foreground'
                        }`}>{job.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Event Timeline */}
              <div className="bg-card border border-border rounded-xl p-4 sm:p-5 shadow-sm">
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Activity size={16} /> Timeline de eventos
                </h3>
                <EventTimeline events={callEvents} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== MAIN TABS VIEW =====
  const mainTabs = [
    { key: 'calls' as const, label: 'Llamadas', icon: Phone },
    { key: 'analytics' as const, label: 'Analíticas', icon: BarChart3 },
    { key: 'observability' as const, label: 'Observabilidad', icon: Shield },
  ];

  // ===== PAYMENT GATE =====
  if (!paymentLoading && hasPaymentMethod === false) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <PaymentGateCard
          serviceName="Voice Agent IA"
          onRegisterCard={redirectToSetup}
          redirecting={redirecting}
        />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4 sm:space-y-6">
      <VoiceAgent onCallEnd={handleCallEnd} />

      {/* Main tab navigation */}
      <div className="flex items-center gap-1 border-b border-border pb-0">
        {mainTabs.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Analytics Tab */}
      {activeTab === 'analytics' && (
        <CallAnalytics calls={dbCalls} jobs={allJobs} />
      )}

      {/* Observability Tab */}
      {activeTab === 'observability' && (
        <CallObservability />
      )}

      {/* Calls Tab */}
      {activeTab === 'calls' && (
        <>


      {/* Active calls banner */}
      {activeCalls.length > 0 && (
        <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-semibold text-primary">{activeCalls.length} llamada(s) activa(s)</span>
          </div>
          <div className="space-y-1">
            {activeCalls.map(call => {
              const cfg = statusConfig[call.status] || statusConfig.pending;
              return (
                <button key={call.id} onClick={() => setSelectedCall(call)} className="w-full flex items-center gap-3 bg-card/50 rounded-lg px-3 py-2 text-left hover:bg-card transition-colors">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${cfg.className}`}>{cfg.label}</span>
                  <span className="text-sm text-foreground">{call.extractedData.contactName || call.fromNumber || 'Llamada'}</span>
                  <ChevronRight size={14} className="ml-auto text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs sm:text-sm text-muted-foreground">Total llamadas</p>
          <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.total}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs sm:text-sm text-muted-foreground">Completadas</p>
          <p className="text-xl sm:text-2xl font-bold text-success">{stats.completed}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs sm:text-sm text-muted-foreground">Perdidas</p>
          <p className="text-xl sm:text-2xl font-bold text-destructive">{stats.missed}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3 sm:p-4 shadow-sm">
          <p className="text-xs sm:text-sm text-muted-foreground">Duración promedio</p>
          <p className="text-xl sm:text-2xl font-bold text-foreground">{formatDuration(stats.avgDuration)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <Search size={16} className="text-muted-foreground" />
          <input type="text" placeholder="Buscar por nombre, teléfono o transcripción..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="bg-transparent text-sm outline-none flex-1 text-foreground placeholder:text-muted-foreground" />
        </div>
        <ManualCallDialog onCallRegistered={loadDbCalls} />
        <div className="flex items-center gap-1 overflow-x-auto">
          <button onClick={() => setStatusFilter(null)} className={`text-xs px-3 py-1.5 rounded-full transition-colors shrink-0 ${!statusFilter ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>Todas</button>
          {['completed', 'in_progress', 'missed', 'no_answer', 'failed'].map(key => {
            const cfg = statusConfig[key];
            return (
              <button key={key} onClick={() => setStatusFilter(statusFilter === key ? null : key)} className={`text-xs px-3 py-1.5 rounded-full transition-colors shrink-0 ${statusFilter === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>{cfg.label}</button>
            );
          })}
        </div>
        <button onClick={loadDbCalls} className="p-2 rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground self-end sm:self-auto">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Call list */}
      <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Phone size={32} className="mx-auto mb-2 opacity-50" />
            <p className="text-sm">No hay llamadas registradas</p>
            <p className="text-xs mt-1">Inicia una llamada con el Voice Agent para comenzar</p>
          </div>
        ) : (
          filtered.map(call => {
            const cfg = statusConfig[call.status] || statusConfig.pending;
            const StatusIcon = cfg.icon;
            const isLive = ['in_progress', 'ringing', 'initiated'].includes(call.status);
            return (
              <button
                key={call.id}
                onClick={() => setSelectedCall(call)}
                className={`w-full flex items-center gap-3 sm:gap-4 px-4 py-3 border-b border-border last:border-b-0 hover:bg-secondary/30 transition-colors text-left ${isLive ? 'bg-primary/5' : ''}`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.className}`}>
                  <StatusIcon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{call.extractedData.contactName || call.fromNumber || 'Sin número'}</p>
                    {isLive && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />}
                    {call.audioUrl && <Volume2 size={12} className="text-muted-foreground shrink-0" />}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{call.channel === 'voice_agent' ? 'Voice Agent' : 'Twilio'}</span>
                    <span>·</span>
                    <span>{format(call.startedAt, "d MMM HH:mm", { locale: es })}</span>
                    {(call as any).recording_status === 'ready' && <span title="Grabación">🎙️</span>}
                    {(call as any).transcript_status === 'ready' && <span title="Transcripción">💬</span>}
                    {(call as any).summary_status === 'ready' && <span title="Resumen IA">📝</span>}
                    {(call as any).appointment_status === 'created' && <span title="Cita creada">📅</span>}
                    {((call as any).recording_status === 'error' || (call as any).transcript_status === 'error' || (call as any).summary_status === 'error' || (call as any).appointment_status === 'error') && <span title="Error en pipeline">⚠️</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <p className="text-sm text-foreground">{formatDuration(call.duration)}</p>
                  <p className="text-xs text-muted-foreground">{cfg.label}</p>
                </div>
                {call.tags.length > 0 && !isMobile && (
                  <div className="flex gap-1 shrink-0 max-w-[150px] overflow-hidden">
                    {call.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{tag}</span>
                    ))}
                  </div>
                )}
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </button>
            );
          })
        )}
      </div>
        </>
      )}
    </div>
  );
};

export default CallsPage;
